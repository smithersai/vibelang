# Order

`Order.Order<A>` is a synchronous total comparator `(a: A, b: A) => -1 | 0 | 1`. Use it to define one reusable ordering shared across sorting, tie-breaking, extrema selection, clamping, and range checks.

| Category | Key APIs |
| --- | --- |
| Built-in orders | `Order.String`, `Order.Number`, `Order.Boolean`, `Order.BigInt`, `Order.Date` |
| Derive & compose | `Order.mapInput(ord, project)`, `Order.combine(o1, o2)`, `Order.combineAll(ords)`, `Order.flip(ord)` |
| Predicates | `Order.isLessThan`, `Order.isLessThanOrEqualTo`, `Order.isGreaterThan`, `Order.isGreaterThanOrEqualTo`, `Order.isBetween` |
| Extrema & clamping | `Order.min`, `Order.max`, `Order.clamp` |

## Using built-in orderings

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([Order.String("amber", "violet"), Order.Number(7, 7), Order.BigInt(11n, 3n), Order.Date(new Date("2026-01-01"), new Date("2026-02-01"))])))
Order.String("amber", "violet") // -1
Order.Number(7, 7) // 0
Order.BigInt(11n, 3n) // 1
Order.Date(new Date("2026-01-01"), new Date("2026-02-01")) // -1
// Output: [-1,0,1,-1]
```

Built-in orders cover strings, numbers, booleans, bigints, and dates, returning `-1` (before), `0` (tied), or `1` (after). Total ordering assumes valid numbers and dates—`NaN` violates standard numeric order.

## Sorting values

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([sorted, input, mutableCopy])))
const input = [9, 2, 6]
const sorted = Effect.Array.sort(input, Order.Number)
// sorted: [2, 6, 9]; input: [9, 2, 6]

const mutableCopy = [...input]
mutableCopy.sort(Order.Number)
// mutableCopy: [2, 6, 9]
// Output: [[2,6,9],[9,2,6],[2,6,9]]
```

`Effect.Array.sort` returns a new sorted array, whereas `Array.prototype.sort` mutates in place; both accept any `Order` directly. Custom comparators must be synchronous and non-failing.

## Deriving comparison rules

```vibe
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

`Order.mapInput` projects each element to a comparable key and delegates to the underlying order without altering the original objects.

## Combining comparison rules

```vibe
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

`Order.combine` falls back to the second order only when the first returns `0`. Use `Order.combineAll` when chaining three or more tie-breaking criteria.

## Reversing an ordering

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(Effect.Array.sort([5, 12, 3], descending))))
const descending = Order.flip(Order.Number)
Effect.Array.sort([5, 12, 3], descending) // [12, 5, 3]
// Output: [12,5,3]
```

`Order.flip` inverts any order. Flip a single criterion before `combine` to reverse only that field, or flip the combined order to reverse every criterion.

## Checking comparisons

```vibe
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

Comparison helpers lift any `Order` into boolean predicates. Ties (`0`) count as equal under the supplied order even if uncompared object fields differ.

## Selecting extrema

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([Order.min(Order.Number)(13, 8), Order.max(Order.Number)(13, 8), Order.min(Order.flip(Order.Number))(13, 8)])))
Order.min(Order.Number)(13, 8) // 8
Order.max(Order.Number)(13, 8) // 13
Order.min(Order.flip(Order.Number))(13, 8) // 13
// Output: [8,13,13]
```

`Order.min` and `Order.max` choose according to the supplied order—so flipping an order reverses which value is considered smaller—and return the original object rather than any projected field.

## Clamping values and testing ranges

```vibe
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

`Order.clamp` snaps out-of-range inputs to the nearest inclusive bound, and `Order.isBetween` tests membership in the same `[minimum, maximum]` interval. Supply `minimum <= maximum` under the chosen order.
