# Class APIs

Schema classes work as in Effect. A class validates its fields, acts as a codec, and gives its instances domain behavior. Use one when methods or class identity help the model; use `Struct` for plain records. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Declaring validated classes

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const value = try readPackage({ reference: "pkg-94", pieces: "2" }); try Console.log(value instanceof Package, value.pieces) })
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

Pass the class itself as the `Self` type, a stable identifier, and its fields. The class extends a generated base; it is an ordinary data class, not a VibeLang service. `Package.identifier` holds the identifier, which helps Effect recognize instances across module reloads.

## Constructing and checking instances

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log((try constructPackage("pkg-94", 2)).pieces, (try Effect.try(() => constructWithNew("pkg-94"))).pieces); try Effect.catch(constructPackage("", 2), (issue) => Console.log(issue._tag)) })
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

Construction takes decoded fields, so `pieces` is a number though decoding takes a string. `new Package(...)` and `Package.make(...)` apply defaults and type-side checks and throw on invalid input; use `makeEffect` for expected failures. In local Effect 4.1.0, `makeEffect` fails with a raw `SchemaIssue.Issue`. A class with no fields constructs without an argument.

For a cross-field invariant, pass a checked `Schema.Struct` instead of a fields object; its checks apply during construction and codec use.

## Bypassing checks deliberately

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log((try sync(() => fromVerifiedFields("", 2))).reference === "") })
function fromVerifiedFields(reference: string, pieces: number) {
  return new Package({ reference, pieces }, { disableChecks: true })
}
```

```output
true
```

`disableChecks` skips validation; it neither decodes fields nor proves an untrusted value valid. Use it only when the input already satisfies the decoded model. Defaults still apply.

## Defining structural equality

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try sameContainer()) })
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

Instances support Effect's structural equality, nested arrays and objects included; JavaScript `===` still compares object identity. Keep fields stable while values are in hash collections.

## Adding getters and methods

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try announcePackage()) })
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

Getters derive synchronous values from fields; keep them pure so formatting, checks, and compiled validators can read properties safely. Mark a method `effect` when it runs Effects, as `announce` does. Calling it returns an Effect; `try` runs it.

## Using classes as codecs

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try packageWireRoundTrip([{ reference: "pkg-94", pieces: "2" }]); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
const Packages = Schema.Array(Package)

effect function packageWireRoundTrip(input: unknown) {
  const packages = try Schema.decodeUnknownEffect(Packages)(input)
  return try Schema.encodeEffect(Packages)(packages)
}
```

```output
[{"reference":"pkg-94","pieces":"2"}]
```

A class schema is a transformation: decoding a plain object creates an instance, and encoding an instance gives a plain object with encoded fields. A class fits anywhere a schema does, including arrays and nested structs. `Package.fields` exposes the original field descriptions for reuse.

## Annotating classes

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(Dock.identifier); try Console.log(Schema.resolveAnnotations(Dock)?.title); try Console.log((try Dock.makeEffect({ number: 2 })).number) })
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

Pass annotations after the fields or struct. The class identifier is also its default identifier annotation. Metadata documents the model; it adds no checks and changes no construction defaults.

## Modeling recursive classes

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const value = try readCrate({ count: "2", children: [{ count: "1", children: [] }] }); try Console.log(value instanceof Crate, value.children[0] instanceof Crate); { const jsonValue = try Schema.encodeEffect(Crate)(value); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
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

Suspend the recursive edge and annotate the callback's return type to break the inference cycle; the callback returns the codec as data and compiles to a plain JavaScript callback. Declare a separate encoded interface when fields transform. For mutual recursion, suspend the reference to the later class and state the decoded and encoded types on each recursive edge.

## Creating tagged variants and extending classes

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log((try Packed.makeEffect({ reference: "pkg-94" }))._tag); try Console.log((try InsuredPackage.makeEffect({ reference: "pkg-94", pieces: 2, insuredValue: 100 })).summary()); try Effect.catch(reportMissing("pkg-94"), (error) => Console.log(error._tag)) })
class Packed extends Schema.TaggedClass<Packed>()("Packed", {
  reference: Schema.String
}) {}

class MissingPackage extends Schema.TaggedError<MissingPackage>()("MissingPackage", {
  reference: Schema.String
}) {}

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

`TaggedClass` adds `_tag` with a constructor default. `Schema.TaggedError` also supplies Error behavior and a serializable schema. A constructed instance is data until thrown or run with `try`; `new` constructs it without running it. Throw it for an expected failure. The example's contract also keeps the constructor's issue channel: `try MissingPackage.makeEffect({ reference })` constructs the error, then `throw` fails with it. For errors that need no serialization, use an `error` declaration.

`extend` adds fields and keeps inherited behavior; give each extension its own identifier. Schema data-class inheritance is separate from service declarations, whose implementations use object literals or `implements`.

[Upstream page](https://effect.website/docs/v4/schema/classes)
