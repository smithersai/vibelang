# Basic Concurrency

Running four independent network requests one after another wastes time. Launching four thousand at once melts your database. And if one fails halfway through, plain `Promise.all` leaves the other promises running in the background with no way to stop them.

VibeLang gives you structured concurrency built on Effect fibers: overlap work on demand, bound how many run at once, and automatically cancel and clean up losers whenever a branch fails or a race finishes.

![Timeline comparison of sequential all, bounded for concurrent(2), and unbounded try.all](/diagrams/concurrency-modes.svg)

## Sequential, bounded, and unbounded work

![try all runs calls together](/videos/concurrent.mp4)

Because calling an `effect function` returns an **unrun** Effect value, you hand those blueprints to a concurrency form and let it schedule them:

```vibe
// run: { const jsonValue = try runTasks(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function task(id: number) {
  try Console.log("starting", id)
  try sleep("40 millis")
  return id * 2
}

effect function runTasks() {
  const sequential = try all([task(1), task(2)])
  const bounded = try forEach([1, 2, 3, 4], (id) => task(id), {
    concurrency: 2
  })
  const unbounded = try.all [task(5), task(6), task(7)]
  return { sequential, bounded, unbounded }
}
// Output: starting 1
// Output: starting 2
// Output: starting 1
// Output: starting 2
// Output: starting 3
// Output: starting 4
// Output: starting 5
// Output: starting 6
// Output: starting 7
// Output: {"sequential":[2,4],"bounded":[2,4,6,8],"unbounded":[10,12,14]}
```

Choose the form that fits your workload:

| Form | Concurrency | Best for |
| --- | --- | --- |
| `try all([a(), b()])` | Sequential (`1`) | Ordered steps or when you pass `{ concurrency: n }` / an object `{ user: load() }` |
| `try.all [a(), b()]` | Unbounded | Fixed tuple of independent Effects (like `Promise.all`, plus cancellation) |
| `try forEach(xs, f, { concurrency: 4 })` | Bounded (`4`) | Mapping a dynamic list into collected results without overwhelming a service |
| `for concurrent(4) (const x of xs) { ... }` | Bounded (`4`) | Side-effecting concurrent loop (`continue` skips one item; `break` / `return` are errors) |
| `try.allSettled [a(), b()]` | Unbounded | Collect every branch's `Exit<A, E>` without failing the whole batch |

All of these preserve input order in their results, regardless of which fiber finishes first.

> **Watch out: `for concurrent` bounds execution, not iterator pulling.**
> For parallel concurrency (`> 1` or unbounded), Effect collects a non-array iterable before starting parallel work. Use a `Stream` with `for try` for incremental consumption ([runtime witness](../../../design/src/008-runtime.md#iterable-lifecycle)).

## Interrupting work and running cleanup

When a computation is no longer needed, `Fiber.interrupt` cancels it and **waits** for all of its finalizers to finish before returning:

```vibe
// run: const stopped = try cancelWork(); try Console.log(Exit.isFailure(stopped) && Cause.hasInterrupts(stopped.cause))
effect function cancelWork() {
  const worker = fork effect {
    try sleep("1 minute")
    return "finished"
  }
  try Fiber.interrupt(worker)
  return try Fiber.await(worker)
}
// Output: true
```

Attach guaranteed cleanup with `ensuring` (runs on success, failure, defect, or cancellation) or `onInterrupt` (runs only on cancellation):

```vibe
// run: try cancelWithCleanup(); try Console.log("interrupt returned")
effect function cancelWithCleanup() {
  const started = try Deferred.make<void>()
  const worker = fork onInterrupt(
    ensuring(effect {
      try Deferred.succeed(started, undefined)
      try sleep("1 minute")
    }, Console.log("released worker resources")),
    () => Console.log("worker cancelled")
  )
  try Deferred.await(started)
  try Fiber.interrupt(worker)
}
// Output: released worker resources
// Output: worker cancelled
// Output: interrupt returned
```

Notice the order of the output: both cleanup handlers finish **before** `interrupt returned` prints. The `Deferred` handshake ensures the child has started and installed its handlers before the parent interrupts it. (For acquired resources like file handles or connections, prefer `acquireRelease` inside `scoped` — see [Resource Management](../resource-management/029-introduction.md).)

## Automatic cancellation across siblings

If any branch inside `for concurrent` or `try.all` fails or is interrupted, Effect automatically interrupts every active sibling and waits for their cleanup:

```vibe
// run: const stopped = try exit(cancelBatch()); try Console.log(Exit.isFailure(stopped) && Cause.hasInterrupts(stopped.cause))
effect function cancelBatch() {
  for concurrent (const id of [1, 2, 3]) {
    try ensuring(effect {
      if (id === 2) {
        try sleep("10 millis")
        try interrupt
      }
      try sleep("1 second")
    }, Console.log("branch finished"))
  }
}
// Output: branch finished
// Output: branch finished
// Output: branch finished
// Output: true
```

All three branches run their `ensuring` cleanup even though branch 2 interrupted after 10 ms.

## Racing: `try.race` vs. `try.any`

![try.race takes the first completion (failure included); try.any waits for the first success](/diagrams/race-vs-any.svg)

![try race: the first answer wins, the losers are cancelled](/videos/race.mp4)

```vibe
// run: { const jsonValue = try raceExamples(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function answer(label: string, delay: Duration.Input) {
  try sleep(delay)
  return label
}

effect function raceExamples() {
  const firstSuccess = try race(
    effect { throw "unavailable" },
    answer("replica", "20 millis")
  )
  const anySuccess = try.any [
    answer("west", "40 millis"),
    answer("east", "10 millis"),
    answer("central", "30 millis")
  ]
  const firstCompletion = try.race [
    answer("primary", "10 millis"),
    answer("backup", "50 millis")
  ]
  return { firstSuccess, anySuccess, firstCompletion }
}
// Output: {"firstSuccess":"replica","anySuccess":"east","firstCompletion":"primary"}
```

| Form | Winner rule | Losers | Empty array |
| --- | --- | --- | --- |
| `try.race [a(), b()]` | First completion (success **or** failure) | Interrupted & cleaned up | Never completes |
| `try.any [a(), b()]` | First **success** (fails only if all fail) | Interrupted & cleaned up | Never completes |
| `try race(a(), b())` | Effect's binary `race`: first **success** | Interrupted & cleaned up | N/A |

To observe which branch won a race without altering its outcome, pass an `onWinner` callback to `raceFirst`:

```vibe
// run: const result = try inspectRace(); try Console.log(Result.isFailure(result.outcome)); { const jsonValue = result.winners; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function inspectRace() {
  const winners: number[] = []
  const outcome = try result(raceFirst(
    effect { throw "primary offline" },
    effect {
      try sleep("1 second")
      return "backup response"
    },
    { onWinner: ({ index }) => { winners.push(index) } }
  ))
  if (Result.isFailure(outcome)) {
    try Console.log("first completion failed", outcome.failure)
  }
  return { outcome, winners }
}
// Output: first completion failed primary offline
// Output: true
// Output: [0]
```

## Coming from Effect

| Effect TypeScript | VibeLang |
| --- | --- |
| `Effect.all([a, b], { concurrency: "unbounded" })` | `try.all [a(), b()]` |
| `Effect.raceAllFirst([a, b])` | `try.race [a(), b()]` |
| `Effect.raceAll([a, b])` | `try.any [a(), b()]` |
| `Effect.all([Effect.exit(a), Effect.exit(b)], { concurrency: "unbounded" })` | `try.allSettled [a(), b()]` |
| `Effect.forEach(xs, f, { concurrency: 4, discard: true })` | `for concurrent(4) (const x of xs) { try f(x) }` |

`try.all`, `try.race`, `try.any`, and `try.allSettled` take arrays or tuples of Effects (`EK1801`). For an object of Effects, use `try all({ user: load() }, { concurrency: "unbounded" })`. The older `await.all` spellings are retired (`EK1802`).

**Next:** [Fibers](047-fibers.md) for deep fiber control, or continue the Learning Path with [Effect's Modules](../getting-started/008-importing-effect.md).

[Upstream Effect page](https://effect.website/docs/v4/concurrency/basic-concurrency)
