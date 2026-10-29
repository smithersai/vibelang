# Runtime guarantees

Source: [VIP-31](../vips/0031-runtime-guarantees.md).

- **No independent Effect runtime semantics.** Every accepted construct is sugar for its specified counterpart. Failures, defects, interruption, finalizer order and the combination of causes are those of the pinned `effect` 4.1.0 ([Configuration](007-tooling.md#the-effect-version)). [Pattern matching](004-match.md#class-patterns) follows VIP-7’s pinned TC39 snapshot and its explicit Effect-pattern adaptations.
- **The guarantee.** Compiled output gives the same `Exit` as the accepted VIP’s Effect TypeScript counterpart: success, failure, defect or interruption, with finalizers run in the same order. This specification spells out that counterpart without changing its operand evaluation order. Compare the `Cause` structure as well as success values, and record finalizer traces separately.
- **How it is checked.** Each VIP’s VibeLang and Effect TypeScript pair is a differential test: it compiles the VibeLang, runs both, and compares their `Exit`s and finalizer traces. The fuzz suite generates more pairs. Checking only the Effect TypeScript validates the counterpart, not compiler conformance; skipped pairs establish no conformance.
- **Runtime helpers** implement only the specified adaptations: defining `Symbol.customMatcher` where absent; `$is`/`$extract` for the snapshot’s built-in constructor matchers (`Array`, `Error`, `Map`, `Set`, `Date`, `Promise`, etc.) without modifying those globals; generated error matchers; and fixed checks for Effect’s `Option`, `Exit` and `Result`. These checks follow resolved bindings, not identifier spelling; their tests and extracted fields are specified in [Pattern matching](004-match.md#class-patterns).
- **Source bindings and control flow survive lowering.** Resolve bindings and jump targets before introducing callbacks. Function translations preserve TypeScript’s [activation semantics](001-functions.md#meaning). In a source block translated to a callback (a `provide` or interruption block, a `for concurrent` or `for try` body), each `var` still belongs to its source function, as in TypeScript: allocate it there and leave initializer assignments at their original positions. `this`, `arguments`, `super` and `new.target` in such a block are the source function's. Preserve redeclarations, destructuring order and closure identity; keep `let`/`const` block scopes and strict-module function-declaration rules. A nested source function keeps its own bindings. Outward jumps use [completion records](002-running.md#leaving-a-block) carrying the resolved target (including a `switch` or labeled statement), not a continuation runtime.
- Effect handlers would need a continuation runtime. They are an open VIP ([VIP-35](../vips/0035-handlers-open.md)), not part of the language.

```vibe es
// compiler-gap: pending VIP-22
effect function binding() {
  var x = 0
  const read = () => x
  uninterruptible { var x = 1 }
  return read()                     // 1: both declarations bind the same x
}
```

```ts
import { Effect } from "effect"

function binding() {
  return Effect.gen(function* () {
    var x = 0
    const read = () => x
    yield* Effect.uninterruptible(Effect.gen(function* () { x = 1 }))
    return read()
  })
}
```

`using` keeps TypeScript’s meaning ([VIP-8](../vips/0008-using-denied.md), denied). It disposes when JavaScript control leaves its scope, including by `return` or a JavaScript throw. A typed failure run by `try`, or interruption, abandons the `Effect.gen` generator without unwinding that scope. Use Effect’s `scoped`, `acquireRelease`, `acquireDisposable` or `addFinalizer` for cleanup on every Effect exit. `using` in effect code gets a warning, with a quick fix to `acquireDisposable` inside `scoped`; the warning does not change disposal semantics.

```vibe es
// compiler-gap: pending VIP-8
// openFile is the plain helper in the shared TypeScript fixture below.
import { openFile } from "./resource.ts"
effect function unsafe() {
  using f = openFile()               // warning: use acquireDisposable inside scoped
  throw "bad"                        // typed failure: disposer is skipped
}
effect function safe() {
  return try scoped(effect {
    const f = try acquireDisposable(sync(() => openFile()))
    throw "bad"                      // typed failure: scope disposes f
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
  return Effect.gen(function* () {
    return yield* Effect.scoped(Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(Effect.sync(() => openFile()))
      return yield* Effect.fail("bad")
    }))
  })
}
// Both fail with "bad"; unsafe leaves trace empty, safe appends "dispose".
```
