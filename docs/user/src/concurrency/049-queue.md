# Queue

A `Queue` transfers values between fibers with point-to-point delivery: each offered item is received by one consumer. Use it to decouple producers from workers and enforce backpressure when workers fall behind.

![Queue vs. PubSub message delivery](/diagrams/queue-vs-pubsub.svg)

| Constructor | Behavior when full | Memory bound |
| --- | --- | --- |
| `Queue.bounded(n)` | Suspends `offer` until space frees | Bounded (`n`) |
| `Queue.dropping(n)` | Rejects new items (`offer` returns `false`) | Bounded (`n`) |
| `Queue.sliding(n)` | Evicts oldest buffered items to accept new ones | Bounded (`n`) |
| `Queue.unbounded()` | Always accepts immediately | Unbounded |

## Choosing an overflow strategy

```vibe
// run: const queues = try chooseQueues(); try Console.log(queues.jobs.capacity, queues.optionalEvents.capacity, queues.recentPositions.capacity, queues.unrestricted.capacity)
effect function chooseQueues() {
  const jobs = try Queue.bounded<string>(32)
  const optionalEvents = try Queue.dropping<string>(32)
  const recentPositions = try Queue.sliding<number>(32)
  const unrestricted = try Queue.unbounded<string>()
  return { jobs, optionalEvents, recentPositions, unrestricted }
}

effect function stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}
// Output: 32 32 32 Infinity
```

Choose `bounded` for reliable work queues with backpressure, `dropping` when newer events can be shed under load, and `sliding` when only the latest readings matter. Use `unbounded` only when producers are externally rate-limited, since unchecked producers grow memory without bound.

## Offering values and batches

```vibe
// run: { const jsonValue = [try offerWithBackpressure(), try rejectedBatch()]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function offerWithBackpressure() {
  const queue = try Queue.bounded<number>(1)
  try Queue.offer(queue, 10)
  const secondOffer = fork Queue.offer(queue, 20)
  const first = try Queue.take(queue)
  join secondOffer
  const second = try Queue.take(queue)
  return [first, second] // [10, 20]
}

effect function rejectedBatch() {
  const queue = try Queue.dropping<number>(2)
  return try Queue.offerAll(queue, [10, 20, 30]) // [30]
}
// Output: [[10,20],[30]]
```

`Queue.offer` returns whether the item was accepted; `Queue.offerAll` returns an array of rejected items (empty when the entire batch fit). Fork producers whenever the current fiber must also drain the queue—calling `offer` on a full bounded queue before taking on the same fiber deadlocks.

## Taking, polling, and draining values

```vibe
// run: const result = try consumeBatches(); { const jsonValue = [result.first, Option.getOrElse(result.optional, () => 0), result.pair, result.batch, result.empty]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function consumeBatches() {
  const queue = try Queue.bounded<number>(8)
  try Queue.offerAll(queue, [1, 2, 3, 4, 5, 6])
  const first = try Queue.take(queue)            // 1
  const optional = try Queue.poll(queue)         // Some(2)
  const pair = try Queue.takeN(queue, 2)          // [3, 4]
  const batch = try Queue.takeBetween(queue, 1, 4) // [5, 6]
  const empty = try Queue.clear(queue)           // []
  return { first, optional, pair, batch, empty }
}
// Output: [1,2,[3,4],[5,6],[]]
```

| Operation | Suspends when empty? | Returns |
| --- | --- | --- |
| `Queue.take` | Yes | Next single value |
| `Queue.takeN(q, n)` | Yes, until `n` items exist | Exact batch of `n` values |
| `Queue.takeBetween(q, min, max)` | Yes, until `min` items exist | Between `min` and `max` values |
| `Queue.takeAll` | Yes, until at least one item exists | Available nonempty batch |
| `Queue.poll` | No | `Option` of one value |
| `Queue.clear` | No | All currently buffered values |

## Querying queue state

```vibe
// run: { const jsonValue = try inspectQueue(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function inspectQueue() {
  const queue = try Queue.bounded<string>(2)
  try Queue.offer(queue, "task")
  return {
    capacity: queue.capacity,
    size: try Queue.size(queue),
    full: try Queue.isFull(queue)
  }
}
// Returns { capacity: 2, size: 1, full: false }.
// Output: {"capacity":2,"size":1,"full":false}
```

`size` and `isFull` reflect buffered items at the moment of the call, not a reservation. Another fiber can mutate the queue immediately afterward, so coordinate directly through `offer` and `take` rather than branching on queue state.

## Shutting down and awaiting closure

```vibe
// run: { const jsonValue = try finishNormally(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; const stopped = try stopImmediately(); try Console.log(Exit.isFailure(stopped) && Cause.hasInterrupts(stopped.cause))
effect function finishNormally() {
  const queue = try Queue.bounded<number, Cause.Done>(4)
  try Queue.offerAll(queue, [7, 8])
  try Queue.end(queue)
  const values = try Queue.collect(queue)
  try Queue.await(queue)
  return values // [7, 8]
}

effect function stopImmediately() {
  const queue = try Queue.bounded<number>(4)
  const waiter = fork ensuring(
    Queue.await(queue),
    Console.log("queue closed")
  )
  try Queue.shutdown(queue)
  return try Fiber.await(waiter)
}
// Output: [7,8]
// Output: queue closed
// Output: true
```

`Queue.end` rejects new offers while letting consumers drain buffered items (for example via `Queue.collect`) before completing normally. `Queue.shutdown` discards buffered items immediately and interrupts blocked fibers. Because `Queue.await` propagates the terminal outcome, awaiting a shut-down queue fails with interruption—inspect such a waiter with `Fiber.await` instead of `join`.

Exiting a block does not close a queue automatically. When a queue's lifetime belongs to a computation, pair it with `ensuring(program, Queue.shutdown(queue))`.

## Restricting producer and consumer capabilities

```vibe
// run: try Console.log(try handoff())
effect function send(outbox: Queue.Enqueue<string>, message: string) {
  return try Queue.offer(outbox, message)
}

effect function receive(inbox: Queue.Dequeue<string>) {
  return try Queue.take(inbox)
}

effect function handoff() {
  const queue = try Queue.bounded<string>(2)
  try send(Queue.asEnqueue(queue), "ready")
  return try receive(Queue.asDequeue(queue))
}
// Output: ready
```

`Queue.asEnqueue` exposes only producer operations (`Queue.Enqueue<A>`) and `Queue.asDequeue` exposes only consumer operations (`Queue.Dequeue<A>`). Both return views over the same queue so misuse is caught at compile time.
