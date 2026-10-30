# Chunk

`Chunk` works in VibeLang exactly as in Effect. It is an immutable sequence optimized for repeated concatenation; when concatenation is not the main workload, use an array.

## Choosing sequence storage

```vibe
// pending: VIP-5, VIP-14
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

A chunk keeps order and shares internal structure across updates, so repeated concatenation does not recopy the whole prefix. Its bookkeeping adds overhead.

## Building chunks

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([Chunk.toReadonlyArray(empty), Chunk.toReadonlyArray(pair), Chunk.toReadonlyArray(fromArray), Chunk.toReadonlyArray(fromSet)])))
const empty = Chunk.empty<string>()
const pair = Chunk.make("north", "south")
const fromArray = Chunk.fromIterable(["east", "west"])
const fromSet = Chunk.fromIterable(new Set(["center"]))
```

```output
[[],["north","south"],["east","west"],["center"]]
```

`make` returns a nonempty chunk; `empty` has no elements. `fromIterable` accepts arrays, sets, and other iterables, and reuses input arrays and existing chunks, so copy an array that other code can still mutate. Immutability covers the sequence, not mutable objects stored as elements.

## Reusing an array unsafely

```vibe
// pending: VIP-5, VIP-14
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

`fromArrayUnsafe` does not copy its input: any later mutation of that array, through any alias, breaks the chunk's immutability. For a copy, use `Chunk.fromIterable([...values])`; `fromIterable(values)` alone also reuses the array.

## Concatenating and dropping elements

```vibe
// pending: VIP-5, VIP-14
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

`appendAll` keeps both chunks' order; `drop` removes a prefix. Neither changes its inputs.

## Checking structural equality

```vibe
// pending: VIP-5, VIP-14
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

Equality compares lengths and corresponding elements by Effect's equality rules, so distinct chunks can be equal, even with separately created plain object elements. Order matters.

## Converting to arrays

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([nonempty, none, mutableCopy])))
const nonempty = Chunk.toReadonlyArray(Chunk.make(7, 8))
const none = Chunk.toReadonlyArray(Chunk.empty<number>())
const mutableCopy = [...nonempty]
mutableCopy.push(9)
```

```output
[[7,8],[],[7,8,9]]
```

`toReadonlyArray` returns a readonly view that keeps the nonempty type for a known nonempty input. Do not cast it to a mutable array; copy it with spread when JavaScript code needs mutable storage.
