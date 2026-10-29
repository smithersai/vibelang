# Equivalence

`Equivalence` works in VibeLang exactly as in Effect. It packages a reusable rule for whether two values count as equivalent in one operation.

## Representing a reusable equality relation

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify([sameLabel(" Inbox ", "inbox"), sameLabel("inbox", "archive")]))
const sameLabel: Equivalence.Equivalence<string> = (a, b) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

sameLabel(" Inbox ", "inbox") // true
sameLabel("inbox", "archive") // false
// Output: [true,false]
```

An `Equivalence.Equivalence<A>` is a synchronous function from two A values to a boolean. A sound relation is reflexive, symmetric, and transitive. Keep it free of service calls and expected failures so Effect can call it as a plain JavaScript callback.

## Choosing built-in relations

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify([Equivalence.String("cyan", "cyan"), Equivalence.Number(12, 13), Equivalence.Boolean(true, true), Equivalence.BigInt(5n, 5n), Equivalence.Date(new Date("2026-04-12"), new Date("2026-04-12")), sameSymbol(key, key), sameSymbol(key, Symbol("entry"))]))
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

The string, boolean, bigint, and `strictEqual` relations use strict equality; `Equivalence.Number` also equates `NaN` with itself. The date relation compares timestamps with that numeric relation, not object references.

## Deriving comparisons through input projections

```vibe
// pending: VIP-5, VIP-14
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

`mapInput` projects each operand before applying the relation, so here only the SKU counts. Pass the rule to an API that accepts an equivalence; it does not change `Equal.equals`, JavaScript `===`, or hash-collection keys.
