# Fibers

A fiber is a lightweight unit of execution managed by the Effect runtime. Fibers overlap I/O, inherit services and tracing context, and cancel cleanly with guaranteed cleanup. (Like goroutines or green threads, fibers give structured concurrency on Effect's scheduler — not parallel JavaScript CPU threads.)

![Structured concurrency: fork binds a child to its parent, fork.scoped binds it to a Scope, and fork.detached runs independently](/diagrams/fiber-tree.svg)

## Forking and joining (`fork` / `join`)

```vibe
// run: try Console.log(try buildDashboard())
effect function buildDashboard() {
  const chart = fork effect {
    try sleep("30 millis")
    return "chart"
  }
  try Console.log("preparing dashboard frame")
  return join chart
}
// Inferred: string!!
// Output: preparing dashboard frame
// Output: chart
```

- `fork expr` starts an Effect on a child fiber and returns its `Fiber.Fiber<A, E>` immediately.
- `join fiber` waits for the fiber and yields `A` (or propagates its failure/defect/interruption).
- `fork` and `join` are valid only inside effect code (`EK1701` outside); `fork` requires an Effect (`EK1703`) and `join` requires a `Fiber` (`EK1704`). Both have the unary precedence of `await`, so parenthesize member access or exponentiation: `(join child).length`, `(join child) ** 2` (`EK0510`).
- In an `async` function, awaiting a fiber is the `EK4609` lint warning; keep the native Promise context with `await runPromise(Fiber.join(fiber))`. Awaiting a `Deferred` is `EK4610`, repaired with `await runPromise(Deferred.await(deferred))`. In effect code every `await` is `EK0102`: write `join fiber` or `try Deferred.await(d)`.

### Awaiting a fiber as data (`Fiber.await`)

Use `try Fiber.await(child)` when you want an `Exit<A, E>` instead of propagating failure:

```vibe
// run: try Console.log(Exit.isFailure(try inspectChild()))
effect function inspectChild() {
  const child = fork effect { throw "render failed" }
  const outcome = try Fiber.await(child)
  if (Exit.isFailure(outcome)) {
    try Console.log("renderer stopped", Cause.squash(outcome.cause))
  }
  return outcome
}
// Output: renderer stopped render failed
// Output: true
```

## Choosing a fiber's lifetime

Every `fork` form declares who owns the child fiber:

| Form | Owner | When the child is interrupted |
| --- | --- | --- |
| `fork work()` | Current parent fiber | Automatically when the parent exits |
| `fork.scoped work()` | Enclosing `Scope` (adds `Scope` to `R`) | When `scoped(effect { ... })` closes |
| `fork.in(owner) work()` | Explicit `owner: Scope.Scope` | When `Scope.close(owner, ...)` runs |
| `fork.detached work()` | None (daemon) | Only when explicitly interrupted with `Fiber.interrupt` |

Returning a `fork` handle from a helper or leaving a `provide` block does **not** transfer ownership — the parent fiber still owns it. Use `fork.scoped` when a child must stop at a specific boundary:

```vibe
// run: try request()
effect function request() {
  try ensuring(scoped(effect {
    const started = try Deferred.make<void>()
    const progress = fork.scoped ensuring(
      effect {
        try Deferred.succeed(started, undefined)
        try sleep("1 minute")
      },
      Console.log("progress reporter stopped")
    )
    try Deferred.await(started)
  }), Console.log("request finishing"))
}
// Output: progress reporter stopped
// Output: request finishing
```

```vibe
// run: const owner = try Scope.make(); const background = try inCallerScope(owner); try Scope.close(owner, Exit.succeed(undefined)); const stopped = try Fiber.await(background); try Console.log(Exit.isFailure(stopped) && Cause.hasInterrupts(stopped.cause)); try detachedExample(); try Console.log("detached finished")
effect function inCallerScope(owner: Scope.Scope) {
  const started = try Deferred.make<void>()
  const background = fork.in(owner) effect {
    try Deferred.succeed(started, undefined)
    try sleep("1 minute")
  }
  try Deferred.await(started)
  // Closing owner interrupts background.
  return background
}

effect function detachedExample() {
  const independent = fork.detached sleep("50 millis")
  join independent
}
// Output: true
// Output: detached finished
```

## Interruption and uninterruptible regions

`Fiber.interrupt(worker)` requests cancellation and waits until all of `worker`'s finalizers finish. Always coordinate startup with a `Deferred` rather than `sleep`:

```vibe
// run: try stopWorker()
effect function stopWorker() {
  const started = try Deferred.make<void>()
  const worker = fork ensuring(
    effect {
      try Deferred.succeed(started, undefined)
      try sleep("1 minute")
    },
    Console.log("worker finalizer")
  )
  try Deferred.await(started)
  try Fiber.interrupt(worker)
  try Console.log("worker has terminated")
}
// Output: worker finalizer
// Output: worker has terminated
```

Protect critical sections with `uninterruptible`, reopen cancellation around blocking waits with `restore`, or force cancellation inside a masked region with `interruptible`:

```vibe
// run: try saveReport(); try pollStatus(false); const stopped = try exit(pollStatus(true)); try Console.log(Exit.isFailure(stopped) && Cause.hasInterrupts(stopped.cause))
effect function saveReport() {
  uninterruptible {
    try Console.log("saving; an interruption waits until the block ends")
    restore {
      try sleep("1 second")
    }
    try Console.log("saved")
  }
}

effect function pollStatus(cancelled: boolean) {
  interruptible {
    try sleep("1 second")
  }
  if (cancelled) try interrupt
}
// Output: saving; an interruption waits until the block ends
// Output: saved
// Output: true
```

- Opening `{` must stay on the same line as `uninterruptible`, `restore`, or `interruptible`.
- `restore` is valid only directly inside `uninterruptible` (`EK2111` outside, `EK2202` across a nested `effect` or `for concurrent` boundary).
- `return`, `break`, and `continue` inside interruption blocks target the enclosing function or loop normally.

## High-level concurrency: `try.all`, `try.race`, and `for concurrent`

Prefer structured combinators over manual `fork`/`join` whenever you are combining, racing, or looping:

```vibe
// run: try Console.log(try combine())
effect function title() {
  return "Inventory"
}

effect function rowCount() {
  try sleep("20 millis")
  return 18
}

effect function combine() {
  const [name, count] = try.all [title(), rowCount()]
  return `${name}: ${count}`
}
// Inferred: string!!
// Output: Inventory: 18
```

```vibe
// run: provide TestClock.layer() { const jobs = try Queue.unbounded<string>(); const shutdown = try Deferred.make<void>(); try Queue.offer(jobs, "build"); try Console.log(try nextEvent(jobs, shutdown)); try Deferred.succeed(shutdown, undefined); try Console.log(try nextEvent(jobs, shutdown)); const neverShutdown = try Deferred.make<void>(); const idle = fork nextEvent(jobs, neverShutdown); try TestClock.adjust("30 seconds"); try Console.log(join idle) }
effect function nextEvent(jobs: Queue.Queue<string>, shutdown: Deferred.Deferred<void>) {
  return try.race [
    effect { return `job: ${try Queue.take(jobs)}` },
    effect {
      try Deferred.await(shutdown)
      return "shutdown"
    },
    effect {
      try sleep("30 seconds")
      return "idle"
    }
  ]
}
// Output: job: build
// Output: shutdown
// Output: idle
```

```vibe
// run: try printAll(["a", "", "b"])
effect function fetchPage(id: string) {
  try sleep("5 millis")
  return `page ${id}`
}

effect function printAll(ids: ReadonlyArray<string>) {
  for concurrent(8) (const id of ids) {
    if (id === "") continue
    try Console.log(try fetchPage(id))
  }
}
// Output: page a
// Output: page b
```

In `for concurrent`, `continue` finishes the current item; `break` (`EK1903`), `return` (`EK1904`), and outer labeled `continue` (`EK1905`) are compile errors. Throw an expected error to abort the whole batch and cancel active siblings.

## Coordinating readiness with `Deferred`

Forking schedules a child without waiting for it to run. Whenever a parent must wait for a child to reach a checkpoint, synchronize explicitly with a `Deferred` — never with `sleep` or `yieldNow`:

```vibe
// run: try waitForReady()
effect function waitForReady() {
  const ready = try Deferred.make<void>()
  const worker = fork effect {
    try Console.log("worker initialized")
    try Deferred.succeed(ready, undefined)
    try sleep("20 millis")
  }
  try Deferred.await(ready)
  try Console.log("initialization is complete")
  join worker
}
// Output: worker initialized
// Output: initialization is complete
```

[Upstream Effect page](https://effect.website/docs/v4/concurrency/fibers)
