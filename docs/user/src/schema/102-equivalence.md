# Schema to Equivalence

`Schema.toEquivalence` derives a structural equality predicate for a schema's decoded type. It compares already-decoded values without validating or transforming them. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Deriving structural equality

```vibe
// run: try Console.log(try sameShipment({ reference: "pkg-94", stops: ["east"], extra: 1 }, { reference: "pkg-94", stops: ["east"], extra: 2 })); try Console.log(try sameShipment({ reference: "pkg-94", stops: ["east"] }, { reference: "pkg-94", stops: ["west"] }))
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

Derived comparators traverse structs, tuples, arrays, and unions recursively. On a nonempty struct, only declared fields are compared—unmodeled keys are ignored. Decode untrusted inputs before comparing.

## Broad schemas and custom declarations

```vibe
// run: try Console.log(sameUnknown({ stops: ["east"] }, { stops: ["east"] })); try Console.log(sameRef())
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

`Any`, `Unknown`, `ObjectKeyword`, empty structs, and unannotated declarations delegate to `Equal.equals`. Add `toEquivalence` on an opaque declaration for domain-specific equality; parameterized declarations receive each parameter's derived comparator.

## Overriding a node's comparator

```vibe
// run: try Console.log(sameIdentity({ reference: "pkg-94", stops: ["east"] }, { reference: "pkg-94", stops: ["west"] })); try Console.log(sameIdentity({ reference: "pkg-94", stops: [] }, { reference: "pkg-95", stops: [] }))
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

`Schema.overrideToEquivalence` replaces equality for a specific schema node. Custom comparators must be synchronous, pure, reflexive, symmetric, and transitive.

[Upstream page](https://effect.website/docs/v4/schema/equivalence)
