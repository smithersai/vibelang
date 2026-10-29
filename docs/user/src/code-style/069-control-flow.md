# Control Flow Operators

VibeLang uses ordinary branches and loops for sequential work. Effect's operators serve concurrent execution, collected results, and policies over whole programs. Pass them Effect values. The operator controls when each Effect runs.

## Branching and conditional computations

```vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(Option.isNone(optionalSize(-1)), Option.getOrNull(optionalSize(3)), try requiredSize(3)); try Console.log(requiredSize(-1) catch (error) => `${error._tag} ${error.size}`); try Console.log(Option.isNone(try announceIfEnabled(false))); try Console.log(Option.getOrNull(try announceIfEnabled(true)))
error InvalidSize {
  size: number
}

function optionalSize(size: number) {
  if (size < 0) return Option.none<number>()
  return Option.some(size)
}

effect function requiredSize(size: number) {
  if (size < 0) throw new InvalidSize({ size })
  return size
}
// number!InvalidSize!

effect function announceIfEnabled(enabled: boolean) {
  return try Effect.when(effect {
    try Console.log("notifications enabled")
    return "announced"
  }, succeed(enabled))
}
```

```output
true 3 3
InvalidSize -1
true
notifications enabled
announced
```

`if`, early `return`, and `throw` work in an effect function, after a service call too. `Effect.when` runs its condition Effect first, runs its source only on `true`, and returns an `Option` saying whether it ran: `false` gives `None`, and a condition failure propagates instead of skipping work. Run it with `try` to get that Option.

## Combining two results

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-18
// run: try Console.log(JSON.stringify([try sequentialPair(), try concurrentPair(), try formattedPair()]))
effect function amount() {
  try sleep("30 millis")
  return 18
}

effect function currency() {
  try sleep("10 millis")
  return "USD"
}

effect function sequentialPair() {
  const value = try amount()
  const unit = try currency()
  return [value, unit] as const
}

effect function concurrentPair() {
  return try Effect.zip(amount(), currency(), { concurrent: true })
}

effect function formattedPair() {
  return try Effect.zipWith(
    amount(),
    currency(),
    (value, unit) => `${value} ${unit}`
  )
}
```

```output
[[18,"USD"],[18,"USD"],"18 USD"]
```

`zip` returns a tuple; `zipWith` applies a synchronous combining callback. Both run left then right by default; `{ concurrent: true }` starts both branches together, and completion order doesn't change tuple positions. A failed branch interrupts its sibling and waits for cleanup before the combined operation finishes.

## Repeating work in loops

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try inspectPages())); try logAttempts()
effect function inspectPages() {
  const inspected: number[] = []
  let page = 1
  while (page <= 3) {
    try sleep("10 millis")
    inspected.push(page)
    page++
  }
  return inspected // [1, 2, 3]
}

effect function logAttempts() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try Console.log(`attempt ${attempt}`)
  }
}
// Output: [1,2,3]
// Output: attempt 1
// Output: attempt 2
// Output: attempt 3
```

A loop can call services, pause, fail, and use `break` or `continue`. Accumulate results only when the caller needs them; a loop without an explicit return completes with `void`. Each run of the function recreates its local state.

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try operatorLoop()
effect function operatorLoop() {
  let index = 0
  try Effect.whileLoop({
    while: () => index < 3,
    body: () => Console.log(`iteration ${index}`),
    step: () => { index++ }
  })
}
```

```output
iteration 0
iteration 1
iteration 2
```

In Effect 4.1.0, `whileLoop` takes one options object and returns an Effect with success type `void`. `body` lazily supplies an Effect; `step` updates state synchronously after each successful iteration. It has no initial-state argument or result-collection option; collect results in local state and an array.

## Traversing collections and discarding values

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try prepareAll())); try logAll()
effect function prepare(id: number) {
  try sleep("10 millis")
  return `prepared-${id}`
}

effect function prepareAll() {
  return try forEach([3, 5, 8], effect (id, index) => {
    try Console.log(`preparing position ${index}`)
    return try prepare(id)
  }, { concurrency: 2 })
}

effect function logAll() {
  try forEach([3, 5, 8], (id) => Console.log(`id ${id}`), { discard: true })
}
```

```output
preparing position 0
preparing position 1
preparing position 2
["prepared-3","prepared-5","prepared-8"]
id 3
id 5
id 8
```

`forEach` returns results in input order and runs sequentially by default. A concurrency limit overlaps work and bounds active callbacks. `{ discard: true }` runs all work and keeps no results. A failure stops traversal; concurrent callbacks already running are interrupted and cleaned up.

## Collecting programs

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try collected()))
effect function collected() {
  const tuple = try all([succeed(12), succeed("ready")] as const)
  const object = try all({ count: succeed(12), status: succeed("ready") })
  const iterable = new Set([prepare(3), prepare(5)])
  const array = try all(iterable, { concurrency: 2 })
  return { tuple, object, array }
}
// tuple: [12, "ready"]
// object: { count: 12, status: "ready" }
// array contains the two prepared values in iteration order.
// Output: {"tuple":[12,"ready"],"object":{"count":12,"status":"ready"},"array":["prepared-3","prepared-5"]}
```

`all` takes tuples, iterables, objects, and records and returns the matching shape. Each entry is an Effect value. Building the collection does not run its Effects. It runs sequentially unless you pass `concurrency`. `discard: true` drops the combined result when only completion matters.

## Early termination and alternate collection modes

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(stopAtFailure() catch (error) => error._tag); try Console.log(JSON.stringify((try collectOutcomes()).map((result) => Result.isSuccess(result) ? result.success : result.failure._tag)))
error Unavailable {
  id: number
}

effect function load(id: number) {
  if (id === 5) throw new Unavailable({ id })
  try Console.log(`loaded ${id}`)
  return `item-${id}`
}

effect function stopAtFailure() {
  return try all([load(3), load(5), load(8)])
}
// Sequentially loads 3, then fails with Unavailable; 8 is not started.

effect function collectOutcomes() {
  return try all([load(3), load(5), load(8)], { mode: "result" })
}
// [Result.succeed("item-3"), Result.fail(Unavailable), Result.succeed("item-8")]
// Output: loaded 3
// Output: Unavailable
// Output: loaded 3
// Output: loaded 8
// Output: ["item-3","Unavailable","item-8"]
```

The default mode stops at a typed failure and keeps it in the consuming function's `E`. `mode: "result"` runs every program and puts each typed outcome in a Result value instead; it doesn't turn defects or interruption into successful outcomes. Add a concurrency limit when independent jobs should all report their expected outcomes.

## Coming from Effect

Use `try` with ordinary statements for sequential work. Pass `work()` directly when a combinator expects an Effect. Use `effect { ... }` for several statements, or an effect arrow when a callback must build an Effect.
