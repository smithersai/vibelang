# Runtime guarantees

Source: [VIP-31](../vips/0031-runtime-guarantees.md).

- **No independent Effect runtime semantics.** Every accepted construct is sugar for its specified counterpart. Failures, defects, interruption, finalizer order and the combination of causes are those of the pinned `effect` 4.1.0 ([Configuration](007-tooling.md#the-effect-version)). [Pattern matching](004-match.md#class-patterns) follows VIP-7’s pinned TC39 snapshot and its explicit Effect-pattern adaptations.
- **The guarantee.** Compiled output gives the same `Exit` as the accepted VIP’s Effect TypeScript counterpart: success, failure, defect or interruption, with finalizers run in the same order. This specification spells out that counterpart without changing its operand evaluation order. Compare the `Cause` structure as well as success values, and record finalizer traces separately.
- **How it is checked.** Each VIP’s VibeLang and Effect TypeScript pair is a differential test: it compiles the VibeLang, runs both, and compares their `Exit`s and finalizer traces. The fuzz suite generates more pairs. Checking only the Effect TypeScript validates the counterpart, not compiler conformance; skipped pairs establish no conformance.
- **Runtime helpers** do not patch Effect ([VIP-7](../vips/0007-match.md)). They implement only the specified adaptations: defining `Symbol.customMatcher` where absent; `$is`/`$extract` for the snapshot’s inherited `Function.prototype` matcher and built-in constructor matchers (`Array`, `Error`, `Map`, `Set`, `Date`, `Promise`, etc.) without modifying those globals; generated error matchers; and the retained fixed checks for Effect’s `Option`, `Exit`, `Result` and tagged errors (VIP-7). These checks follow resolved bindings, including aliases, not identifier spelling. The six `Option`/`Exit`/`Result` tests and extracted fields are specified in [Pattern matching](004-match.md#class-patterns). VIP-7 keeps today’s fixed checks for Effect’s tagged errors until Effect ships matchers; neither inherited instance matching nor a new universal `_tag` test replaces them.
- **Undecided (pending VIP):** the retained Effect tagged-error inventory: resolved constructor identities, ordered subject tests, extracted lists and arity rules ([Pattern matching](004-match.md#class-patterns)). VIP-7 requires retaining these checks; it does not enumerate them. No complete Effect TypeScript counterpart for this inventory is specified yet; the same-Exit guarantee cannot certify those patterns until that counterpart is supplied.
- **Source bindings and control flow survive lowering.** Bindings and jump targets are resolved on the source before any callback is introduced. Function bodies follow [Functions](001-functions.md#meaning) (`this`, `super`, `new.target`); region bodies follow [Region bodies](002-running.md#region-bodies) (completion records for outward jumps, not a continuation runtime); expressions follow the [expression-lowering rule](002-running.md#do-expressions) (call references, receivers, short-circuits). A nested source function keeps its own bindings. The legacy JavaScript uses listed in [Legacy JavaScript](001-functions.md#direct-eval) are compile errors throughout `.vibe`, so no lowering has to preserve them. Type references such as `Function` and property names such as `o.arguments` keep TypeScript’s meaning. **Undecided (pending VIP):** whether the `Function` ban also covers aliases (`const F = Function`) and non-call references (`x instanceof Function`, `Function.prototype`); the amendment explicitly bans `Function(...)` and `new Function(...)`, but does not settle those other uses.
- Effect handlers would need a continuation runtime. They are an open VIP ([VIP-35](../vips/0035-handlers-open.md)), not part of the language.

```vibe es
// compiler-gap: pending VIP-22
effect function binding() {
  let x = 0
  const read = () => x
  uninterruptible { x = 1 }
  return read()                     // 1: the block assigns the function's x
}
```

```ts
import { Effect } from "effect"

function binding() {
  return Effect.gen(function* () {
    let x = 0
    const read = () => x
    yield* Effect.uninterruptibleMask(($restore) => Effect.gen(function* () { x = 1 }))
    return read()
  })
}
if (Effect.runSync(binding()) !== 1) throw new Error("binding changed")
```

`using` keeps TypeScript’s meaning ([VIP-8](../vips/0008-using-denied.md), denied). It disposes when JavaScript control leaves its scope, including by `return` or a JavaScript throw. A non-success `Exit` of an Effect run by `try` (typed failure, defect or interruption) abandons the `Effect.gen` generator without unwinding that scope. Use Effect’s `scoped`, `acquireRelease`, `acquireDisposable` or `addFinalizer` for cleanup on every Effect exit. `using` in effect code gets a warning, with a quick fix to `acquireDisposable` inside `scoped`; the warning does not change disposal semantics.

```vibe es
// compiler-gap: pending VIP-8
// openFile is the plain helper in the shared TypeScript fixture below.
import { openFile } from "./resource.ts"
effect function unsafe(defect = false) {
  using f = openFile()               // warning: use acquireDisposable inside scoped
  if (defect) try die("boom")         // defect: disposer is also skipped
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
import { Effect, Exit } from "effect"

export const trace: string[] = []
/** @throws {never} */
export function openFile(): Disposable {
  return { [Symbol.dispose]() { trace.push("dispose") } }
}
function unsafe(defect = false) {
  return Effect.gen(function* () {
    using f = openFile()
    if (defect) return yield* Effect.die("boom")
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
// Run separately: both fail with "bad"; unsafe leaves trace empty, safe appends "dispose".
const unsafeExit = Effect.runSyncExit(unsafe())
const unsafeTrace = trace.slice()     // []
trace.length = 0
const safeExit = Effect.runSyncExit(safe())
const safeTrace = trace.slice()       // ["dispose"]
trace.length = 0
const defectExit = Effect.runSyncExit(unsafe(true))
const defectTrace = trace.slice()     // []
if (!Exit.isFailure(unsafeExit) || !Exit.isFailure(safeExit)) throw new Error("expected failures")
if (!Exit.isFailure(defectExit) || defectTrace.length !== 0) throw new Error("defect disposal changed")
if (unsafeTrace.length !== 0 || safeTrace.join() !== "dispose") throw new Error("disposal changed")
```
