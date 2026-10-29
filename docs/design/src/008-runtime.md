# Runtime guarantees

Source: [VIP-31](../vips/0031-runtime-guarantees.md).

- **No runtime semantics of VibeLang’s own.** Every construct is exact sugar for Effect, so failures, defects, interruption, finalizer order and the combination of causes are those of the pinned `effect` 4.1.0 ([Configuration](007-tooling.md#the-effect-version)).
- **The guarantee.** Compiled output gives the same `Exit` as the Effect TypeScript shown beside each construct in this specification: success, failure, defect or interruption, with finalizers run in the same order. Compare the `Cause` structure as well as success values, and record finalizer traces separately.
- **How it is checked.** Each VIP’s VibeLang and Effect TypeScript pair is a differential test: it compiles the VibeLang, runs both, and compares their `Exit`s and finalizer traces. The fuzz suite generates more pairs. Checking only the Effect TypeScript validates the counterpart, not compiler conformance.
- **Runtime helpers** are limited to small shims, such as defining `Symbol.customMatcher` where an engine lacks it ([Pattern matching](004-match.md#class-patterns)). Function translations preserve TypeScript’s [activation semantics](001-functions.md#meaning); outward jumps use [completion records](002-running.md#leaving-a-block), not a continuation runtime.
- Effect handlers would need a continuation runtime. They are an open VIP ([VIP-35](../vips/0035-handlers-open.md)), not part of the language.

`using` keeps TypeScript’s meaning ([VIP-8](../vips/0008-using-denied.md), denied). It disposes when JavaScript control leaves its scope, including by `return` or a JavaScript throw. A typed failure run by `try`, or interruption, abandons the `Effect.gen` generator without unwinding that scope. Use Effect’s `scoped`, `acquireRelease`, `acquireDisposable` or `addFinalizer` for cleanup on every Effect exit.

```vibe es
// compiler-gap: pending VIP-8
// openFile is the plain helper in the shared TypeScript fixture below.
import { openFile } from "./resource.ts"
effect function unsafe() {
  using f = openFile()
  throw "bad"                         // typed failure: disposer is skipped
}
effect function safe() {
  return try scoped(effect {
    const f = try acquireDisposable(sync(() => openFile()))
    throw "bad"                       // typed failure: scope disposes f
  })
}
```

Effect TypeScript (the exported fixture is `resource.ts`):

```ts
import { Effect } from "effect"

export const trace: string[] = []
/** @throws {never} */
export function openFile(): Disposable {
  return { [Symbol.dispose]() { trace.push("dispose") } }
}
function unsafe() {
  return Effect.gen(function* () {
    using f = openFile()
    return yield* Effect.fail("bad")
  })
}
function safe() {
  return Effect.scoped(Effect.gen(function* () {
    const f = yield* Effect.acquireDisposable(Effect.sync(() => openFile()))
    return yield* Effect.fail("bad")
  }))
}
// Both fail with "bad"; unsafe leaves trace empty, safe appends "dispose".
```

**Undecided (pending VIP):** whether `using` in effect code gets a warning that points to `acquireDisposable`.
