# Fallback

A fallback runs a backup value or Effect only when the primary Effect fails with an expected error. Defects and pure interruptions pass straight through.

## Falling back to another Effect (`catch effect`)

```vibe
// run: try Console.log(try title())
error SourceOffline

effect function latestTitle(): string!SourceOffline {
  throw new SourceOffline()
}

effect function cachedTitle() {
  try Console.log("Reading saved title")
  return "Saved issue"
}

effect function title() {
  return latestTitle() catch effect () => try cachedTitle()
}
// Inferred: string!!
```

```output
Reading saved title
Saved issue
```

`cachedTitle()` runs only if `latestTitle()` fails. Any errors or service requirements from the fallback become `title()`'s own channels.

The handler after `catch` is always a function literal — its modifier determines what it can do:

| Form | Body | Use when |
| --- | --- | --- |
| `e catch () => value` | Plain function | Computing a pure fallback value (`throw` is `EK0401`) |
| `e catch (err) => value` | Plain function | Formatting or deriving a fallback value from `err` |
| `e catch effect (err) => { ... }` | Effect function | Running backup Effects, logging, or rethrowing unhandled cases |

A `throw` in a plain handler is `EK0401`; write `catch effect` for a typed failure, or `catch effect (error) => try die(error)` for a defect. Never put `try` right before `catch` — write `expr catch h`, not `try expr catch h` (`EK0505`).

See [Catch handlers](../../../design/src/002-running.md#catch) for handler syntax and throws rules.

## Falling back to a default value

```vibe
// run: try Console.log(try titleOrPlaceholder())
effect function titleOrPlaceholder() {
  return latestTitle() catch () => "No title available"
}
// Inferred: string!!
```

```output
No title available
```

`x catch () => value` compiles to `yield* Effect.catch(x, () => Effect.succeed(value))`. Returning an unrun Effect from a plain handler draws warning `EK0508` — write `catch effect () => try fallback()` to execute it instead.

### Typing both outcomes explicitly

```vibe
// run: { const jsonValue = try lookup(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
type Lookup = { _tag: "Found"; title: string } | { _tag: "Offline" }

effect function lookup(): Lookup!! {
  return effect {
    return { _tag: "Found" as const, title: try latestTitle() }
  } catch () => ({ _tag: "Offline" as const })
}
```

```output
{"_tag":"Offline"}
```

## Trying alternatives in priority order (`firstSuccessOf`)

```vibe
// run: try Console.log(try bestTitle())
effect function bestTitle() {
  return try firstSuccessOf([
    latestTitle(),
    cachedTitle(),
    succeed("Untitled issue")
  ])
}
```

```output
Reading saved title
Saved issue
```

`firstSuccessOf` runs Effects one by one until one succeeds. If every alternative fails with an expected error, the last error is returned. Passing an empty iterable is a defect.

## Precedence and scope

- `catch` has the precedence of `??` and associates left to right. Mixing `catch` with `??`, `||`, or `&&` requires parentheses (`EK0512`): `(saved ?? loadTitle()) catch () => "Untitled"`.
- `catch` protects only the Effect produced by its left operand. In `decode(try parse(s)) catch () => fallback`, a failure from `parse(s)` escapes before `catch` installs; wrap both in `effect { return try decode(try parse(s)) } catch () => fallback` to protect both.
- Effect code rejects JavaScript `try`/`catch` and `try`/`finally` statements (`EK0503`). Use `effect { ... } catch ...` for recovery and `ensuring` / `onExit` for cleanup:

```vibe
error MissingValue

effect function recover(missing: boolean) {
  return effect {
    if (missing) throw new MissingValue()
    return 1
  } catch () => 2
}

effect function clean() {
  return try Effect.onExit(effect { return 1 }, () => effect { try Effect.log("finished") })
}
```

## Coming from Effect

- `e catch () => value` replaces `Effect.orElseSucceed(e, () => value)`.
- `e catch effect () => try alt()` replaces `Effect.catch(e, () => alt())`.
- Pass cold Effect arrays straight to `try firstSuccessOf([a(), b()])`.

[Upstream Effect page](https://effect.website/docs/v4/error-management/fallback)
