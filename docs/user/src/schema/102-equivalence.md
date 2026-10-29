# Schema to Equivalence

Schema-derived equivalence works exactly as in Effect. It compares decoded values by a schema's structure, for domain comparisons and round-trip checks, and neither decodes nor validates them. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Deriving equality from schemas

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-15, VIP-26
// run: await runPromise(effect { try Console.log(try sameShipment({ reference: "pkg-94", stops: ["east"], extra: 1 }, { reference: "pkg-94", stops: ["east"], extra: 2 })); try Console.log(try sameShipment({ reference: "pkg-94", stops: ["east"] }, { reference: "pkg-94", stops: ["west"] })) })
schema Shipment {
  reference: string
  stops: ReadonlyArray<string>
}

effect function sameShipment(left: unknown, right: unknown) {
  const a = try Schema.decodeUnknownEffect(Shipment)(left)
  const b = try Schema.decodeUnknownEffect(Shipment)(right)
  return Schema.toEquivalence(Shipment)(a, b)
}
```

```output
true
false
```

`toEquivalence` derives a comparison for the schema's decoded type, comparing arrays and nested structs recursively. For a nonempty struct, only the schema's fields participate; unmodeled fields add no equality conditions. Decode untrusted inputs before comparing them.

## Handling broad schemas and custom declarations

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(sameUnknown({ stops: ["east"] }, { stops: ["east"] })); try Console.log(sameRef()) })
function sameUnknown(left: unknown, right: unknown) {
  return Schema.toEquivalence(Schema.Unknown)(left, right)
}

class ShipmentRef {
  constructor(readonly id: string, readonly label: string) {}
}
const ShipmentRefSchema = Schema.instanceOf(ShipmentRef, {
  toEquivalence: () => (left, right) => left.id === right.id
})

function sameRef() {
  const morning = new ShipmentRef("ref-61", "morning")
  const afternoon = new ShipmentRef("ref-61", "afternoon")
  return Schema.toEquivalence(ShipmentRefSchema)(morning, afternoon) // true
}
```

```output
true
true
```

`Any`, `Unknown`, `ObjectKeyword`, and the empty struct use `Equal.equals`, with its structural handling of arrays and objects. Opaque declarations default to it too; add a `toEquivalence` annotation when domain identity follows one field. Parameterized declarations receive the derived comparator for each type parameter.

## Overriding generated comparison behavior

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(sameIdentity({ reference: "pkg-94", stops: ["east"] }, { reference: "pkg-94", stops: ["west"] })); try Console.log(sameIdentity({ reference: "pkg-94", stops: [] }, { reference: "pkg-95", stops: [] })) })
const ShipmentIdentity = Shipment.pipe(Schema.overrideToEquivalence(
  () => (left, right) => left.reference === right.reference
))

function sameIdentity(left: typeof Shipment.Type, right: typeof Shipment.Type) {
  return Schema.toEquivalence(ShipmentIdentity)(left, right)
}
```

```output
true
false
```

`overrideToEquivalence` replaces the comparison derived at that schema node; this one ignores stops on purpose. Keep custom comparisons reflexive, symmetric, and transitive, or consumers cannot treat them as an equivalence relation. A comparator callback is synchronous; don't call services or perform effects in it.

[Upstream page](https://effect.website/docs/v4/schema/equivalence)
