# Schema to JSON Schema

JSON Schema export works as in Effect. It describes the encoded side of a schema's canonical JSON codec, so the exported shape matches the selected JSON representation. Export is best-effort and does not replace runtime decoding. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Exporting JSON Schema documents

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const document = depotDocument(); try Console.log(document.dialect); try Console.log(JSON.stringify(document.schema)) })
const Depot = Schema.Struct({
  name: Schema.String,
  capacity: Schema.Finite
})

function depotDocument() {
  return Schema.toJsonSchemaDocument(Depot)
}
```

```output
draft-2020-12
{"type":"object","properties":{"name":{"type":"string"},"capacity":{"type":"number"}},"required":["name","capacity"],"additionalProperties":true}
```

The document holds `dialect` (default `"draft-2020-12"`), the root `schema`, and a separate `definitions` map. The default excess-property policy leaves unmodeled keys open, though the default runtime decoder removes them.

## Selecting canonical representations and specification drafts

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(alternateDrafts())) })
function alternateDrafts() {
  const document = Schema.toJsonSchemaDocument(
    Schema.Tuple([Schema.String, Schema.FiniteFromString])
  )
  const draft07 = JsonSchema.toDocumentDraft07(document)
  const draft04 = JsonSchema.toDocumentDraft04(document)
  return { draft07, draft04 }
}
```

```output
{"draft07":{"dialect":"draft-07","schema":{"type":"array","maxItems":2,"minItems":2,"items":[{"type":"string"},{"type":"string"}]},"definitions":{}},"draft04":{"dialect":"draft-04","schema":{"type":"array","maxItems":2,"minItems":2,"items":[{"type":"string"},{"type":"string"}]},"definitions":{}}}
```

Export derives `toCodecJson`, then describes its encoded side: `FiniteFromString` exports a string schema, and a runtime Date its canonical JSON representation. Custom declaration hooks define the representation for both runtime JSON codecs and export. For another draft, convert the document with `JsonSchema`.

## Carrying annotations and encoded-side metadata

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(nameDocument().schema)) })
const DepotName = Schema.Trim.pipe(Schema.annotateEncoded({
  title: "Depot input",
  description: "Text entered before surrounding whitespace is removed",
  examples: [" north "],
  default: "central",
  "x-widget": "depot-picker"
}))

function nameDocument() {
  return Schema.toJsonSchemaDocument(DepotName, {
    includeAnnotationKey: (key) => key.startsWith("x-")
  })
}
```

```output
{"type":"string","title":"Depot input","description":"Text entered before surrounding whitespace is removed","default":"central","examples":[" north "],"x-widget":"depot-picker"}
```

`annotateEncoded` attaches metadata to the wire representation; `.annotate` targets the decoded side. Standard JSON Schema annotations include `title`, `description`, `default`, `examples`, `readOnly`, `writeOnly`, `format`, `contentEncoding`, `contentMediaType`, and `contentSchema`. `includeAnnotationKey` admits selected nonstandard keys and keeps the standard ones. A documented default does not make the runtime decoder apply it.

## Exporting constraints and optional fields

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(requestDocument().schema)) })
const DepotRequest = Schema.Struct({
  code: Schema.String.check(Schema.isPattern(/^[A-Z]{2}[0-9]{3}$/u)),
  note: Schema.optionalKey(Schema.String),
  alias: Schema.optional(Schema.String),
  capacity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120 }))
})

function requestDocument() {
  return Schema.toJsonSchemaDocument(DepotRequest)
}
```

```output
{"type":"object","properties":{"code":{"type":"string","pattern":"^[A-Z]{2}[0-9]{3}$"},"note":{"type":"string"},"alias":{"anyOf":[{"type":"string"},{"type":"null"}]},"capacity":{"type":"integer","minimum":1,"maximum":120}},"required":["code","capacity"],"additionalProperties":true}
```

Built-in filters contribute constraints such as numeric bounds, lengths, patterns, and uniqueness; a custom filter needs a `toJsonSchema` annotation to describe a representable constraint. An exact optional key is omitted from `required`; `optional` also allows undefined, which canonical JSON expresses as null. `isPattern` exports a pattern only with the Unicode `u` flag and no flags besides `d`, `g`, or `y`; other flag combinations leave the check out of JSON Schema unless its annotations override `toJsonSchema`.

JavaScript counts string length in UTF-16 code units; JSON Schema counts Unicode code points. Built-in export uses conservative bounds where needed: `isMinLength(3)` can become `minLength: 2`. Arbitrary predicates and opaque declarations without a structural JSON codec cannot always be described exactly.

## Emitting references for recursive definitions

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(treeDocument())) })
interface DepotTree {
  name: string
  branches: ReadonlyArray<DepotTree>
}
const DepotTree = Schema.Struct({
  name: Schema.String,
  branches: Schema.Array(Schema.suspend((): Schema.Codec<DepotTree> => DepotTree))
}).annotate({ identifier: "DepotTree" })

function treeDocument() {
  return Schema.toJsonSchemaDocument(DepotTree)
}
```

```output
{"dialect":"draft-2020-12","schema":{"$ref":"#/$defs/DepotTree"},"definitions":{"DepotTree":{"type":"object","properties":{"name":{"type":"string"},"branches":{"type":"array","items":{"$ref":"#/$defs/DepotTree"}}},"required":["name","branches"],"additionalProperties":true}}}
```

An identifier creates a named definition referenced through `$ref`. Without one, recursive export still works: the exporter allocates a name such as `Objects_` for the cycle. Supply an identifier when consumers need a stable reference name. Reuse stable identifiers for shared descriptions; never give one identifier to different shapes.

## Adjusting document generation

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(strictDocument().schema)) })
function strictDocument() {
  return Schema.toJsonSchemaDocument(DepotRequest, {
    onExcessProperty: "error",
    generateDescriptions: true,
    includeAnnotationKey: (key) => key.startsWith("x-")
  })
}
```

```output
{"type":"object","properties":{"code":{"type":"string","pattern":"^[A-Z]{2}[0-9]{3}$","description":"a string matching the RegExp ^[A-Z]{2}[0-9]{3}$"},"note":{"type":"string"},"alias":{"anyOf":[{"type":"string"},{"type":"null"}]},"capacity":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991,"description":"an integer","allOf":[{"minimum":1,"maximum":120,"description":"a value between 1 and 120"}]}},"required":["code","capacity"],"additionalProperties":false}
```

`onExcessProperty: "error"` closes unmodeled keys where their key space is expressible; set the same runtime parsing option so both reject those keys. `generateDescriptions` derives missing check descriptions from `expected`; `referencePolicy` controls allocation of named references and receives canonical JSON ASTs.

## Describing JSON string codecs

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(jsonTextDocument().schema)) })
const DepotText = Schema.fromJsonString(Depot)

function jsonTextDocument() {
  return Schema.toJsonSchemaDocument(DepotText)
}
```

```output
{"type":"string","contentMediaType":"application/json"}
```

The external value is JSON text, so the root schema is a string with `contentMediaType: "application/json"`. Effect 4.1.0 does not add `contentSchema` for the embedded object; export `Depot` separately to describe it, or add `contentSchema` with `annotateEncoded`. Content keywords document the embedded format; validators vary in enforcing them.

[Upstream page](https://effect.website/docs/v4/schema/json-schema)
