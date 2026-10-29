# HashSet

`HashSet` and `MutableHashSet` work in VibeLang exactly as in Effect. They store unique, unordered values by Effect's equality and hashing rules; use them for frequent membership checks and set operations.

## Choosing immutable or mutable sets

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(HashSet.has(snapshot, "red"), HashSet.has(revised, "red")); try Console.log(JSON.stringify(Array.from(buildLocal()).sort()))
const snapshot = HashSet.make("green", "blue")
const revised = HashSet.add(snapshot, "red")
HashSet.has(snapshot, "red") // false
HashSet.has(revised, "red") // true

function buildLocal() {
  const working = MutableHashSet.empty<string>()
  MutableHashSet.add(working, "green")
  MutableHashSet.add(working, "blue")
  return HashSet.fromIterable(working)
}
```

```output
false true
["blue","green"]
```

Immutable updates keep earlier versions, so snapshots suit sharing between fibers. Mutable sets update in place and suit local accumulation with one owner. For indexed access or required insertion order, use an array; for key-value pairs, a hash map.

## Equality and uniqueness

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(Equal.equals(a, b), HashSet.size(HashSet.make(a, b)), new Set([a, b]).size)
const a = { region: "west", active: true }
const b = { region: "west", active: true }
Equal.equals(a, b) // true
HashSet.size(HashSet.make(a, b)) // 1
new Set([a, b]).size // 2
```

```output
true 1 2
```

Plain objects compare structurally in Effect 4.0.6, so separately allocated records can count as one member. Every compared field matters: different request IDs make two records distinct. Custom equality uses `Equal.Equal` with a consistent `Hash.Hash`; keep members immutable after insertion so their hashes stay valid.

## Constructing and changing immutable sets

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify([Array.from(initial).sort(Order.Number), Array.from(changed).sort(Order.Number), Array.from(together).sort(Order.Number), Array.from(common).sort(Order.Number), Array.from(exclusive).sort(Order.Number), Array.from(large).sort(Order.Number), Array.from(labels).sort(), sum, HashSet.size(empty)]))
const empty = HashSet.empty<number>()
const initial = HashSet.fromIterable([2, 4, 4, 6])
const changed = HashSet.remove(HashSet.add(initial, 8), 2)
const other = HashSet.make(6, 10)
const together = HashSet.union(changed, other)
const common = HashSet.intersection(changed, other)
const exclusive = HashSet.difference(changed, other)
const large = HashSet.filter(together, (n) => n > 5)
const labels = HashSet.map(large, (n) => `item-${n}`)
const sum = HashSet.reduce(initial, 0, (total, n) => total + n)
```

```output
[[2,4,6],[4,6,8],[4,6,8,10],[6],[4,8],[6,8,10],["item-10","item-6","item-8"],12,0]
```

`empty`, `make`, and `fromIterable` construct sets. `add`, `remove`, union, intersection, and difference return new sets, so composing those operations never changes the original.

## Querying membership and size

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(HashSet.has(allowed, "write"), HashSet.size(allowed), HashSet.some(allowed, (name) => name.startsWith("a")), HashSet.every(allowed, (name) => name.length > 0), HashSet.isSubset(HashSet.make("read"), allowed))
const allowed = HashSet.make("read", "write", "audit")
HashSet.has(allowed, "write") // true
HashSet.size(allowed) // 3
HashSet.some(allowed, (name) => name.startsWith("a")) // true
HashSet.every(allowed, (name) => name.length > 0) // true
HashSet.isSubset(HashSet.make("read"), allowed) // true
```

```output
true 3 true true true
```

`has` tests one member; `size` counts unique members. `some` and `every` run predicates over members; `isSubset` tests whether one set is contained in another. Traversal order is unspecified.

## Updating mutable sets

```vibe
// pending: VIP-5, VIP-14
// run: const result = uniqueRegions(["west", "west", ""]); try Console.log(result.count, result.containsUnknown, JSON.stringify(result.values.sort()))
function uniqueRegions(regions: ReadonlyArray<string>) {
  const seen = MutableHashSet.fromIterable(regions)
  MutableHashSet.add(seen, "unknown")
  MutableHashSet.remove(seen, "")
  const count = MutableHashSet.size(seen)
  const containsUnknown = MutableHashSet.has(seen, "unknown")
  const values = Array.from(seen)
  MutableHashSet.clear(seen)
  return { count, containsUnknown, values }
}
```

```output
2 true ["unknown","west"]
```

`MutableHashSet` also has `make`, `empty`, and `fromIterable`; its `add`, `remove`, and `clear` change the set in place. Keep mutation inside one owned operation; a mutable collection alone does not coordinate concurrent workflows.

## Balancing performance and persistence

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify(snapshots([2, 2, 4]).map((set) => HashSet.size(set))))
function snapshots(values: ReadonlyArray<number>) {
  let current = HashSet.empty<number>()
  const history = [current]
  for (const value of values) {
    current = HashSet.add(current, value)
    history.push(current)
  }
  return history
}
```

```output
[0,1,1,2]
```

Persistent sets share storage between versions; mutable sets skip that allocation when you need no earlier versions. With well-distributed hashes, lookup, insertion, and removal cost near-constant time on average; traversals and set-wide operations scale with the members visited. Poor custom hashes add collision work, so measure the real workload instead of assuming constant time.

## Converting to JavaScript collections

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(JSON.stringify([array.sort(), copy.sort(), Array.from(native).sort()])); try report()
const regions = HashSet.make("west", "east")
const array = Array.from(regions)
const copy = [...regions]
const native = new Set(regions)

effect function report() {
  for (const region of Array.from(regions).sort()) try Console.log(region)
}
```

```output
[["east","west"],["east","west"],["east","west"]]
east
west
```

Both variants implement `Iterable`, so spread, `Array.from`, and `for...of` work. A native set uses JavaScript equality from then on: conversion does not carry Effect's equality over. Avoid repeated array conversions in hot loops.
