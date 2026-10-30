# Fibers

A fiber is a running computation with a result and a lifetime. Effect's lightweight fibers overlap waiting work, inspect completion, and cancel safely. They give concurrency on the runtime's scheduler, not parallel CPU execution of JavaScript.

## Forking and awaiting

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17
// run: try Console.log(try buildDashboard())
effect function buildDashboard() {
  const chart = fork effect {
    try sleep("30 millis")
    return "chart"
  }
  try Console.log("preparing dashboard frame")
  return join chart
}
// string!!
// Output: preparing dashboard frame
// Output: chart
```

`fork` starts a child fiber and returns its handle, here a `Fiber.Fiber<string>`, without waiting for its result: the parent continues while the child waits. `join` waits for the child and returns its value or propagates its failure.

`fork loadChart()` starts the Effect returned by `loadChart()`. To fork several statements, write `fork effect { ... }`. An existing Effect value is also a valid operand: after `const job = loadChart()`, write `fork job`. `join` takes a fiber: `join chart` waits for the fiber's result. A plain `fork` is owned by the current fiber, which interrupts unfinished children when it ends. `await` waits for Promises inside async functions.

## Awaiting completion as data

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-14, VIP-17
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

`Fiber.await` succeeds with an `Exit`, which also represents defects and interruption, so it doesn't rethrow the child's failure into the caller. Use `join child` to propagate failure and `try Fiber.await(child)` when the caller decides what the outcome means.

## Handling asynchronous interruption

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-17
// run: try stopWorker()
effect function stopWorker() {
  const worker = fork ensuring(
    sleep("1 minute"),
    Console.log("worker finalizer")
  )
  try sleep("10 millis")
  try Fiber.interrupt(worker)
  try Console.log("worker has terminated")
}
// Output: worker finalizer
// Output: worker has terminated
```

Cancellation needs no hand-written polling loop: Effect delivers it at runtime boundaries, defers it in uninterruptible regions, and runs cleanup before `Fiber.interrupt` returns. A long plain JavaScript calculation still holds the host thread until it returns or reaches an Effect operation.

To continue during cleanup, fork the interruption (`const stopping = fork Fiber.interrupt(worker)`) and `join stopping` before its owner exits. When cleanup ordering matters, avoid immediate unsafe runtime methods.

## Protecting work from interruption

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-22
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
  if (cancelled) try interrupt()
}
// Output: saving; an interruption waits until the block ends
// Output: saved
// Output: true
```

- `uninterruptible` (`Effect.uninterruptibleMask`) runs its block without interruption: an interruption that arrives waits until the block ends.
- `restore` inside it brings back the fiber's previous interruptibility, so long waits stay cancellable.
- `interruptible` (`Effect.interruptible`) makes its code interruptible even inside an uninterruptible region.
- `try interrupt()` (`Effect.interrupt`) interrupts the running fiber.

Statements in these blocks stay code of the enclosing function, so `return` returns from it. Run Effects inside each block with `try`. To pass an Effect value instead, use `Effect.uninterruptible(saveRows())` or `Effect.interruptible(program)`.

## Combining results

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-18
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
// string!!
// Output: Inventory: 18
```

`try.all [...]`, like `Promise.all`, starts every Effect in its own fiber, waits for all, and keeps the input array's order. `rowCount()` returns its Effect unrun, and `try.all` starts it in its fiber. For an object of Effects, use `try all({ name: title(), count: rowCount() }, { concurrency: "unbounded" })` to keep the object shape. If one fails, `try.all` interrupts the rest and propagates the failure, as `all` fails fast. For an expected-failure fallback, use `program catch fallback`; defects and interruption still propagate.

`try.allSettled [...]` returns an `Exit` for each element and never fails. Each `Exit` represents success, failure, defect, or interruption, keeping every outcome as data, mixed causes included.

For fibers you already hold, join each handle or use `try all([Fiber.join(titleFiber), Fiber.join(rowsFiber)])`. In a `try.all` operation, pass `Fiber.join(fiber)` or `Deferred.await(ready)` as the element, not the fiber or deferred handle itself. Pass an existing array of Effects directly, as `try.all jobs`; a plain function must be called to get its Effect first.

## Racing events

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17, VIP-18
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
// string!!
// Output: job: build
// Output: shutdown
// Output: idle
```

`try.race [...]` (`Promise.race`, `Effect.raceAllFirst`) starts each element in its own fiber, returns the first to finish, success or failure, and interrupts the rest; of elements ready at once, the first written wins. An `effect { ... }` element builds an Effect whose statements run in its fiber, and `return` supplies its value. `try.any [...]` (`Effect.raceAll`) returns the first success instead and fails only when every element fails. To poll without waiting, test `try Queue.poll(jobs)` with an `if`.

## Running a loop body concurrently

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-19
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

`for concurrent` runs its body for each item in its own fiber and ends when all finish; `for concurrent(8)` runs at most eight at once, and `for concurrent (...)` sets no limit. A failure interrupts the items still running and fails the loop. `continue` ends one item. Because each item has its own fiber, a `break` that would leave the loop (`EK1903`) and a `return` (`EK1904`) are errors; throw to stop every item. For results, use `forEach`.

The formatter preserves nested `try` expressions in the concurrency limit and iterable expression.

## Supervising child lifetimes

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17
// run: try request()
effect function request() {
  try ensuring(scoped(effect {
    const progress = fork.scoped ensuring(
      sleep("1 minute"),
      Console.log("progress reporter stopped")
    )
    try sleep("20 millis")
  }), Console.log("request finishing"))
}
// Output: progress reporter stopped
// Output: request finishing
```

A plain `fork` belongs to the parent fiber. A nested block doesn't create a fiber owner. Use `fork.scoped` when work must end with a specific scope. Here `scoped` closes that scope, interrupts the reporter, and waits for cleanup before the outer finalizer runs.

Forked fibers inherit the current services and tracing context.

## Selecting scoped or detached lifetimes

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-17
// run: const owner = try Scope.make(); const background = try inCallerScope(owner); try Scope.close(owner, Exit.succeed(undefined)); const stopped = try Fiber.await(background); try Console.log(Exit.isFailure(stopped) && Cause.hasInterrupts(stopped.cause)); try detachedExample(); try Console.log("detached finished")
effect function inCallerScope(owner: Scope.Scope) {
  const background = fork.in(owner) sleep("1 minute")
  try sleep("20 millis")
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

`fork.in(owner)` attaches the child to a scope you hold; it lives until that scope closes. `fork.detached` ties the child to nothing: it survives its parent and needs an explicit shutdown strategy (the example joins it to stay bounded). `fork.scoped` attaches the child to the caller's scope and leaves `Scope` in the caller's requirements until a scope is supplied.

Start a fiber that must outlive its parent with `fork.scoped work()` for the caller's scope, `fork.in(owner) work()` for a scope the caller holds, or `fork.detached work()` and a shutdown strategy. To bound a `join`, race its Effect: `try.race [Fiber.join(child), effect { try sleep("5 seconds"); throw new Late() }]`.

## Understanding execution scheduling

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17
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

Forking schedules a child; it doesn't prove the child reached a particular statement. `try yieldNow()` lets other work run but guarantees no readiness, and sleeping for an estimated startup time leaves a race. When ordering matters, use a `Deferred`: `try Deferred.await(ready)` waits until the child completes it.
