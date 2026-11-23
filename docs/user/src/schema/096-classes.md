# Class APIs

`Schema.Class` combines validated fields, codec derivation, structural equality, and class methods on one nominal type. Use it when instances need behavior or `instanceof` identity; use `Schema.Struct` for plain records. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Declaring validated classes

```vibe
// run: const value = try readPackage({ reference: "pkg-94", pieces: "2" }); try Console.log(value instanceof Package, value.pieces)
class Package extends Schema.Class<Package>("Package")({
  reference: Schema.NonEmptyString,
  pieces: Schema.FiniteFromString
}) {}

effect function readPackage(input: unknown) {
  return try Schema.decodeUnknownEffect(Package)(input)
}
// Package!Schema.SchemaError
```

```output
true 2
```

Pass the class itself as the `Self` type parameter, a unique identifier (stored on `Package.identifier` for cross-reload identity), and its fields. This is a data class, not a VibeLang `service`.

## Constructing instances

```vibe
// run: try Console.log((try constructPackage("pkg-94", 2)).pieces, (try Effect.try(() => constructWithNew("pkg-94"))).pieces); try Effect.catch(constructPackage("", 2), (issue) => Console.log(issue._tag))
effect function constructPackage(reference: string, pieces: number) {
  return try Package.makeEffect({ reference, pieces })
}

function constructWithNew(reference: string) {
  return new Package({ reference, pieces: 1 })
}
```

```output
2 1
Composite
```

Constructors take decoded field types (`pieces: number`), apply constructor defaults, and run type-side checks:
- `new Package(...)` and `Package.make(...)` throw on invalid input.
- `Package.makeEffect(...)` fails with a raw `SchemaIssue.Issue` in Effect 4.1.1.
- A fieldless class constructs with no argument.
- Pass a checked `Schema.Struct` instead of a plain fields object to enforce cross-field invariants during both construction and decoding.

## Bypassing checks

```vibe
// run: try Console.log((try sync(() => fromVerifiedFields("", 2))).reference === "")
function fromVerifiedFields(reference: string, pieces: number) {
  return new Package({ reference, pieces }, { disableChecks: true })
}
```

```output
true
```

`{ disableChecks: true }` skips validation while still applying defaults. Use it only for values already proven valid.

## Structural equality

```vibe
// run: try Console.log(try sameContainer())
class Container extends Schema.Class<Container>("Container")({
  labels: Schema.Array(Schema.String)
}) {}

effect function sameContainer() {
  const first = try Container.makeEffect({ labels: ["cold", "sealed"] })
  const second = try Container.makeEffect({ labels: ["cold", "sealed"] })
  return Equal.equals(first, second) // true
}
```

```output
true
```

Instances implement Effect's structural `Equal` (including nested arrays and structs), while `===` remains reference identity. Do not mutate fields of instances stored in hash collections.

## Getters and methods

```vibe
// run: try Console.log(try announcePackage())
class LabeledPackage extends Schema.Class<LabeledPackage>("LabeledPackage")({
  reference: Schema.NonEmptyString
}) {
  get displayReference() {
    return this.reference.toUpperCase()
  }

  describe() {
    return `Package ${this.reference}`
  }

  effect announce() {
    try Console.log(this.describe())
  }
}

effect function announcePackage() {
  const item = try LabeledPackage.makeEffect({ reference: "pkg-94" })
  try item.announce()
  return item.displayReference
}
```

```output
Package pkg-94
PKG-94
```

Keep getters pure so formatters, checks, and compiled validators can read properties safely. Prefix effectful methods with `effect` and run them with `try`.

## Using classes as codecs

```vibe
// run: { const jsonValue = try packageWireRoundTrip([{ reference: "pkg-94", pieces: "2" }]); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const Packages = Schema.Array(Package)

effect function packageWireRoundTrip(input: unknown) {
  const packages = try Schema.decodeUnknownEffect(Packages)(input)
  return try Schema.encodeEffect(Packages)(packages)
}
```

```output
[{"reference":"pkg-94","pieces":"2"}]
```

Decoding constructs a class instance from an encoded plain object; encoding produces the encoded plain object. `Package.fields` exposes the underlying field map for composition.

## Annotations

```vibe
// run: try Console.log(Dock.identifier); try Console.log(Schema.resolveAnnotations(Dock)?.title); try Console.log((try Dock.makeEffect({ number: 2 })).number)
class Dock extends Schema.Class<Dock>("Dock")(
  { number: Schema.Int },
  { title: "Loading dock", description: "A numbered dispatch location" }
) {}
```

```output
Dock
Loading dock
2
```

Pass annotations as the second argument after the fields or struct. The class identifier doubles as its default `identifier` annotation.

## Recursive classes

```vibe
// run: const value = try readCrate({ count: "2", children: [{ count: "1", children: [] }] }); try Console.log(value instanceof Crate, value.children[0] instanceof Crate); { const jsonValue = try Schema.encodeEffect(Crate)(value); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
interface CrateWire {
  count: string
  children: ReadonlyArray<CrateWire>
}

class Crate extends Schema.Class<Crate>("Crate")({
  count: Schema.FiniteFromString,
  children: Schema.Array(
    Schema.suspend((): Schema.Codec<Crate, CrateWire> => Crate)
  )
}) {}

effect function readCrate(input: unknown) {
  return try Schema.decodeUnknownEffect(Crate)(input)
}
```

```output
true true
{"count":"2","children":[{"count":"1","children":[]}]}
```

Wrap recursive references in `Schema.suspend` with an explicit `Schema.Codec<T, E>` return type to break TypeScript's inference cycle, declaring a separate wire interface when fields transform.

## Tagged classes, schema errors, and extension

```vibe
// run: try Console.log((try Packed.makeEffect({ reference: "pkg-94" }))._tag); try Console.log((try InsuredPackage.makeEffect({ reference: "pkg-94", pieces: 2, insuredValue: 100 })).summary()); try Effect.catch(reportMissing("pkg-94"), (error) => Console.log(error._tag))
class Packed extends Schema.TaggedClass<Packed>()("Packed", {
  reference: Schema.String
}) {}

schema error MissingPackage {
  reference: string
}

class InsuredPackage extends Package.extend<InsuredPackage>("InsuredPackage")({
  insuredValue: Schema.Finite
}) {
  summary() {
    return `${this.reference}: ${this.insuredValue}`
  }
}

effect function reportMissing(reference: string) {
  throw (try MissingPackage.makeEffect({ reference }))
}
// never!(MissingPackage | SchemaIssue.Issue)
```

```output
Packed
pkg-94: 100
MissingPackage
```

- `Schema.TaggedClass`: adds a defaulted `_tag` field.
- `schema error`: compiles to a serializable `Schema.TaggedError` class; construct and `throw` it for expected failures (use plain `error` when serialization is not needed).
- `.extend(...)`: inherits fields and methods under a new unique identifier.

[Upstream page](https://effect.website/docs/v4/schema/classes)
