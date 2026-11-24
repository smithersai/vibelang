# Warn on JavaScript cleanup inside Effect generators

**Status:** drafted, not filed. **Target:** Effect language service.
**Runtime reproduced:** `effect@4.1.1`.

## Behavior and reproduction

```ts
import { Effect } from "effect"

const events: string[] = []
await Effect.runPromiseExit(Effect.gen(function* () {
  try {
    yield* Effect.fail("request failed")
  } finally {
    events.push("released")
  }
}))
console.log(events) // []
```

[F1-F3](../../experiments/tests/effect-facts.test.ts) assert this behavior on
failed yields and interruption. Run
`cd experiments && bun test tests/effect-facts.test.ts`.
[q8-generators.ts](../../experiments/scripts/runtime-facts/q8-generators.ts)
extends it to `Effect.fn`, untraced variants, and JavaScript disposal.

The [dated research](../research/effect4-runtime.md), section 8, records that
language-service issue 271 introduced a warning for generator `try/catch`,
while issue 442 exempted `try/finally` as valid cleanup. The runtime reproduction
is local evidence; this draft does not claim a current language-service version
was installed or tested here.

## Expected behavior

Tooling should warn that JavaScript `finally` and `using` inside an Effect
generator do not release resources when a yielded Effect fails or is
interrupted. The diagnostic should identify the unsupported cleanup and point
to Effect finalizers, rather than describe that syntax as valid cleanup.

## Why it matters to VibeLang

Developers migrating from Effect generators need accurate cleanup guidance.
VibeLang effect functions use explicit Effect finalizers such as `onExit` and `ensuring`, or Scope for resource ownership. JavaScript `try/finally` remains available in ordinary TypeScript code.

## Suggested fix

Remove the `try/finally` exemption for `Effect.gen`, `Effect.fn`, and their
generator variants. Cover `using` and `await using` where the parser supports
them. Offer `Effect.onExit`, `Effect.ensuring` for infallible cleanup, or
`Effect.acquireRelease` for scoped acquisition as context permits. Do not offer
a mechanical fix when moving cleanup changes lexical scope or failure policy.
Update the related examples and keep the warning until the
[runtime cleanup contract](effect-gen-finally.md) changes.
