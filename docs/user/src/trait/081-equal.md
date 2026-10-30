# Equal

`Equal` works in VibeLang exactly as in Effect. It compares values structurally and supports custom equality, so separately allocated values can be the same member or key in an Effect hash collection.

## Checking structural equality

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([Object.is(left, right), Equal.equals(left, right), Equal.equals([1, { n: 2 }], [1, { n: 3 }]), Equal.equals(new Set([2, 5]), new Set([5, 2]))])))
const left = { folder: "inbox", flags: ["unread", "starred"] }
const right = { folder: "inbox", flags: ["unread", "starred"] }
Object.is(left, right) // false
Equal.equals(left, right) // true
Equal.equals([1, { n: 2 }], [1, { n: 3 }]) // false
Equal.equals(new Set([2, 5]), new Set([5, 2])) // true
// Output: [false,true,false,true]
```

Effect 4 compares plain objects, arrays, maps, sets, dates, and regular expressions by content, recursing into nested values and consulting custom implementations where present. Results are cached, so treat structural values as immutable once compared or hashed.

## Implementing the equality protocol

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(Equal.equals(new DocumentRevision("doc-8", 2, "reader-a"), new DocumentRevision("doc-8", 2, "reader-b")))
class DocumentRevision implements Equal.Equal {
  constructor(
    readonly documentId: string,
    readonly revision: number,
    readonly observedBy: string
  ) {}

  [Equal.symbol](other: Equal.Equal): boolean {
    return other instanceof DocumentRevision &&
      this.documentId === other.documentId &&
      this.revision === other.revision
  }

  [Hash.symbol]() {
    return Hash.hash([this.documentId, this.revision])
  }
}

Equal.equals(
  new DocumentRevision("doc-8", 2, "reader-a"),
  new DocumentRevision("doc-8", 2, "reader-b")
) // true
// Output: true
```

`Equal.Equal` extends `Hash.Hash`, so implement both computed methods. The equality method defines which fields matter, and equal values must hash the same. Both methods leave out `observedBy`: it describes an observation, not revision identity.

Both compile to plain JavaScript methods, which callers call as ordinary methods. An effect method returns an Effect, which does not satisfy the protocol's boolean or number return type; compute the value before building the object.

## Opting into reference identity

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([Equal.equals(reference, { state: "ready" }), Equal.equals(reference, reference), Equal.equals(record, { state: "ready" }), Equal.equals(owned, { state: "ready" })])))
const record = { state: "ready" }
const reference = Equal.byReference(record)
Equal.equals(reference, { state: "ready" }) // false
Equal.equals(reference, reference) // true
Equal.equals(record, { state: "ready" }) // true

const owned = { state: "ready" }
Equal.byReferenceUnsafe(owned)
Equal.equals(owned, { state: "ready" }) // false
// Output: [false,true,true,false]
```

`byReference` returns a proxy that opts out of structural comparison and leaves the original unchanged; compare and store that proxy consistently. `byReferenceUnsafe` marks the original object permanently, without allocating a proxy.

## Using custom equality in hash-based collections

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([HashSet.size(seen), HashMap.size(byFolder), Option.getOrElse(HashMap.get(byFolder, { folder: "inbox" }), () => 0)])))
const seen = HashSet.make(
  new DocumentRevision("doc-8", 2, "reader-a"),
  new DocumentRevision("doc-8", 2, "reader-b")
)
HashSet.size(seen) // 1

const byFolder = HashMap.set(
  HashMap.set(HashMap.empty<{ folder: string }, number>(), { folder: "inbox" }, 4),
  { folder: "inbox" }, 9
)
HashMap.size(byFolder) // 1
Option.getOrElse(HashMap.get(byFolder, { folder: "inbox" }), () => 0) // 9
// Output: [1,1,9]
```

`HashSet` uses equality to deduplicate members and `HashMap` to identify keys. Plain structural keys need no custom class; implement the protocol when only some fields determine identity. JavaScript's native `Set` and `Map` ignore the protocol and keep their normal identity rules.
