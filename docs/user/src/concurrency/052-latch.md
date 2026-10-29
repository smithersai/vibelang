# Latch

A latch is a reusable gate for fibers: closed, it makes callers wait; open, it lets them pass. Use one when many operations wait for a condition such as completed initialization.

## Waiting at a reusable gate

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17
// run: try Console.log(try initializeThenWork())
effect initializeThenWork() {
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

`try Latch.await(ready)` waits until the latch lets the fiber proceed, without blocking other fibers; on an open latch it returns at once. `Latch.whenOpen` wraps an Effect value when the wait and action read better as one expression.

## Opening and closing

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-14, VIP-17
// run: try Console.log(try reopenGate())
effect reopenGate() {
  const gate = try Latch.make(true)
  try Latch.await(gate) // Passes immediately.
  try Latch.close(gate)
  const waiting = fork Latch.whenOpen(gate, effect { return "allowed again" })
  try Latch.open(gate)
  return join waiting
}
// Output: allowed again
```

Opening releases current waiters and lets future callers through. Closing makes future callers wait again; it doesn't cancel work already past the gate. `Latch.release` releases the current waiters without leaving the latch open, so later arrivals still wait.

## Choosing the initial state

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: const gates = try createGates(); try Console.log(Latch.isOpen(gates.starting), Latch.isOpen(gates.paused), Latch.isOpen(gates.active))
effect createGates() {
  const starting = try Latch.make()      // Closed by default.
  const paused = try Latch.make(false)   // Explicitly closed.
  const active = try Latch.make(true)    // Open from the start.
  return { starting, paused, active }
}
// Output: false false true
```

Create the latch once and share it with every operation the condition controls. Opening lasts until a close, so a caller arriving after initialization doesn't miss the signal. A latch carries no result value or typed failure; use a Deferred when waiters need either.

## Choosing a latch or a permit pool

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try gatedExclusiveWork()
effect gatedExclusiveWork() {
  const initialized = try Latch.make(true)
  const exclusive = try Semaphore.make(1)
  try Latch.await(initialized)
  return try Semaphore.withPermits(exclusive, 1, Console.log("updating shared device"))
}
// Output: updating shared device
```

The latch decides whether callers may proceed at all; the semaphore limits how many are inside a protected operation at once. An open latch admits every caller and gives no mutual exclusion, so share the semaphore too when callers must take turns.
