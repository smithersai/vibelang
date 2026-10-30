# Order

`Order` works in VibeLang exactly as in Effect. It defines reusable comparison rules returning `-1`, `0`, or `1`, so sorting and range checks share one definition of before, tied, and after.

## Using built-in orderings

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([Order.String("amber", "violet"), Order.Number(7, 7), Order.BigInt(11n, 3n), Order.Date(new Date("2026-01-01"), new Date("2026-02-01"))])))
Order.String("amber", "violet") // -1
Order.Number(7, 7) // 0
Order.BigInt(11n, 3n) // 1
Order.Date(new Date("2026-01-01"), new Date("2026-02-01")) // -1
// Output: [-1,0,1,-1]
```

An `Order.Order<A>` compares two A values synchronously. Built-in orders cover strings, numbers, booleans, bigints, and dates. A total order needs valid dates and numbers: `NaN` has no ordinary numeric ordering.

## Sorting values

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([sorted, input, mutableCopy])))
const input = [9, 2, 6]
const sorted = Effect.Array.sort(input, Order.Number)
// sorted: [2, 6, 9]; input: [9, 2, 6]

const mutableCopy = [...input]
mutableCopy.sort(Order.Number)
// mutableCopy: [2, 6, 9]
// Output: [[2,6,9],[9,2,6],[2,6,9]]
```

Effect's array `sort` returns a sorted copy; JavaScript's sorts its receiver in place. Both accept an order as comparator; a custom callback must be synchronous and must not fail through E.

## Deriving comparison rules

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(byPriority({ priority: 1, title: "Publish" }, { priority: 3, title: "Review" }))
interface Task {
  priority: number
  title: string
}

const byPriority = Order.mapInput(Order.Number, (task: Task) => task.priority)
const byTitle = Order.mapInput(Order.String, (task: Task) => task.title)

byPriority(
  { priority: 1, title: "Publish" },
  { priority: 3, title: "Review" }
) // -1
// Output: -1
```

`mapInput` extracts a comparable value from each operand and delegates to the underlying order, so the projection picks the field that matters. It does not mutate or transform the sorted objects.

## Combining comparison rules

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(tasks.map((task) => task.title).join(", "))
interface Task {
  priority: number
  title: string
}

const byPriority = Order.mapInput(Order.Number, (task: Task) => task.priority)
const byTitle = Order.mapInput(Order.String, (task: Task) => task.title)
const taskOrder = Order.combine(byPriority, byTitle)
const tasks = Effect.Array.sort([
  { priority: 2, title: "Review" },
  { priority: 1, title: "Publish" },
  { priority: 2, title: "Archive" }
], taskOrder)
// Publish, Archive, Review
// Output: Publish, Archive, Review
```

`combine` uses the first rule and consults the second only on a tie, so rule order sets sorting priority. For several tie-breaking fields, use `combineAll`.

## Reversing an ordering

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify(Effect.Array.sort([5, 12, 3], descending))))
const descending = Order.flip(Order.Number)
Effect.Array.sort([5, 12, 3], descending) // [12, 5, 3]
// Output: [12,5,3]
```

`flip` reverses an order. Flip one rule before combining to reverse only that criterion, or the combined order to reverse all.

## Checking comparisons

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([less(3, 7), greater(7, 3), atMost(7, 7), atLeast(7, 7)])))
const less = Order.isLessThan(Order.Number)
const greater = Order.isGreaterThan(Order.Number)
const atMost = Order.isLessThanOrEqualTo(Order.Number)
const atLeast = Order.isGreaterThanOrEqualTo(Order.Number)
less(3, 7) // true
greater(7, 3) // true
atMost(7, 7) // true
atLeast(7, 7) // true
// Output: [true,true,true,true]
```

These helpers turn an order, primitive or derived, into boolean tests. Equality here means a comparison tie, which can deliberately ignore fields.

## Selecting extrema

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([Order.min(Order.Number)(13, 8), Order.max(Order.Number)(13, 8), Order.min(Order.flip(Order.Number))(13, 8)])))
Order.min(Order.Number)(13, 8) // 8
Order.max(Order.Number)(13, 8) // 13
Order.min(Order.flip(Order.Number))(13, 8) // 13
// Output: [8,13,13]
```

`min` and `max` select by the supplied order, so a reversed order reverses their numeric meaning. With an object order they return an original object, not its projected field.

## Clamping values and testing ranges

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([clamp(4), clamp(30), clamp(70), inside(10), inside(51)])))
const bounds = { minimum: 10, maximum: 50 }
const clamp = Order.clamp(Order.Number)(bounds)
const inside = Order.isBetween(Order.Number)(bounds)
clamp(4) // 10
clamp(30) // 30
clamp(70) // 50
inside(10) // true
inside(51) // false
// Output: [10,30,50,true,false]
```

`clamp` replaces an out-of-range value with the nearest bound; `isBetween` tests the same inclusive interval. Order the bounds by the supplied order.
