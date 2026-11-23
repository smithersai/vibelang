# Equivalence

`Equivalence.Equivalence<A>` is a reusable synchronous predicate `(a: A, b: A) => boolean` defining when two values are equivalent for a specific operation. Use it when comparison rules vary by context—such as case-insensitive labels or comparing records by a single key—without altering global `Equal` semantics.

| Built-in / Combinator | Comparison rule |
| --- | --- |
| `Equivalence.String`, `Boolean`, `BigInt` | Strict equality (`===`) |
| `Equivalence.Number` | Numeric equality with `NaN` equal to `NaN` |
| `Equivalence.Date` | Compares epoch timestamps with `Equivalence.Number` |
| `Equivalence.strictEqual<A>()` | Generic strict equality (`===`) |
| `Equivalence.mapInput(eq, project)` | Projects each operand before comparing with `eq` |

## Representing a reusable equality relation

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([sameLabel(" Inbox ", "inbox"), sameLabel("inbox", "archive")])))
const sameLabel: Equivalence.Equivalence<string> = (a, b) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

sameLabel(" Inbox ", "inbox") // true
sameLabel("inbox", "archive") // false
// Output: [true,false]
```

A valid equivalence is reflexive, symmetric, and transitive. Keep it a pure synchronous function with no services or typed errors so Effect APIs can invoke it directly.

## Choosing built-in relations

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([Equivalence.String("cyan", "cyan"), Equivalence.Number(12, 13), Equivalence.Boolean(true, true), Equivalence.BigInt(5n, 5n), Equivalence.Date(new Date("2026-04-12"), new Date("2026-04-12")), sameSymbol(key, key), sameSymbol(key, Symbol("entry"))])))
Equivalence.String("cyan", "cyan") // true
Equivalence.Number(12, 13) // false
Equivalence.Boolean(true, true) // true
Equivalence.BigInt(5n, 5n) // true
Equivalence.Date(new Date("2026-04-12"), new Date("2026-04-12")) // true

const sameSymbol = Equivalence.strictEqual<symbol>()
const key = Symbol("entry")
sameSymbol(key, key) // true
sameSymbol(key, Symbol("entry")) // false
// Output: [true,false,true,true,true,true,false]
```

`String`, `Boolean`, `BigInt`, and `strictEqual` check strict equality; `Number` also treats `NaN` as equal to itself, and `Date` compares timestamps using `Number` rather than object references.

## Deriving comparisons through input projections

```vibe
// run: try Console.log(bySku({ sku: "part-4", displayName: "Bolt" }, { sku: "part-4", displayName: "Steel bolt" }))
interface Product {
  sku: string
  displayName: string
}

const bySku = Equivalence.mapInput(
  Equivalence.String,
  (product: Product) => product.sku
)

bySku(
  { sku: "part-4", displayName: "Bolt" },
  { sku: "part-4", displayName: "Steel bolt" }
) // true
// Output: true
```

`Equivalence.mapInput` lifts an existing equivalence to a larger type by projecting the key field first. An `Equivalence` applies only where explicitly passed; it never affects `===`, `Equal.equals`, or hash-collection keys.
