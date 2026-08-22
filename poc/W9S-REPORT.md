# W9-S — Schema and Encoding

Implemented the provisional ordinary-runtime `Schema and Encoding` area in `src/schema/`, with a runnable example at `examples/schema/demo.ts`. Values are frozen and WeakSet-branded where they have runtime identity (`Codec`, `Schema`, and optional Schema field markers). Parse/decode failures use frozen runtime `Result` values; law-helper misses use `Optional`.

## API inventory

### Codec

- `Codec<Domain, Wire>` with `encode`, `decode`, and fluent `map`, `imap`, `compose`.
- `Codec.make(encode, decode, accepts?)`; the optional Domain predicate makes union encoding explicit for custom codecs. Without it, a guarded round-trip probe is used.
- Total/fallible transforms: `Codec.imap`, `Codec.map`; representation chaining: `Codec.compose`.
- Products/sums: `Codec.array`, `tuple`, `struct`, `union`, `nullable`, `optional`.
- Canonical scalar codecs: `Codec.string`, `number` (finite), `boolean`, `null`, and `literal`.
- `Codec.optional` uses the runtime's branded `Optional` in Domain space and `undefined` for absence in Wire space.
- `Codec.checkRoundTrip(codec, samples): Optional<string>`.
- Nominal, wire-registered `DecodeError` with structured `path`, rendered `pointer`, and stable `reason`.

### Json

- `Json.parse(text): Result<JsonValue, JsonParseError>`.
- `Json.stringify(value): Result<string, JsonEncodeError>`.
- `Json.canonical(value): Result<Uint8Array, JsonEncodeError>`.
- Explicit exported limits: depth 256, 100,000 nodes, and 8 MiB UTF-8.
- Parsed arrays/objects and generated JSON Schema documents are deeply frozen.
- Nominal, wire-registered `JsonParseError` and `JsonEncodeError` with exact paths.

### Schema

- Frozen `Schema<T>` values with `descriptor`, `parse`, `.refine(predicate, message)`, and `.describe(name)`.
- `Schema.string`, `number`, `boolean`, `null`, `literal`, `array`, `tuple`, `struct`, `union`, `optional`, `nullable`, and `record`.
- `Schema.optional` is a branded struct-field marker, matching the canonical descriptor's property-level `optional` flag.
- `Schema.equivalence(schema)` and `Schema.hash(schema)` produce the existing Core Data `Equivalence`/`Hash` instances; their law pairing is tested over nested structs, arrays, optionals, and records.
- The existing wire-registered `build/schema-runtime.ts` `ValidationError` is reused unchanged.

### JsonSchema and shared exports

- `JsonSchema.fromSchema(schema): JsonValue` emits draft 2020-12 documents.
- Covers scalar, literal, array, exact tuple, exact struct (required vs optional), union, nullable, and record nodes.
- Repeated named shapes use sorted `$defs` and escaped local `$ref` JSON Pointers.
- Nominal, wire-registered `JsonSchemaError` reports derivations that cannot be represented honestly.
- `src/schema/index.ts` labels the entire API provisional and re-exports the existing `Equivalence` and `Hash` rather than duplicating them.

## Shared validation engine

Yes: the build engine was reused.

Every descriptor tree in the comptime grammar is passed directly to `__vsSchema` from `src/build/schema-runtime.ts`. That function performs the authoritative descriptor assertion/freezing and supplies the actual parser. Tests compare ordinary `Schema.parse` results and exact failures against a direct `__vsSchema` invocation over the same descriptor.

The only adapter is for `record`, because the exported build `SchemaDescriptor` union has no record node and `assertSchemaDescriptor` correctly rejects unknown kinds. A tree containing a record uses a narrow container adapter that copies the shared engine's plain-array/plain-object, own-enumerable-data, exact-field, frozen-output, error-path, depth-32, and node-8192 policies. Each build-compatible child subtree still delegates to `__vsSchema`; there is no independent validator for the common grammar. Refinements are metadata outside the structural descriptor and run only after structural parsing succeeds.

## Canonical JSON agreement

`Json.canonical` matches `src/durable/ir.ts` on every mutually accepted value:

- lexicographically sorted object keys;
- recursive array order;
- `JSON.stringify` scalar and number formatting;
- Unicode-scalar strings (unpaired surrogates rejected);
- finite numbers with negative zero rejected;
- cycles, sparse holes, accessors/hidden fields, symbol keys, and non-plain objects rejected;
- depth 256, 100,000 nodes, and 8 MiB UTF-8 limits;
- UTF-8 bytes from `TextEncoder`.

Tests compare canonical output directly with durable `canonicalJson`, verify stability under key reordering, repeat encoding in-process, and compare two separate Bun process runs byte-for-byte.

Deliberate divergence: this ordinary JSON API also rejects arrays whose prototype is not exactly `Array.prototype`, as required by the task's non-plain-prototype boundary. The durable encoder currently checks object prototypes but permits array subclasses when their own fields otherwise look canonical. Therefore canonical bytes are identical where both accept, while Schema/Encoding is intentionally stricter for array subclasses. `Json.stringify` is the ordinary insertion-order encoder; only `Json.canonical` promises sorted deterministic bytes.

## Fail-closed boundaries

- JSON rejects invalid syntax, non-JSON primitive kinds, non-finite numbers, negative zero, invalid Unicode scalars, cycles, exotic prototypes, sparse/extra array fields, accessors, hidden fields, symbols, unsafe inspection, and all three budget overflows.
- Codec rejects wrong scalars, arity errors, sparse/exotic arrays, missing/extra/accessor struct fields, unmatched unions, forged values/Results, and hostile wire inspection. Custom union codecs can supply an explicit Domain guard.
- Schema rejects undeclared/missing/accessor/symbol fields, exotic arrays/objects, tuple arity, unmatched unions, invalid record members, descriptor budget exhaustion, failed/thrown refinements, and forged Schema/optional-marker values.
- JSON Schema refuses arbitrary predicate refinements, conflicting reuse of a name for different shapes, forged Schema values, and any unsupported descriptor kind rather than emitting an incomplete schema.

## Verification

- `bun run check`: final run passed with zero errors. An initial check, while live lanes were changing, reported two unrelated `src/build/source-assets.ts:584` errors for missing `authoredStart`; subsequent and final checks were clean.
- `bun test src/schema/`: 33 passed, 0 failed, 4 test files, 144 assertions.
  - Codec: 10 tests.
  - Json: 7 tests.
  - JsonSchema: 6 tests.
  - Schema: 10 tests.
- `bun test src/data/ src/build/`: 274 passed, 0 failed, 13 files, 4,471 assertions.
- `bun examples/schema/demo.ts`: passed.

SOURCE SETTLED.
