# Runtime guarantees

Source: [VIP-31](../vips/0031-runtime-guarantees.md).

- **No independent Effect runtime semantics.** Every accepted construct is sugar for its specified counterpart. Failures, defects, interruption, finalizer order and the combination of causes are those of the pinned `effect` 4.1.0 ([Configuration](007-tooling.md#the-effect-version)). [Pattern matching](004-match.md#class-patterns) follows VIP-7’s pinned TC39 snapshot and its explicit Effect-pattern adaptations, including the class tests in decided details 67 and 67a.
- **The guarantee.** Compiled output gives the same `Exit` as the accepted VIP’s Effect TypeScript counterpart: success, failure, defect or interruption, with finalizers run in the same order. This specification spells out that counterpart. [Running Effects](002-running.md) specifies operand order: temporaries preserve source order wherever Effect's argument order differs, `fork.in(scope) e` included (decided detail 84). Compare the canonical `Exit` and the finalizer trace (decided detail 91). The canonical form is `CanonicalVIPExit` in `typescript/tsc/internal/vibelangfuzz/vip.go`: object keys are ordered; `Cause.reasons` retain their order and each reason’s `_tag` and `error`, `defect` or `fiberId`; payloads recursively encode class name (`$class`), own enumerable fields and an error’s `name` and `message`, dropping `stack`; fiber IDs are renamed by first appearance. Object identity is not compared: independently allocated errors with equal encoded fields agree. A fixture names any extra comparison it needs.
- **How it is checked.** Each VIP’s VibeLang and Effect TypeScript pair is a differential test: it compiles the VibeLang, runs both, and compares their `Exit`s and finalizer traces. The fuzz suite generates more pairs. Checking only the Effect TypeScript validates the counterpart, not compiler conformance; skipped pairs establish no conformance.
- **Runtime helpers** do not patch Effect ([VIP-7](../vips/0007-match.md)). They implement only the specified adaptations: defining `Symbol.customMatcher` where absent; generated error matchers; the class tests below and the pinned snapshot's extraction rules, without modifying built-in globals; and the retained fixed checks for Effect's `Option`, `Exit`, `Result` and tagged errors (VIP-7). These checks follow resolved bindings, including aliases, not identifier spelling. The thirty-nine fixed tests and extracted lists are listed once in [Retained fixed patterns](004-match.md#retained-fixed-patterns) (decided details 86 and 92). VIP-7 keeps today’s fixed checks for Effect’s tagged errors until Effect ships matchers; neither inherited instance matching nor a new universal `_tag` test replaces them.
- **Effect tagged-error patterns** run the resolved constructor’s module guard and extract `[subject]`; an extractor with the wrong arity fails to match (VIP-7, D208; decided details 53 and 92). The subject’s static type never selects the test; every other Effect tagged-error constructor follows the ordinary class rule below. The thirty-three guards, including public `effect/…` subpath modules, are in [Retained fixed patterns](004-match.md#retained-fixed-patterns).
- **Ordinary class patterns** use `subject instanceof C` unless the class supplies its own `Symbol.customMatcher` (`Object.hasOwn(C, Symbol.customMatcher)`); an inherited static matcher does not count under decided details 67 and 93: otherwise a `.ts` subclass of a generated error would inherit a matcher accepting every instance of its parent. Thus `class B extends A {}` uses `instanceof B` when only `A` defines a matcher; generated and retained Effect matchers still take priority (decided detail 67). This deliberately differs from the pinned TC39 draft’s `[[ConstructedBy]]` test: JavaScript cannot recover construction history for untouched `.ts`/`.js` objects. No helper patches `Function.prototype` or records construction. **Built-in class patterns** use `Array.isArray(subject)` for `Array` and `subject instanceof C` for every other built-in constructor (decided detail 67a); the five primitive classes also accept the primitive, `typeof subject === "string" || subject instanceof String` (decided detail 87); then apply the snapshot's extraction rules. This covers every constructor given a matcher in the [pinned snapshot](../vips/tc39-pattern-matching/spec.emu), including native errors. Cross-realm built-ins fail `instanceof`, except arrays; prototype changes have the same consequences as for ordinary classes. These tests replace inaccessible internal-slot checks; no helper emulates `[[ErrorData]]` or `[[ConstructedBy]]`. Subject narrowing and extracted binding types follow the actual TypeScript test and extraction, not the constructor’s name (decided detail 79); an own matcher does not imply `instanceof` narrowing, and `Array(let n)` extracts an element, not the array.
- **Callable patterns without an own matcher** follow decided detail 94 after the fixed, built-in and declaration-specific checks above: a static construct signature selects `instanceof` and the draft extraction; call signatures only select `C(subject, { matchType })`, preserving the receiver. A bare predicate must return `boolean`; an extractor must return `Iterable<unknown> | false`. Other return types, or a callee typed `any`, `unknown`, `Function` or non-callable, are `EK0702`; use an explicit guard instead. Type predicates narrow as TypeScript does. An ordinary class fallback returns `true`, not an iterable: an extractor on a matching instance throws `TypeError`. The extractor form `when C(…)`, including `C()`, is `EK0704` on that ordinary construct-signature path (decided detail 100); use `when C:` or a class test followed by an object pattern. An inherited matcher does not exempt a subclass. The runtime rule is unchanged.
- **Source bindings and control flow survive lowering.** Bindings and jump targets are resolved on the source before any callback is introduced. Function bodies follow [Functions](001-functions.md#meaning) (`this`, `super`, `new.target`); region bodies follow [Region bodies](002-running.md#region-bodies) (completion records for outward jumps, not a continuation runtime); expressions follow the [expression-lowering rule](002-running.md#do-expressions) (call references, receivers, short-circuits). Defaults containing suspension or an outward jump execute conditionally in the enclosing activation, never an inserted arrow (decided details 68a and 68b). Expression-only defaults stay in native destructuring; expanded patterns preserve ECMAScript IteratorClose completion precedence, receiver, object-result checks and iterator-record done state. A pending JavaScript throw wins over a close error; otherwise closing errors propagate. Effect failure still abandons the generator without closing it. Local binding initialization keeps its TDZ and evaluation order: each binding is initialized before normal iterator closing, remains visible to closing callbacks in its source scope, and stays initialized if closing throws. Expanded iterator operations use captured intrinsics, non-coercing object checks and native host protocol errors, preserving their `name` and `message` for the canonical comparison (decided details 68b and 91). Moved parameter defaults execute in the outer call before `return Effect.gen(…)` or `Stream.callback(…)`, retaining the detail-68 protocol and its scope divergence; an outward `return v` returns `Effect.succeed(v)` from that call ([Expression lowering](002-running.md#do-expressions)), so the call still gives an Effect. A nested source function keeps its own bindings. The legacy JavaScript uses listed in [Legacy JavaScript](001-functions.md#direct-eval) are compile errors throughout `.vibe`, so no lowering has to preserve them. Type references such as `Function` and property names such as `o.arguments` keep TypeScript’s meaning.
- **Match cache and cleanup** follow the pinned draft's `CreateMatchCache` and `FinishMatch` ([Pattern matching](004-match.md)). Within one `match`, property presence, reads, iterator lookups and pulled values are cached per subject across arms. After the selected arm or no-match `TypeError`, cached iterators that are not done are closed; multiple errors, including an arm error and closing errors, become an `AggregateError` in draft order. In effect code, a failed, defective or interrupted `try`, or a typed `throw` in a guard or arm, abandons the generator before `FinishMatch`, skipping that closing just as for `using` and destructuring. Protocol errors are implicit defects (decided detail 95).
- Effect handlers would need a continuation runtime. They are an open VIP ([VIP-35](../vips/0035-handlers-open.md)), not part of the language.


```vibe es
// compiler-gap: pending VIP-7
const timeout = new Cause.TimeoutError()
const matched = match (timeout) {
  when Cause.TimeoutError(let e): e;
  default: undefined;
}
```

```ts effect
import { Cause } from "effect"

const timeout = new Cause.TimeoutError()
const matched = Cause.isTimeoutError(timeout) ? timeout : undefined
if (matched !== timeout) throw new Error("extractor changed")
// A matching _tag alone does not satisfy the retained module guard.
if (Cause.isTimeoutError({ _tag: "TimeoutError" })) throw new Error("tag-only match")
```


```vibe es
// compiler-gap: pending VIP-7
const isText = (x: unknown): x is string => typeof x === "string"
const textMatch = match ("ok" as unknown) { when isText: true; default: false; }
```

```ts effect
// The pinned matcher call supplies the hint; a predicate may ignore it.
const isText = (x: unknown, _hint?: { matchType: "boolean" }): x is string => typeof x === "string"
const subject: unknown = "ok"
const textMatch = isText(subject, { matchType: "boolean" }) ? true : false
if (!textMatch) throw new Error("predicate match lost")
```

A prototype change exposes the ordinary-class divergence (the shared fixture is `foreign.ts`):

```vibe es
// compiler-gap: pending VIP-7
import { Foreign, real, fake } from "./foreign.ts"
effect function classify(x: unknown) {
  return match (x) { when Foreign: "yes"; default: "no"; }
}
// classify(real) succeeds with "no"; classify(fake) succeeds with "yes".
```

```ts effect
import { Effect } from "effect"

// foreign.ts: untouched TypeScript objects, without construction instrumentation.
export class Foreign {}
export const real = new Foreign()
Object.setPrototypeOf(real, null)
export const fake: unknown = Object.create(Foreign.prototype)

function classify(x: unknown) {
  return Effect.gen(function* () { return x instanceof Foreign ? "yes" : "no" })
}
if (Effect.runSync(classify(real)) !== "no") throw new Error("prototype change ignored")
if (Effect.runSync(classify(fake)) !== "yes") throw new Error("prototype match lost")
```

```vibe es
// compiler-gap: pending VIP-7
const arrayMatch = match ([]) { when Array: true; default: false; }
const errorMatch = match (new TypeError("bad")) { when TypeError: true; default: false; }
```

```ts effect
import { Effect } from "effect"

const arrayMatch = Array.isArray([])
const errorMatch = new TypeError("bad") instanceof TypeError
if (!Effect.runSync(Effect.succeed(arrayMatch && errorMatch))) throw new Error("built-in match lost")
```

```vibe es
// compiler-gap: pending VIP-22
effect function binding() {
  let x = 0
  const read = () => x
  uninterruptible { x = 1 }
  return read()                     // 1: the block assigns the function's x
}
```

```ts effect
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

```vibe es
// compiler-gap: pending VIP-7
class Point { constructor(readonly x: number) {} }
const point: unknown = new Point(7)
// when Point(let x): is EK0704; use the class test and object pattern:
const coordinate = match (point) { when Point and { x: let x }: x; default: 0; }
```

```ts effect
class Point { constructor(readonly x: number) {} }
const point: unknown = new Point(7)
const coordinate = point instanceof Point && "x" in point ? point.x : 0
if (coordinate !== 7) throw new Error("class test lost")
```

Body defaults stay in the same generator; moved parameter defaults run before it:

```vibe es
// compiler-gap: pending VIP-2
effect function defaults() {
  const { x = do { try succeed(7) } } = {}
  const { y = do { return x } } = {}
  return 0
}
```

```ts effect
import { Effect } from "effect"

function defaults() {
  return Effect.gen(function* () {
    const $object: { x?: number } = {}
    let $value = $object.x
    if ($value === undefined) $value = yield* Effect.succeed(7)
    const x = $value
    const $other: { y?: number } = {}
    const $y = $other.y
    if ($y === undefined) return x
    const y = $y
    return 0
  })
}
if (Effect.runSync(defaults()) !== 7) throw new Error("default left its activation")
```

```vibe es
// compiler-gap: pending VIP-2
effect function eager(x = do { return null }) { return 1 }
// eager() is an Effect that succeeds with null, built when eager() is called
```

```ts effect
import { Effect } from "effect"

let built = 0
function eager(x: unknown = undefined): Effect.Effect<number | null> {
  if (x === undefined) { built++; return Effect.succeed(null) }   // runs at the call, before the generator
  return Effect.gen(function* () { return 1 })
}
const e = eager()
if (built !== 1) throw new Error("parameter default became cold")
if (Effect.runSync(e) !== null) throw new Error("default return lost")
if (Effect.runSync(eager(0)) !== 1) throw new Error("body changed")
```

`using` keeps TypeScript’s meaning ([VIP-8](../vips/0008-using-denied.md), denied). It disposes when JavaScript control leaves its scope, including by `return` or a JavaScript throw; on a success `Exit`, the disposer runs as in TypeScript. A non-success `Exit` of an Effect run by `try` (typed failure, defect or interruption) abandons the `Effect.gen` generator without unwinding that scope. Use Effect’s `scoped`, `acquireRelease`, `acquireDisposable` or `addFinalizer` for cleanup on every Effect exit. `using` in effect code gets a warning (`EK0801`), with a quick fix to `acquireDisposable` inside `scoped`; the warning does not change disposal semantics.

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

```ts effect
import { Effect, Exit } from "effect"

export const trace: string[] = []
/** @throws {never} */
export function openFile(): Disposable {
  return { [Symbol.dispose]() { trace.push("dispose") } }
}
function unsafe(defect = false) {
  return Effect.gen(function* () {
    using f = openFile()
    if (defect) yield* Effect.die("boom")
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
