# Hash

`Hash` computes a numeric bucket fingerprint for Effect's equality-aware collections (`HashSet`, `HashMap`). Implement `[Hash.symbol]` whenever you implement `Equal.Equal` so equal instances always hash identically.

| Rule | Requirement |
| --- | --- |
| Consistency | `Equal.equals(a, b)` implies `Hash.hash(a) === Hash.hash(b)` |
| Return type | `[Hash.symbol]()` must synchronously return a `number` (never an effect method) |
| Stability | Never mutate fields included in the hash after inserting into a collection |

## Connecting hashing to equality

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([Equal.equals(first, same), Hash.hash(first) === Hash.hash(same)])))
const first = { section: "billing", page: 2 }
const same = { section: "billing", page: 2 }
Equal.equals(first, same) // true
Hash.hash(first) === Hash.hash(same) // true
// Output: [true,true]
```

Equal values must produce identical hashes, though distinct values may collide in the same bucket (collections confirm matches with `Equal.equals`). Treat hashes as in-memory lookup hints, never as cryptographic digests or persistent identifiers.

## Implementing the hashing protocol

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([Hash.hash(new GridCell(3, 7)) === Hash.hash(new GridCell(3, 7)), Equal.equals(new GridCell(3, 7), new GridCell(3, 8))])))
class GridCell implements Equal.Equal {
  constructor(readonly row: number, readonly column: number) {}

  [Equal.symbol](other: Equal.Equal): boolean {
    return other instanceof GridCell &&
      this.row === other.row && this.column === other.column
  }

  [Hash.symbol]() {
    return Hash.hash([this.row, this.column])
  }
}

Hash.hash(new GridCell(3, 7)) === Hash.hash(new GridCell(3, 7)) // true
Equal.equals(new GridCell(3, 7), new GridCell(3, 8)) // false
// Output: [true,false]
```

`Hash.hash` accepts primitives and structural tuples, so delegating `[Hash.symbol]()` to `Hash.hash([field1, field2])` is usually sufficient. Because `Equal.Equal` extends `Hash.Hash`, `[Hash.symbol]()` must be a synchronous plain method returning a `number`.

## Keeping equal values hash-consistent

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([HashSet.size(cells), Hash.hash(first) === Hash.hash(equivalent)])))
const first = new GridCell(3, 7)
const equivalent = new GridCell(3, 7)
const cells = HashSet.make(first, equivalent)
HashSet.size(cells) // 1
Hash.hash(first) === Hash.hash(equivalent) // true
// Output: [1,true]
```

Hash only fields compared by `[Equal.symbol]`: including an ignored field places equal values in different buckets and breaks lookup, whereas omitting an identity field remains correct at the cost of extra collisions. Keep hashed fields immutable after insertion because hashes may be cached.
