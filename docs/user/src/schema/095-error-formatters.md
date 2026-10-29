# Error Formatters

Schema issue formatters work as in Effect. They render failures as readable strings for diagnostics or as structured issue paths for forms and other validation clients; [value formatters](103-formatter.md) render successful values. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Rendering schema issues as readable strings

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try readableFailure({})); try Console.log(try readableFailure({ destination: "north", packages: 2 })) })
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

`makeFormatterDefault()` returns a function from an issue to a multiline string; paths identify nested keys and indices. `SchemaError.message` already uses this format, so read it directly unless you need custom formatting.

## Reporting several issues

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try allFailures({})) })
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

Formatting shows only the issues parsing collected; set `errors: "all"` on the parser to collect several independent failures. Nested prerequisites still apply: a struct-level check runs only after its input validates.

## Formatting Standard Schema validation errors

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(try formFailures({}))) })
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

The Standard Schema formatter returns a failure object with an `issues` array. Each leaf issue carries its full path, so each message maps to a form field. Keep paths structured when field names contain dots or array indices matter; joining segments into a string loses that distinction.

## Customizing leaf messages

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(try localizedFailures({}))); try Console.log(JSON.stringify(try localizedFailures({ destination: 2, packages: 1 }))) })
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

`leafHook` replaces selected leaf messages; delegate other cases to `defaultLeafHook` to keep the built-in messages. Keep the hook synchronous and free of service calls; load translated strings before creating it.

## Connecting validation to form libraries

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(try tryPromise(() => Promise.resolve(formSchema()["~standard"].validate({}))))) })
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

Pass the adapter to a form library that accepts Standard Schema V1 from the UI integration's normal TypeScript module. The adapter exposes structured issues and keeps the original Schema operations; its decoding services must be `never`.

For React Hook Form, pass `DispatchForm` to [`standardSchemaResolver`](https://github.com/react-hook-form/resolvers/tree/master/standard-schema) from `@hookform/resolvers/standard-schema`, which calls the Standard Schema validation interface. The separate `effectTsResolver` uses Effect 3's `ParseResult` API and does not support Effect 4.0.6.

[Upstream page](https://effect.website/docs/v4/schema/error-formatters)
