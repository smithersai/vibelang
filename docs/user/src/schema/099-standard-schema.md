# Schema to Standard Schema

Standard Schema adaptation works as in Effect: it exposes a codec to libraries that implement the Standard Schema V1 validation interface and keeps the original Schema methods. The codec must have no decoding service requirements. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Adapting codecs to the standard validation interface

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(standardMetadata()); try Console.log(JSON.stringify(try tryPromise(() => Promise.resolve(DispatchStandard["~standard"].validate({ reference: "pkg-94", count: "2" }))))) })
const Dispatch = Schema.Struct({
  reference: Schema.NonEmptyString,
  count: Schema.FiniteFromString
})
const DispatchStandard = Schema.toStandardSchemaV1(Dispatch, {
  parseOptions: { errors: "all" }
})

function standardMetadata() {
  return DispatchStandard["~standard"].vendor // "effect"
}
```

```output
effect
{"value":{"reference":"pkg-94","count":2}}
```

`toStandardSchemaV1` adds the `"~standard"` interface. Validation decodes, transformations included, and returns `{ value }` on success or `{ issues }` on failure. Pass the adapted schema to a compatible library from that library's normal TypeScript integration module.

## Choosing synchronous or asynchronous validation

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-13, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(try validateDispatch({ reference: "pkg-94", count: "2" }))); try Console.log(JSON.stringify(try validateDispatch({}))) })
const ReviewedDispatch = Dispatch.pipe(Schema.decode({
  decode: SchemaGetter.checkEffect(effect (_dispatch) => {
    try sleep("5 millis")
    return true
  }),
  encode: SchemaGetter.passthrough()
}))
const ReviewedStandard = Schema.toStandardSchemaV1(ReviewedDispatch)

effect validateDispatch(input: unknown) {
  return try tryPromise({ try: () => Promise.resolve(ReviewedStandard["~standard"].validate(input)), catch: (cause) => new ValidationBoundaryError({ cause }) })
}

error ValidationBoundaryError {
  cause: unknown
}
```

```output
{"value":{"reference":"pkg-94","count":2}}
{"issues":[{"path":["reference"],"message":"Missing key"},{"path":["count"],"message":"Missing key"}]}
```

The standard interface tries synchronous validation first and returns a Promise instead of a direct result when it meets asynchronous work. `Promise.resolve` normalizes either result shape for `tryPromise`. Prefer `Schema.decodeUnknownEffect` in ordinary VibeLang application code; use the standard interface for interoperability.

Plain TypeScript calls are allowed inside the callback passed to `tryPromise`. The callback always returns a Promise. The boundary maps synchronous exceptions and Promise rejections to `ValidationBoundaryError`; reported validation issues stay data.

## Handling defects during validation

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(try inspectBrokenValidation())) })
const BrokenLabel = Schema.String.pipe(Schema.decode({
  decode: SchemaGetter.transformEffect(effect (_label) => try die("label invariant failed")),
  encode: SchemaGetter.passthrough()
}))
const BrokenStandard = Schema.toStandardSchemaV1(BrokenLabel)

effect inspectBrokenValidation() {
  return try tryPromise(() => Promise.resolve(BrokenStandard["~standard"].validate("crate")))
}
```

```output
{"issues":[{"message":"Error: label invariant failed"}]}
```

The adapter reports an unexpected defect as one issue without a path, not as a normal field-validation failure. That is the adapter's behavior; `catch` still does not catch defects. To investigate a defect, keep internal diagnostics at an application boundary rather than relying only on the validation message.

Customize the adapter with `leafHook`, `checkHook`, and `parseOptions`; its structured failures use the issue formatter in [Error Formatters](095-error-formatters.md).

[Upstream page](https://effect.website/docs/v4/schema/standard-schema)
