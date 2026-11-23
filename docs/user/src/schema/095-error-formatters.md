# Error Formatters

Issue formatters turn `SchemaIssue.Issue` trees into human-readable strings for logs or path-indexed issue lists for forms; for successful values, see [Schema to Formatter](103-formatter.md). Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Default string formatter

```vibe
// run: try Console.log(try readableFailure({})); try Console.log(try readableFailure({ destination: "north", packages: 2 }))
const Dispatch = Schema.Struct({
  destination: Schema.String,
  packages: Schema.Int
})

effect function readableFailure(input: unknown) {
  return effect {
    try Schema.decodeUnknownEffect(Dispatch)(input)
    return "Accepted"
  } catch (error) => SchemaIssue.makeFormatterDefault()(error.issue)
}
```

```output
Missing key
  at ["destination"]
Accepted
```

`SchemaIssue.makeFormatterDefault()` produces the same multiline output exposed by `error.message`; call it directly only when customizing formatting.

## Collecting multiple issues

```vibe
// run: try Console.log(try allFailures({}))
effect function allFailures(input: unknown) {
  return effect {
    try Schema.decodeUnknownEffect(Dispatch)(input, { errors: "all" })
    return "Accepted"
  } catch (error) => error.message
}
// {} reports missing destination and packages fields.
```

```output
Missing key
  at ["destination"]
Missing key
  at ["packages"]
```

Formatters render only the issues recorded during parsing. Pass `{ errors: "all" }` to collect independent failures; dependent checks (such as struct-level filters) still wait for their prerequisites to pass.

## Standard Schema issue lists

```vibe
// run: { const jsonValue = try formFailures({}); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function formFailures(input: unknown) {
  return effect {
    try Schema.decodeUnknownEffect(Dispatch)(input, { errors: "all" })
    return []
  } catch (error) => SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues
}
// An issue has a message and a path such as ["destination"].
```

```output
[{"path":["destination"],"message":"Missing key"},{"path":["packages"],"message":"Missing key"}]
```

`makeFormatterStandardSchemaV1()` returns `{ issues }`, where each leaf carries its structured `path` array (preserving dots in keys and numeric array indices) and `message`.

## Customizing leaf messages

```vibe
// run: { const jsonValue = try localizedFailures({}); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = try localizedFailures({ destination: 2, packages: 1 }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const formFormatter = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: (issue) => issue._tag === "MissingKey"
    ? "Complete this field"
    : SchemaIssue.defaultLeafHook(issue)
})

effect function localizedFailures(input: unknown) {
  return effect {
    try Schema.decodeUnknownEffect(Dispatch)(input, { errors: "all" })
    return []
  } catch (error) => formFormatter(error.issue).issues
}
```

```output
[{"path":["destination"],"message":"Complete this field"},{"path":["packages"],"message":"Complete this field"}]
[{"path":["destination"],"message":"Expected string"}]
```

Override selected issue tags in `leafHook` and fall back to `SchemaIssue.defaultLeafHook(issue)` for the rest. Keep hooks synchronous and pure; load translations beforehand.

## Form library integration

```vibe
// run: { const jsonValue = try tryPromise(() => Promise.resolve(formSchema()["~standard"].validate({}))); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const DispatchForm = Schema.toStandardSchemaV1(Dispatch, {
  parseOptions: { errors: "all" },
  leafHook: (issue) => issue._tag === "MissingKey"
    ? "Complete this field"
    : SchemaIssue.defaultLeafHook(issue)
})

function formSchema() {
  return DispatchForm
}
```

```output
{"issues":[{"path":["destination"],"message":"Complete this field"},{"path":["packages"],"message":"Complete this field"}]}
```

`Schema.toStandardSchemaV1` adapts any service-free codec (`RD = never`) while retaining its Schema methods. For React Hook Form, pass `DispatchForm` to [`standardSchemaResolver`](https://github.com/react-hook-form/resolvers/tree/master/standard-schema) from `@hookform/resolvers/standard-schema` (`effectTsResolver` targets Effect 3's `ParseResult` and does not support Effect 4.1.1).

[Upstream page](https://effect.website/docs/v4/schema/error-formatters)
