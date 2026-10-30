# Runtime guarantees

Source: [VIP-31](../vips/0031-runtime-guarantees.md).

- **No independent Effect runtime semantics.** Every accepted construct is sugar for its specified counterpart. Failures, defects, interruption, finalizer order and the combination of causes are those of the pinned `effect` 4.1.0 ([Configuration](007-tooling.md#the-effect-version)). [Pattern matching](004-match.md#class-patterns) follows VIP-7’s pinned TC39 snapshot and its explicit Effect-pattern adaptations, including the class tests in decided details 67 and 67a.
- **Module boundaries.** The [source module classification](001-functions.md#modules-and-the-top-level) is fixed before checking and survives JavaScript and declaration emission; a generated prelude import cannot change binding visibility or select different script-versus-module behavior. Execution still follows the configured output format and its ordinary host rules.
- **The guarantee.** Compiled output gives the same `Exit` as the accepted VIP’s Effect TypeScript counterpart: success, failure, defect or interruption, with finalizers run in the same order. This specification spells out that counterpart. [Running Effects](002-running.md) specifies operand order: temporaries preserve source order wherever Effect's argument order differs, `fork.in(scope) e` included (decided detail 84). Compare the canonical `Exit` and the finalizer trace (decided detail 91). The canonical form is `CanonicalVIPExit` in `typescript/tsc/internal/vibelangfuzz/vip.go`: object keys are ordered; `Cause.reasons` retain their order and each reason’s `_tag` and `error`, `defect` or `fiberId`; payloads recursively encode class name (`$class`), own enumerable fields and an error’s `name` and `message`, dropping `stack`; fiber IDs are renamed by first appearance. The encoded object’s `fields` dictionary treats source property names as data: they cannot select runtime tags or invoke inherited setters. Its encoded values still validate and normalize actual nested runtime values. Object identity is not compared: independently allocated errors with equal encoded fields agree. A fixture names any extra comparison it needs.
- **How it is checked.** Each VIP’s VibeLang and Effect TypeScript pair is a differential test: it compiles the VibeLang, runs both, and compares their `Exit`s and finalizer traces. The fuzz suite generates more pairs. It also compares recorded events at the function call, before running its returned Effect, and the complete ordered event trace after the run (`VIPCompare` in `typescript/tsc/internal/vibelangfuzz/vip.go`). Equal `Exit`s alone cannot distinguish an eager body from a cold one. Call-time events, including parameter-default evaluation, must match the counterpart; running the same returned Effect again reruns its body, without repeating the call or its defaults (VIP-1, VIP-2). Checking only the Effect TypeScript validates the counterpart, not compiler conformance; skipped pairs establish no conformance.
- **Runtime helpers** do not patch Effect ([VIP-7](../vips/0007-match.md)). They implement only the specified adaptations: defining `Symbol.customMatcher` where absent; generated error matchers; the class tests below and the pinned snapshot's extraction rules, without modifying built-in globals; and the retained fixed checks for Effect's `Option`, `Exit`, `Result` and tagged errors (VIP-7). These checks follow resolved bindings, including aliases, not identifier spelling. The thirty-nine fixed tests and extracted lists are listed once in [Retained fixed patterns](004-match.md#retained-fixed-patterns) (decided details 86 and 92). VIP-7 keeps today’s fixed checks for Effect’s tagged errors until Effect ships matchers; neither inherited instance matching nor a new universal `_tag` test replaces them.
- **Class patterns** have one definition, in [Class patterns](004-match.md#class-patterns) and [Retained fixed patterns](004-match.md#retained-fixed-patterns): a retained guard, an own `Symbol.customMatcher`, a built-in test, `instanceof`, or a call, chosen in that order. This deliberately differs from the pinned draft's `[[ConstructedBy]]` and internal-slot tests, which JavaScript cannot read for untouched `.ts` and `.js` objects. No helper patches `Function.prototype` or records construction.
- **Source bindings and control flow survive lowering.** Bindings and jump targets are resolved on the source before any callback is introduced. Function bodies follow [Functions](001-functions.md#meaning) (`this`, `super`, `new.target`); region bodies follow [Region bodies](002-running.md#region-bodies) (source completions kept separately from primitive Effect success payloads); expressions follow the [evaluation-order rule](002-running.md#evaluation-order) (call references, receivers, short-circuits); destructuring and parameter defaults behave as [JavaScript with the `do` proposal](002-running.md#destructuring-and-parameter-defaults). The lowering is the implementation's choice, checked by those sections' examples and the fuzz suite. A nested source function keeps its own bindings. The legacy JavaScript uses listed in [Legacy JavaScript](001-functions.md#direct-eval) are compile errors throughout `.vibe`, so no lowering has to preserve them. Type references such as `Function` and property names such as `o.arguments` keep TypeScript’s meaning.
- **Source names survive captures.** Generated pipe, `do`/`match` and completion-record temporaries preserve [source naming context](001-functions.md#source-names), including what class static initializers observe; a generated binding cannot add an anonymous name, erase an intended name, or repair it after creation.
- **Match cache and cleanup** follow the pinned draft's `CreateMatchCache` and `FinishMatch`, as [Pattern matching](004-match.md#leaving-a-match) states them.
- **Region observers.** `provide` and interruption regions preserve the original generator payload at every Effect/Scope boundary: normal completion and outward `break`/`continue` succeed with `undefined`, while source `return value` succeeds with that value, preserving identity. Source completion values and targets are carried separately and transferred only after successful finalization. Nested regions apply the rule independently; compiler control records never become finalizer payloads. See [Region bodies](002-running.md#region-bodies).
- <a id="abandonment"></a>**Abandonment.** A rejected `await` resumes the `async` function with a throw. A failed `try` never resumes the generator. `try e` is `yield* e`, and `Effect.gen` calls only the generator's `next`, only on success. So when a `yield*` in effect code fails, dies or is interrupted, no JavaScript after it runs: no `using` disposal, no destructuring `IteratorClose`, no `FinishMatch`. `throw e` in effect code is `return yield* Effect.fail(e)`, so every `throw` abandons the generator, wherever it stands: in an arm, a guard, or a `do` in either. A JavaScript exception is different: a getter that throws, the no-match `TypeError` or a call that throws unwinds the generator, runs that cleanup, and then becomes a defect. Use `ensuring`, `scoped` or `acquireRelease` for cleanup on every exit.
- Effect handlers would need a continuation runtime. They are an open VIP ([VIP-35](../vips/0035-handlers-open.md)), not part of the language.


The call below evaluates its default once. Each run then succeeds with `7` and appends one body event:

```ts effect
// Coldness witness: VIP-1, VIP-2, VIP-31
import { Effect, Exit } from "effect"

const trace: string[] = []
function parameter() { trace.push("parameter"); return 7 }
function program(value = parameter()) {
  return Effect.gen(function* () { trace.push("body"); return value })
}
const p = program()
const called = trace.slice()
if (called.includes("body")) throw new Error("body ran during construction")
if (called.join() !== "parameter") throw new Error("call-time default changed")
const first = Effect.runSyncExit(p)
const second = Effect.runSyncExit(p)
if (!Exit.isSuccess(first) || first.value !== 7 ||
    !Exit.isSuccess(second) || second.value !== 7) throw new Error("Exit changed")
if (trace.join() !== "parameter,body,body") throw new Error("body did not rerun")
```

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

A default's suspensions and jumps stay in the enclosing function:

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
    const { x = yield* Effect.succeed(7) } = {} as { x?: number }
    const { y } = {} as { y?: number }
    if (y === undefined) return x   // the source's default returns from the function
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

A one-element producer buffer bounds queued elements, not concurrent emitter work. The [producer bound](002-running.md#producers) of two elements applies to one sequential emitter. Each concurrent item can evaluate its value before waiting in `Queue.offer`; an unbounded loop has no constant global lead bound. This Effect TypeScript witness succeeds with `{ started: 8, consumed: 1 }`, so seven values have been evaluated ahead of the consumer:

```ts effect
// Concurrent producer witness: VIP-19, VIP-21, VIP-31
import { Deferred, Effect, Exit, Queue, Stream } from "effect"

const inspect = Effect.gen(function* () {
  const started: number[] = []
  const ready = yield* Deferred.make<void>()
  const stream = Stream.callback<number>(queue => Effect.gen(function* () {
    yield* Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8], n => Effect.gen(function* () {
      started.push(n)
      if (started.length === 8) yield* Deferred.succeed(ready, undefined)
      yield* Queue.offer(queue, n)
    }), { concurrency: "unbounded", discard: true })
  }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
  let consumed = 0
  yield* Stream.runForEachWhile(stream, () => Effect.gen(function* () {
    consumed++
    yield* Deferred.await(ready)
    return false
  }))
  return { started: started.length, consumed }
})
const outcome = await Effect.runPromiseExit(Effect.timeout(inspect, "2 seconds"))
if (!Exit.isSuccess(outcome)) throw new Error("concurrent producer stalled")
if (outcome.value.started !== 8 || outcome.value.consumed !== 1) {
  throw new Error("concurrent producer lead changed")
}
```

`using` keeps TypeScript’s meaning ([VIP-8](../vips/0008-using-denied.md), denied). It disposes when JavaScript control leaves its scope, including by `return` or a JavaScript throw; on a success `Exit`, the disposer runs as in TypeScript. A non-success `Exit` of an Effect run by `try` [abandons](#abandonment) the generator without unwinding that scope. Use Effect’s `scoped`, `acquireRelease`, `acquireDisposable` or `addFinalizer` for cleanup on every Effect exit. `using` in effect code gets a warning (`EK0801`), with a quick fix to `acquireDisposable` inside `scoped`; the warning does not change disposal semantics.

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


### Region finalizer observations

```vibe es
// compiler-gap: pending VIP-2, VIP-12
effect function normalObservation() { return do { provide observed { 7 } } }
effect function returnObservation() { provide observed { return 7 } }
```

```ts effect
import { Effect, Layer } from "effect"

const released: unknown[] = []
const observed = Layer.effectDiscard(Effect.addFinalizer(exit => Effect.sync(() => { released.push(exit) })))
function normalObservation() {
  return Effect.gen(function* () {
    let value = 0
    yield* Effect.provide(Effect.gen(function* () { value = 7 }), observed)
    return value
  })
}
function returnObservation() {
  return Effect.provide(Effect.gen(function* () { return 7 }), observed)
}
// Both outer Exits are Success(7); their layer-finalizer Exits are
// Success(undefined) and Success(7), respectively.
```

A source field name that resembles a comparison tag remains data. These Effects succeed with distinct records; each computed `__proto__` key is an ordinary own property:

```ts effect
// Source-field witness: VIP-31
import { Effect, Exit } from "effect"

const first = Effect.runSyncExit(Effect.succeed({ $fiber: 1, ["__proto__"]: 7 }))
const second = Effect.runSyncExit(Effect.succeed({ $fiber: 2, ["__proto__"]: 8 }))
if (!Exit.isSuccess(first) || !Exit.isSuccess(second)) throw new Error("expected successful records")
if (first.value.$fiber !== 1 || second.value.$fiber !== 2 ||
    first.value["__proto__"] !== 7 || second.value["__proto__"] !== 8 ||
    !Object.hasOwn(first.value, "__proto__") || !Object.hasOwn(second.value, "__proto__")) {
  throw new Error("source fields changed")
}
// Success({ $fiber: 1, ["__proto__"]: 7 }) differs from Success({ $fiber: 2, ["__proto__"]: 8 }).
```
