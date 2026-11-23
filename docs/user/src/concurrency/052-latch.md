# Latch

A `Latch` is a reusable boolean gate for fibers: callers wait while it is closed and pass immediately while it is open. Use it to block workers until initialization completes or to pause and resume cohorts of fibers.

| Primitive | Reusable? | Carries value / error? | Controls |
| --- | --- | --- | --- |
| `Latch` | Yes (`open` / `close` / `release`) | No | Whether any caller may proceed |
| `Deferred` | No (completes once) | Yes (`A`, `E`) | One-time result handoff |
| `Semaphore` | Yes (permit pool) | No | How many callers run concurrently |

## Waiting at a reusable gate

```vibe
// run: try Console.log(try initializeThenWork())
effect function initializeThenWork() {
  const ready = try Latch.make()
  const worker = fork effect {
    try Latch.await(ready)
    return "processing enabled"
  }
  try sleep("20 millis")
  try Latch.open(ready)
  return join worker
}
// Output: processing enabled
```

`try Latch.await(ready)` suspends only while the latch is closed and returns immediately when open, without blocking other fibers. Use `Latch.whenOpen(gate, eff)` when gating an Effect reads more cleanly as a single expression.

## Opening and closing

```vibe
// run: try Console.log(try reopenGate())
effect function reopenGate() {
  const gate = try Latch.make(true)
  try Latch.await(gate) // Passes immediately.
  try Latch.close(gate)
  const waiting = fork Latch.whenOpen(gate, effect { return "allowed again" })
  try Latch.open(gate)
  return join waiting
}
// Output: allowed again
```

`Latch.open` wakes all current waiters and keeps the gate open for later arrivals. `Latch.close` makes subsequent arrivals wait again without interrupting fibers already past the gate. `Latch.release` wakes only the fibers currently waiting while keeping the latch closed to new arrivals.

## Choosing the initial state

```vibe
// run: const gates = try createGates(); try Console.log(Latch.isOpen(gates.starting), Latch.isOpen(gates.paused), Latch.isOpen(gates.active))
effect function createGates() {
  const starting = try Latch.make()      // Closed by default.
  const paused = try Latch.make(false)   // Explicitly closed.
  const active = try Latch.make(true)    // Open from the start.
  return { starting, paused, active }
}
// Output: false false true
```

Create the latch once and share it across every fiber governed by that condition. Because `open` persists until `close`, late callers never miss a readiness signal. Reach for a `Deferred` instead when waiters need a result value or typed failure.

## Choosing a latch or a permit pool

```vibe
// run: try gatedExclusiveWork()
effect function gatedExclusiveWork() {
  const initialized = try Latch.make(true)
  const exclusive = try Semaphore.make(1)
  try Latch.await(initialized)
  return try Semaphore.withPermits(exclusive, 1, Console.log("updating shared device"))
}
// Output: updating shared device
```

A latch gates *whether* callers may proceed; a semaphore limits *how many* execute a critical section simultaneously. Because an open latch admits every fiber at once, pair it with a shared semaphore whenever callers also need mutual exclusion.
