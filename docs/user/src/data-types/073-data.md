# Data

A `data` declaration declares a tagged union: Effect's own `Data.TaggedEnum` type and the `Data.taggedEnum` constructors, under one name, which `match` takes apart. The rest of `Data` works in VibeLang exactly as in Effect: use it for classes and errors with Effect's equality and hashing.

## Declaring tagged unions with data

```vibe
// pending: VIP-5, VIP-7, VIP-14, VIP-16
// run: try Console.log(describe(Delivery.Waiting())); try Console.log(describe(sent)); try Console.log(describe(Delivery.Rejected({ reason: "address missing" }))); try Console.log(Equal.equals(sent, Delivery.Sent({ tracking: "parcel-8" })))
data Delivery {
  Waiting
  Sent { tracking: string }
  Rejected { reason: string; note?: string }
}

const sent = Delivery.Sent({ tracking: "parcel-8" })

function describe(delivery: Delivery) {
  return match (delivery) {
    when { _tag: "Waiting" }: "Waiting for dispatch";
    when { _tag: "Sent", let tracking }: `Tracking: ${tracking}`;
    when { _tag: "Rejected", let reason }: `Rejected: ${reason}`;
  }
}
```

```output
Waiting for dispatch
Tracking: parcel-8
Rejected: address missing
true
```

A variant without fields is a bare name. A variant with fields lists them in braces as an `error` does, `name: Type` or `name?: Type`, and they are readonly. A new line or `;` separates variants and fields; a comma is EK1013. `Delivery.Sent({ tracking })` and `Delivery.Waiting()` build values: plain records with a `_tag`, which compare and hash by their fields.

`when { _tag: "Sent", let tracking }` tests the variant and binds `tracking`, and `delivery is { _tag: "Sent" }` tests it in a condition. `match` is exhaustive: without a `default` arm, a match that leaves out a variant is a compile error (EK4701). See [Pattern matching with match and is](../vibelang-features/116-match-and-is.md#data-variants).

Support for the new object patterns arrives with the compiler's VIP implementation.

## Generic data types

```vibe
// pending: VIP-5, VIP-7, VIP-14, VIP-16, VIP-28
// run: try Console.log(JSON.stringify([loaded, failed, idle])); try Console.log(count(loaded), count(idle))
data LoadState<A, E> {
  Idle
  Loaded { value: A }
  Failed { error: E }
}

const loaded = LoadState.Loaded({ value: ["one", "two"] })
const failed = LoadState.Failed({ error: "offline" })
const idle = LoadState.Idle()

function count(state: LoadState<ReadonlyArray<string>, string>) {
  return match (state) {
    when { _tag: "Loaded", let value }: value.length;
    default: 0;
  }
}
```

```output
[{"value":["one","two"],"_tag":"Loaded"},{"error":"offline","_tag":"Failed"},{"_tag":"Idle"}]
2 0
```

A data type takes up to four type parameters, which the constructors infer from their arguments. A recursive data type, such as `data Tree<A> { Leaf { value: A }; Node { left: Tree<A>; right: Tree<A> } }`, works too.

## What data declares

`data Delivery { ... }` declares what Effect's documentation writes for a tagged union, so TypeScript code that imports `Delivery` gets Effect's types, `Delivery.$is` and `Delivery.$match`:

```ts effect
import { Data } from "effect"

type Delivery = Data.TaggedEnum<{
  Waiting: {}
  Sent: { readonly tracking: string }
  Rejected: { readonly reason: string; readonly note?: string }
}>
const Delivery = Data.taggedEnum<Delivery>()
```

Declaration files write the constant's type out, `Data.TaggedEnum.Constructor<Delivery>`, which is what `Data.taggedEnum<Delivery>()` returns. A generic data type passes its type parameters through the interface `Data.TaggedEnum.WithGenerics` describes, named for the type: `LoadStateDefinition`, which `export data` exports with the type and the constructors.

```ts effect
import { Data } from "effect"

type LoadState<A, E> = Data.TaggedEnum<{
  Idle: {}
  Loaded: { readonly value: A }
  Failed: { readonly error: E }
}>
interface LoadStateDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: LoadState<this["A"], this["B"]>
}
const LoadState = Data.taggedEnum<LoadStateDefinition>()
```

## Creating values with structural equality

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(Equal.equals(first, second), Equal.equals(["inbox", 5] as const, ["inbox", 5] as const), Equal.equals([2, 4, 6], [2, 4, 6]), Equal.equals(makeRoute("inbox"), makeRoute("inbox")))
const first = { route: "inbox", filters: { unread: true } }
const second = { route: "inbox", filters: { unread: true } }
Equal.equals(first, second) // true
Equal.equals(["inbox", 5] as const, ["inbox", 5] as const) // true
Equal.equals([2, 4, 6], [2, 4, 6]) // true

function makeRoute(name: string) {
  return { _tag: "Route" as const, name }
}
Equal.equals(makeRoute("inbox"), makeRoute("inbox")) // true
```

```output
true true true true
```

In Effect 4, plain records, tuples, arrays, maps, and sets already compare structurally, nested values included, without a `Data` wrapper. Treat compared data as immutable: equality and hashing cache information about objects.

## Building ordinary and tagged classes

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(label.upper, Equal.equals(label, new Label({ text: "pending" })), new Archived({ documentId: "doc-3" })._tag)
class Label extends Data.Class<{ text: string }> {
  get upper() { return this.text.toUpperCase() }
}

class Archived extends Data.TaggedClass("Archived")<{
  documentId: string
}> {}

const label = new Label({ text: "pending" })
label.upper // "PENDING"
Equal.equals(label, new Label({ text: "pending" })) // true
new Archived({ documentId: "doc-3" })._tag // "Archived"
```

```output
PENDING true Archived
```

`Class` supplies a constructor taking a field object, plus equality and hashing; `TaggedClass` adds a fixed `_tag` for narrowing union members. These concrete data classes are separate from services declared with `service`.

## Writing a tagged union out with Data.TaggedEnum

Effect's long form works in a `.vibe` file too, with the same `$is` and `$match`:

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(isSent(sent)); try Console.log(describe(waiting)); try Console.log(describe(sent)); try Console.log(describe(rejected))
type Delivery = Data.TaggedEnum<{
  Waiting: {}
  Sent: { tracking: string }
  Rejected: { reason: string }
}>

const Delivery = Data.taggedEnum<Delivery>()
const sent = Delivery.Sent({ tracking: "parcel-8" })
const waiting = Delivery.Waiting()
const rejected = Delivery.Rejected({ reason: "address missing" })
const isSent = Delivery.$is("Sent")
isSent(sent) // true

const describe = Delivery.$match({
  Waiting: () => "Waiting for dispatch",
  Sent: ({ tracking }) => `Tracking: ${tracking}`,
  Rejected: ({ reason }) => `Rejected: ${reason}`
})
describe(sent) // "Tracking: parcel-8"
```

```output
true
Waiting for dispatch
Tracking: parcel-8
Rejected: address missing
```

`TaggedEnum` describes the union as a map from tags to payloads. `taggedEnum` creates constructors that insert `_tag`, a `$is` guard factory, and a `$match` helper requiring a case per variant. Match callbacks compute values synchronously; for service work, use `match` inside an effect function, whose arms can run Effects with `try`.

## Writing generic union cases out

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify([loaded, failed, idle]))
type LoadState<A, E> = Data.TaggedEnum<{
  Idle: {}
  Ready: { value: A }
  Failed: { error: E }
}>

interface LoadStateDefinition extends Data.TaggedEnum.WithGenerics<2> {
  taggedEnum: LoadState<this["A"], this["B"]>
}

const LoadState = Data.taggedEnum<LoadStateDefinition>()
const loaded = LoadState.Ready({ value: ["one", "two"] })
const failed = LoadState.Failed({ error: "offline" })
const idle = LoadState.Idle()
```

```output
[{"value":["one","two"],"_tag":"Ready"},{"error":"offline","_tag":"Failed"},{"_tag":"Idle"}]
```

`WithGenerics<2>` gives the definition two type parameters, `A` and `B`; the constructors infer payload types per call. Keep the generic definition in a type or interface; it is not a generic service class.

## Errors

| Code | Cause | Fix |
| --- | --- | --- |
| EK2122 | A `data` declaration without variants | Write at least one variant |
| EK2123 | A variant declared twice | Rename one, or remove the second |
| EK2124 | A variant named `$is` or `$match`, a field named `_tag`, or another declaration of a generic data type's `NameDefinition` | Rename it: the constructors object has its own `$is` and `$match`, and the constructor sets `_tag` |
| EK2125 | A variant member that is not a field: a method, a signature, a field without a type, or a `mutable` field | Write `name: Type` or `name?: Type` |
| EK2126 | More than four type parameters, or a constrained one | Use at most four unconstrained type parameters |
| EK2127 | `Delivery.Snet`, a name that is not one of the data type's variants | Use one of the variants the message lists |

## Defining ordinary and tagged errors

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-7, VIP-13, VIP-14
// run: try Console.log(new InvalidDocument({ message: "invalid", line: 3 }).line); try Console.log(JSON.stringify([try documentOrDraft("doc-3"), try documentOrDraft("")])); try Console.log(requireDocument("") catch (error) => error._tag)
class InvalidDocument extends Data.Error<{
  message: string
  line: number
}> {}

error DocumentMissing {
  id: string
}

effect requireDocument(id: string) {
  if (id === "") throw new DocumentMissing({ id })
  return { id }
}
// { id: string }!DocumentMissing!

effect documentOrDraft(id: string) {
  return requireDocument(id) catch (error) => match (error) {
    when DocumentMissing: ({ id: "draft" });
  }
}
```

```output
3
[{"id":"doc-3"},{"id":"draft"}]
DocumentMissing
```

`Data.Error` creates a native error with extra fields. An `error` declaration creates Effect's `Data.TaggedError` class, which fills in `_tag`; `throw` inside an effect function raises it as an expected failure. Use `Schema.TaggedError` when the error needs a schema for serialization.

## Preserving native error causes

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(JSON.stringify(try decodeDocument("{\"id\":3}"))); try Console.log(decodeDocument("{") catch (error) => `${error._tag} ${error.cause instanceof SyntaxError}`)
error DocumentDecodeError {
  cause: unknown
}

effect decodeDocument(text: string) {
  return try Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) => new DocumentDecodeError({ cause })
  })
}
// any!DocumentDecodeError!
```

```output
{"id":3}
DocumentDecodeError true
```

A `cause` field keeps the original exception through native error-cause support; it is not Effect's `Cause`, which describes a whole execution failure. Keep the original error for diagnosis, and keep document contents and credentials out of diagnostic fields.

## Coming from Effect

Raise a data error with `throw new DocumentMissing({ id })`; ordinary error propagation needs no generator yield or `Effect.fail`.
