# Ship TC39 custom matchers for `Option`, `Exit`, `Result` and tagged errors

**Status:** drafted, not filed. **Target:** Effect data types.
**Version examined:** `effect@4.1.0`. **Kind:** API proposal.

## Current behavior

The TC39 pattern-matching proposal ([pinned snapshot](../design/vips/tc39-pattern-matching/README.md)) resolves every class or extractor pattern through the matcher's `Symbol.customMatcher` method. No Effect export has one in `effect@4.1.0`: `grep -rn customMatcher node_modules/effect/src` finds nothing. `Option`, `Exit` and `Result` values are plain objects built from shared prototypes (`SomeProto`, `NoneProto` in `internal/option.ts`), and their only tests are the guards `Option.isSome`, `Exit.isSuccess` and `Result.isSuccess`. There is no `Option.Some` value to name in a pattern.

```ts
// Under the proposal, with no matcher on Effect's side:
match (opt) {
  when Option.Some(let v): v   // TypeError: Option.Some is undefined
  when Option.None: fallback
}
```

## VibeLang impact

VIP-7 makes VibeLang's `match` the TC39 proposal. VibeLang does not patch Effect at run time, so until Effect ships matchers the compiler recognizes the names `Option.Some`, `Option.None`, `Exit.Success`, `Exit.Failure`, `Result.Success` and `Result.Failure` in a pattern and compiles them to the module's guard and field reads (D208). That rule is a special case: a local variable named `Option` still compiles to `Option.isSome`, and a library outside VibeLang that matches an `Option` has no equivalent.

## Proposed contract

Each data type exports a matcher object per case, with a static `[Symbol.customMatcher]` that follows the proposal: with the hint `{ matchType: "boolean" }` it returns whether the subject is that case, and with `{ matchType: "extractor" }` it returns `false` or an array of the case's values.

| Export | Matches | Extracts |
| --- | --- | --- |
| `Option.Some` | `Option.isSome(subject)` | `[subject.value]` |
| `Option.None` | `Option.isNone(subject)` | `[]` |
| `Exit.Success` | `Exit.isSuccess(subject)` | `[subject.value]` |
| `Exit.Failure` | `Exit.isFailure(subject)` | `[subject.cause]` |
| `Result.Success` | `Result.isSuccess(subject)` | `[subject.success]` |
| `Result.Failure` | `Result.isFailure(subject)` | `[subject.failure]` |
| `Data.TaggedError(tag)` and `Schema.TaggedError` classes | an object whose `_tag` is the class's tag | `[subject]` |

The symbol is `Symbol.customMatcher` when the engine defines it and `Symbol.for("Symbol.customMatcher")` otherwise, the registry key the proposal's polyfills use, so matchers from separate copies of `effect` agree.

A tagged error's matcher tests `_tag`, not `instanceof`, so an error from a second installed copy of a package still matches; `Effect.catchTag` already treats errors this way.

## Suggested fix

```ts
const customMatcher: unique symbol =
  (Symbol as any).customMatcher ?? Symbol.for("Symbol.customMatcher")

export const Some = {
  [customMatcher](subject: unknown, hint: { matchType: "boolean" | "extractor" }) {
    if (!isOption(subject) || !isSome(subject)) return false
    return hint.matchType === "boolean" ? true : [subject.value]
  }
}
```

Types: the extractor's return type, `readonly [A] | false`, lets a compiler type the bindings exactly, as VibeLang does today through D208.

## When VibeLang drops D208

Once a published `effect` ships these matchers, VibeLang compiles `Option.Some(let v)` as any other extractor pattern through `Symbol.customMatcher` and deletes its fixed checks.
