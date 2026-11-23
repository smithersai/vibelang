# Chunk

`Chunk` is an immutable sequence optimized for repeated concatenation and structural sharing. Use it when assembling streams or batches through repeated appends; for ordinary indexed lists without heavy concatenation, prefer a standard array.

| Operation | Purpose |
| --- | --- |
| `empty()`, `make(...xs)`, `fromIterable(it)` | Construct empty, nonempty, or iterable-backed chunks |
| `fromArrayUnsafe(arr)` | Wrap an array without copying (caller relinquishes mutation) |
| `appendAll(a, b)`, `drop(c, n)` | Concatenate or slice without mutating inputs |
| `Equal.equals(a, b)` | Order-sensitive structural equality |
| `toReadonlyArray(c)` | Return a readonly array view preserving nonemptiness in types |

## Choosing sequence storage

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(Chunk.toReadonlyArray(collectBatches([["queued"], ["running", "done"]])))))
function collectBatches(batches: ReadonlyArray<ReadonlyArray<string>>) {
  let result = Chunk.empty<string>()
  for (const batch of batches) {
    result = Chunk.appendAll(result, Chunk.fromIterable(batch))
  }
  return result
}
```

```output
["queued","running","done"]
```

`Chunk` shares internal structure across updates so repeated concatenation avoids copying the accumulated prefix. That structural tree carries bookkeeping overhead, so reserve `Chunk` for concatenation-heavy workloads or APIs that expect it.

## Building chunks

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([Chunk.toReadonlyArray(empty), Chunk.toReadonlyArray(pair), Chunk.toReadonlyArray(fromArray), Chunk.toReadonlyArray(fromSet)])))
const empty = Chunk.empty<string>()
const pair = Chunk.make("north", "south")
const fromArray = Chunk.fromIterable(["east", "west"])
const fromSet = Chunk.fromIterable(new Set(["center"]))
```

```output
[[],["north","south"],["east","west"],["center"]]
```

`Chunk.make` produces a typed nonempty chunk and `Chunk.empty` produces an empty one. `Chunk.fromIterable` reuses input arrays and existing chunks without copying, so spread mutable arrays first (`[...arr]`) if other code still mutates them; immutability protects the sequence, not mutable elements inside it.

## Reusing an array unsafely

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(Chunk.toReadonlyArray(ownedBatch()))))
function ownedBatch() {
  const values = ["queued", "running"]
  return Chunk.fromArrayUnsafe(values)
  // Ownership is handed to the chunk. Never mutate values afterward.
}
```

```output
["queued","running"]
```

`Chunk.fromArrayUnsafe` wraps an array directly with zero copy; mutating that array through any alias afterward breaks the chunk's immutability. Copy explicitly with `Chunk.fromIterable([...values])` when the source array may still change.

## Concatenating and dropping elements

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([Chunk.toReadonlyArray(original), Chunk.toReadonlyArray(remaining)])))
const original = Chunk.make("draft", "review")
const extended = Chunk.appendAll(original, Chunk.make("published"))
const remaining = Chunk.drop(extended, 1)
Chunk.toReadonlyArray(original) // ["draft", "review"]
Chunk.toReadonlyArray(remaining) // ["review", "published"]
```

```output
[["draft","review"],["review","published"]]
```

`Chunk.appendAll` preserves both operands' order and `Chunk.drop` discards leading elements. Neither mutates its inputs.

## Checking structural equality

```vibe
// run: try Console.log(Equal.equals(first, same), Equal.equals(first, reversed))
const first = Chunk.make({ code: "A" }, { code: "B" })
const same = Chunk.make({ code: "A" }, { code: "B" })
const reversed = Chunk.make({ code: "B" }, { code: "A" })
Equal.equals(first, same) // true
Equal.equals(first, reversed) // false
```

```output
true false
```

`Equal.equals` compares chunks by length and element-by-element structural equality, including separately allocated plain objects. Element order is significant.

## Converting to arrays

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([nonempty, none, mutableCopy])))
const nonempty = Chunk.toReadonlyArray(Chunk.make(7, 8))
const none = Chunk.toReadonlyArray(Chunk.empty<number>())
const mutableCopy = [...nonempty]
mutableCopy.push(9)
```

```output
[[7,8],[],[7,8,9]]
```

`Chunk.toReadonlyArray` returns a readonly view that retains the nonempty array type for nonempty chunks. Never cast the result to a mutable array; copy it with `[...view]` whenever JavaScript code requires mutation.
