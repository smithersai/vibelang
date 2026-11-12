# VIP-44: Durable values

**Status:** accepted by Will, 2026-11-06. Nothing is implemented. This is the first durable execution VIP. The design is decided bottom-up, one layer at a time.

## Will's words

> "we shouldn't reinvent the wheel here we just use rpc"

> "it would be nice for Date to work it would be nice for bigint to work"

> "I would prefer to support everything superjson supports or even better make this a service that is pluggable like trpc does so this can be encoded ore decoded however you inject"

> "Perfect make sure we document it please in the official docs"

**One sentence.** A value crosses a durable boundary through its Schema: a fixed pipeline gives it an identity, and an injected serializer decides how it is stored and sent.

**One paragraph.** A durable system does three things with a value: it saves it to a journal, hashes it into a cache key or run id, and sends it to another machine. This VIP defines which values can do that and how. It adds no syntax. The compiler derives a Schema from the declared types, then generates calls to `@smthrs/canonical`, `@smthrs/keys` and Effect's `RpcSerialization`. `schema` gains `Date`, `URL`, `RegExp`, `Uint8Array`, `Error`, `ReadonlySet` and `ReadonlyMap`, so VibeLang covers the types superjson covers without depending on superjson.

## Decision

A durable boundary is any input, output or error of a `task` or `workflow`, and any payload, result or error of an Rpc. `task` and `workflow` are defined by [later durable execution VIPs](0055-durable-tasks-workflows.md).

```ts
// proposed
schema Order { id: string; at: Date; cents: bigint; tags: ReadonlySet<string> }
schema Receipt { id: string }
schema error Declined { reason: string }

task Charge {
  effect call(order: Order): Receipt!Declined { ... }
}
```

Every type at a durable boundary must have a schema form under [VIP-15](0015-schema-declarations.md). A type with no schema form is `EK2109`, the error `schema` already reports. Errors follow the same rule, because a journal replays a recorded failure. `PlatformError` has no codec, so a task maps it to a `schema error` before returning.

## Schema mapping

This amends VIP-15. Each row is written from the TypeScript type, as VIP-15's mapping is.

| Type | Schema | JSON form | Today |
| --- | --- | --- | --- |
| `bigint` | `Schema.BigInt` | `"12345"` | Maps |
| `undefined` | `Schema.Undefined` | `null` | Maps |
| `Date` | `Schema.Date` | `"1970-01-01T00:00:00.000Z"` | `EK2109` |
| `URL` | `Schema.URL` | `"https://x.dev/a"` | `EK2109` |
| `RegExp` | `Schema.RegExp` | `{"source":"a.b","flags":"gi"}` | `EK2109` |
| `Uint8Array` | `Schema.Uint8Array` | `"AQI="` | `EK2109` |
| `Error` | `Schema.Defect().pipe(Schema.refine((u): u is Error => u instanceof Error))` | `{"name":"Error","message":"boom"}` | `EK2109` |
| `ReadonlySet<T>` | `Schema.ReadonlySet(S)` | An array | `EK2109` |
| `ReadonlyMap<K, V>` | `Schema.ReadonlyMap(K, V)` | An array of pairs | `EK2109` |

`Set<T>` and `Map<K, V>` stay `EK2109`, with a note that names the read-only form. Effect has no mutable Set or Map schema, and VIP-15's mappings mirror TypeScript, mutability included. A later VIP can accept them without breaking code.

These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do. A shadowing declaration supplies no schema.

```ts
// proposed
schema Order { id: string; at: Date; tags: ReadonlySet<string> }

// exactly this Effect TS
const Order = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  at: Schema.mutableKey(Schema.Date),
  tags: Schema.mutableKey(Schema.ReadonlySet(Schema.String)),
})
type Order = typeof Order.Type
```

This turns an error into accepted code, so it is not a retirement.

## Identity is fixed

Identity decides what counts as the same input. The durable engine these packages come from derives it today in `flow/src/Flow/ExecutionIds.ts`:

```ts
// fragment
Schema.encodeEffect(Schema.toCodecJson(flow.payloadSchema))(payload).pipe(
  Effect.flatMap((encoded) => Schema.decodeUnknownEffect(DerivedKey)(encoded))
)
```

`DerivedKey` serializes through `Canonical`, which is RFC 8785, and hashes with SHA-256. VibeLang generates the same pipeline with one added step:

```ts
// proposed
import { sortCollections } from "@smthrs/canonical"
import { DerivedKey } from "@smthrs/keys"

const snapshot = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  Schema.encodeEffect(Schema.toCodecJson(schema))(sortCollections(value))

const identity = (encoded: unknown) =>
  Schema.decodeUnknownEffect(DerivedKey)(encoded)
```

The step is needed because `Schema.ReadonlySet` encodes in insertion order, and `Canonical` sorts object keys but keeps array order:

```ts
// proposed
spawn Release(new Set(["a", "b"]))
spawn Release(new Set(["b", "a"]))   // equal inputs, so this joins the first run
```

- `sortCollections` copies a value with each `Set`'s entries and each `Map`'s entries in sorted order, at every depth.
- Entries are ordered by a stable text rank of their sorted value, compared in UTF-16 code units. A `Map` orders by key.
- Arrays keep their order, because array order is meaningful.
- `Canonical` already sorts object keys, so `sortCollections` does not need to.
- A durable call hands `call` the value decoded from `snapshot`. The hash therefore covers exactly what the body sees.
- An encoding failure at a durable call is a defect, as `flow/src/Interpreter.ts` treats a payload today. An invalid `Date` has no encoding, so it fails this way.
- Identity never goes through `RpcSerialization`.

Later VIPs combine this hash with an address to form run ids and cache keys.

## Representation is injected

Stored and sent bytes go through Effect's `RpcSerialization`, the same service Rpc uses. It is Effect's equivalent of tRPC's `transformer`, and it receives the Schema.

```ts
// fragment
export class RpcSerialization extends Context.Service<RpcSerialization, {
  makeUnsafe(): Parser
  readonly contentType: string
  readonly includesFraming: boolean
  readonly codecFor: CodecFor
}>()("effect/rpc/RpcSerialization") {}
```

```ts
// proposed
provide RpcSerialization.layerNdjson {
  try Release(source)
}
```

```text
value ─ sortCollections ─┬─ toCodecJson ─ Canonical ─ SHA-256 ─► identity        fixed
                         └─ RpcSerialization ───────────────────► journal, wire  injected
```

- The default is `RpcSerialization.layerJson`.
- A project can provide any implementation of the service, including one built on superjson.
- Rpc messages are not hashed, so they are not sorted. They stay as Effect Rpc sends them.
- A type-specific codec is an ordinary Schema with its own codec, which covers what superjson's `registerCustom` does.

### Stored values

A stored value is an Rpc frame: a result is an `Exit` frame, and an input is a `Request` frame. `Parser` is built over Rpc's message schema, so a bare record fails on four of Effect's six serializers, and a frame works on all six.

```ts
// fragment
const encodeExit = (s, schema, exit) =>
  bytes(s.makeUnsafe().encode({
    _tag: "Exit",
    requestId: "0",
    exit: Schema.encodeSync(s.codecFor(schema))(exit)
  }))

const decodeExit = (s, schema, bytes) => {
  const [frame] = s.makeUnsafe().decode(bytes)
  return Schema.decodeUnknownSync(s.codecFor(schema))(frame.exit)
}
```

`requestId` stays fixed, so equal values give equal bytes. Each journal entry records its `contentType`, and a reader table maps that to a serializer:

| `contentType` | Serializer |
| --- | --- |
| `application/json` | `RpcSerialization.json` |
| `application/x-ndjson` | `RpcSerialization.ndjson` |
| `application/vnd.effect.rpc+schema-binary` | `RpcSerialization.layerSchemaBinary()`, default mode |

- A serializer can be used for storage only if its `contentType` is unique in the table. Providing one that collides is refused when the layer is built.
- `jsonRpc` shares `application/json` with `json`, and fingerprinted binary shares a type with default binary. Neither can be stored, and both still work on the wire.
- Fingerprinted binary is also refused for storage because it rejects any schema change, even an added optional field.
- A custom serializer adds a row with its own `contentType`. It must round-trip Rpc frames, and its row must stay for as long as an entry uses it.
- New writes use the current serializer. Old entries stay as written, so a swap needs no migration.
- Binary output is a view into a shared arena, so a store copies it before keeping it.

## What the compiler generates

| VibeLang | Generated |
| --- | --- |
| A `schema` field of a type in the table | That row's Schema |
| A `call`'s parameters | A `Schema.Struct` keyed by parameter name, in the form of Rpc payload fields |
| A `call`'s return type | Its success Schema |
| A `call`'s error type | Its error Schema |
| A durable call | `snapshot`, then `identity` where a later VIP needs a hash |
| `provide RpcSerialization.layerX { }` | An ordinary `provide`, unchanged |

## Changes to the durable engine

| Where | Change | Why | Layer |
| --- | --- | --- | --- |
| `@smthrs/canonical` | Add `sortCollections` | The only new code at this layer | Values |
| `@smthrs/flows`, `flow/src/Flow/ExecutionIds.ts` | Call it before encoding | Equal `Set`s derive different run ids today | Values |
| `@smthrs/flows`, each other site that hashes a payload, such as `childExecutionId` in `flow/src/Interpreter.ts` | Route through one shared function | One rule, and no site can skip the sort | Values |
| `@smthrs/keys` | None | Reused as it is | Values |
| `@smthrs/canonical`, `Canonical` | None | Reused as it is | Values |
| `@smthrs/flows`, `flow/src/Action/make.ts` | Stored results move from a fixed `Schema.toCodecJson` to `RpcSerialization.codecFor` | Representation is injected | Stores |
| `@smthrs/flows`, `engine/src/FlowEngine/layerMemory.ts` | `snapshot` copies through `makeEffect`, so it must also sort | The body must see what was hashed | Tasks |
| The engine's build tooling | Replace `Schema.declare` references in payloads with values that have a JSON codec | `layerMemory.ts` copies through `makeEffect` because these references have no JSON form, and this VIP requires one | Tasks |

## Differences from superjson

| Value | superjson | This VIP | Why |
| --- | --- | --- | --- |
| `-0` | Kept | Becomes `0` | Effect's codec |
| Cycles, shared references | Kept | Refused or copied | `Canonical` refuses cycles, because a hash needs a tree |
| Type tags | Stored in `meta` | Not stored | The Schema already knows each type |

tRPC needs `meta` because its types are erased at runtime. A durable boundary has a Schema on both sides.

## Alternatives

- **A new `Codec` service.** Rejected, because `RpcSerialization` already is that service and Rpc already uses it.
- **Identity through the injected codec.** Rejected. Swapping codecs would change every run id, so the same input would start a second run and could charge twice.
- **Hash the bytes as they are.** Rejected. Equal sets would start two runs.
- **Refuse `Set` and `Map` at durable boundaries.** Rejected. It adds an error, and `Array.from(set)` brings the same bug back.
- **Sort for the hash only.** Rejected. The body could then see an order the hash did not cover.
- **Make superjson the default.** Rejected. It adds a dependency and stores type tags that a Schema makes unnecessary.

## Evidence

Run on `effect` 4.1.1 and `vibelang` 0.0.11:

- All eight superjson types round-trip through `Schema.toCodecJson`, with `Error` through `Schema.Defect`.
- Hashing through `Schema.toCodecJson` and `Canonical` gives equal `Set`s and `Map`s different hashes in 10 shapes, including a `Set` inside a struct, an array, a `Map` and a `Schema.Class`. With `sortCollections`, all 10 give one hash.
- Records with different key order already hash the same, because `Canonical` sorts keys.
- Arrays with different order keep different hashes, and a decoded snapshot iterates in sorted order.
- Every Schema in the table type-checks as a named constant in a `schema` field. `Date`, `URL` and `Set<string>` are `EK2109` when written as field types.

- All six serializers round-trip Rpc `Exit` frames, and four of them fail on a bare record.
- A registry keyed by `contentType` misread real records in both colliding pairs.
- On a real SQLite journal, a JSON process died, a binary process replayed its entry and wrote a binary one, and a JSON process then read both.

Not verified: `sortCollections` exists only as a prototype, and no compiler change has been made.

## Open questions

1. Whether `sortCollections` must walk the Schema instead of the value, for a class that keeps fields out of its own enumerable properties.
