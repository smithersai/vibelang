# VIP-21: producers: `effect function*` returns a Stream

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
effect function* ticks() {
  yield 1
  try sleep("1 second")
  yield 2
}
for try (const t of ticks()) { … }       // VIP-20

// compiles to Effect's Stream.callback
const ticks = () => Stream.callback<number>((queue) => Effect.gen(function* () {
  yield* Queue.offer(queue, 1)
  yield* Effect.sleep("1 second")
  yield* Queue.offer(queue, 2)
}).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })   // ends the stream when the body returns
```

- `effect function*` returns a Stream, as `async function*` returns an AsyncIterable. `yield x` emits `x`, and `try` runs Effects (VIP-5).
- A plain `function*` stays a JavaScript generator.
- **Amended 2026-10-30: inferred producer requirements.** Infer the body requirements `RBody` as for an `Effect`, then expose `Exclude<RBody, Scope.Scope>` on the `Stream`: the accepted `Stream.callback` supplies its `Scope`. Other service requirements remain. Explicit annotations keep ordinary contract checking, and values of type `Scope.Scope` is unchanged. Each callback consumption owns that provided `Scope`; this adds no new scheduling or finalizer order. See [Producers](../src/002-running.md#producers) and the [typed lifetime witness](../src/008-runtime.md).
- It compiles to Effect's `Stream.callback` with one element of buffer. For one sequential emitter, the producer may run up to two elements ahead of the consumer: one in the buffer and one waiting to be offered. With concurrent yields, each active item fiber can evaluate a value before waiting in `Queue.offer`; the one-element buffer does not bound all pending offers or upstream work. Unbounded concurrency has no constant global lead bound. A finite concurrency limit bounds active pending emitters in addition to the buffered element and work already consumed. Exact pull semantics, which would need a continuation runtime, are not provided.
- `return value` in a producer is a compile error, because a Stream has no return value. A bare `return` ends the stream.
- **Amended 2026-10-30: the producer-return diagnostic is `EK2128`.** `return value` in a producer is `EK2128`, because a Stream has no return value; a bare `return` ends the stream. This assigns the next free code in VIP-21's block, replacing the old `EK2101`, which `0.0.10` reports for another rule. The old `EK2101` is retired and will never be reassigned. Earlier numbers in VIP-21's block are already taken or historical, so this changes no diagnostic's meaning for a `0.0.10` user. Decided by the agent on 2026-10-30 under VIP-34's code-numbering amendment.
- **Ambiguity: none** for `effect function* name()`. The shorthand `effect *name()` exists only for methods, as `async *gen()` does in TypeScript. At top level it could parse as multiplication.
- **Amended 2026-10-29: no delegation yet.** `yield*` in a producer is a compile error until a VIP specifies delegation. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 50).

## History

About 9 findings, on the old design (a type decided a producer's fiber; a runtime built on continuations). Neither applies to this design.

- **Amended 2026-10-30: parameter yield ownership.** `yield` in directly evaluated formal-parameter initialization of any Effect callable, a producer included, is `EK2104`. A producer owns `yield` in its body, not its parameter initialization; nested native generators and ordinary async callables keep their own contexts. The existing nonproducer Effect-body rejection remains unchanged.

## Prior art

JavaScript's `async function*`, Kotlin's `flow { emit(x) }`, Python's async generators.

## Will's words

> "Accept"

*Corrected 2026-10-29: one sequential emitter can run up to two elements ahead (one buffered, one waiting); concurrent emitters can each have a pending offer. The Effect TS needs `Queue.end(queue)` after the body, or the stream never completes (found by the differential fuzz suite).*

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 50

(NW 12; VIP-21) `yield*` in a producer (`effect function*`) is a compile error until a VIP specifies delegation.
    ```vibe
    effect function* p() { yield* other() }   // error
    ```
    Effect TS: none chosen (`Stream.concat` is one candidate). Decided by the agent from principle 8; 2026-10-29.

### Detail 225

**A producer's inferred requirements exclude the Scope supplied by its accepted Stream callback.** (Opus round28 m44; accepted VIP-21/VIP-32 counterpart.) Infer the producer body with the existing Effect/producer rules, then expose environment `Exclude<R, Scope.Scope>` on the resulting `Stream.Stream<A, E, ...>`, exactly as pinned Effect4.1.0 `Stream.callback` does. Its callback already receives `R | Scope.Scope`; a producer's `fork.scoped` therefore does not impose an external Scope requirement just because the same operation in an ordinary unscoped Effect body would. Keep every other service requirement and the existing output/error types. Preserve explicit written annotations under their ordinary assignability/contract rules; this is the inferred counterpart rule, not a global rewrite of arbitrary user type aliases or every Stream-returning signature. Do not globally remove Scope from Effect functions, foreign Stream values or unrelated higher-order contracts. Scope-valued data is ordinary data, independently of environment inference.
    Status: applied in 8bf1ba748f420a8917261b32c17102d74716d234 (spec-fix-d; verified and queued, not a main receipt).

    Each native callback/consumption owns its provided Scope; scoped children and finalizers follow that actual callback/Stream lifetime. Preserve cold body execution, fresh per-consumption state, cancellation and backpressure; do not promise an added start/finish ordering or a new ownership policy from the type subtraction. Eager parameter initialization and producer return/yield rules remain unchanged.
    ```vibe
    effect function* values() {
      fork.scoped never // Scope is supplied by the accepted producer counterpart
      yield 1
    }
    // inferred Stream.Stream<number>; callers need no external Scope for this body
    ```
    Effect TS:
    ```ts
    const values = Stream.callback<number>(queue => Effect.gen(function* () {
      yield* Effect.forkScoped(Effect.never)
      yield* Queue.offer(queue, 1)
      yield* Queue.end(queue)
    }), { bufferSize: 1, strategy: "suspend" })
    // Stream<number, never, never>
    ```
    Decided by the agent from accepted VIP-21's exact `Stream.callback` counterpart, VIP-32's Effect4.1.0 pin, principle1 (idiomatic Effect provides this Scope) and principle2 (the pinned generic signature determines the environment), 2026-10-30. `root-producer-scope-reference.log` passes strict TypeScript5.9.3: the ordinary body is `Effect<void, never, Scope>`, the scoped-only callback is `Stream<number, never, never>`, and a callback also using Service retains `Stream<number, never, Service>`. Two native consumptions succeed with `[1]` without an external Scope; the body is cold and its finalizer runs once per consumption. These prove the accepted counterpart's types/runtime, not VibeLang compiler conformance or a source landing. Qualify002's 'R inferred as for an effect function' and the relevant producer/VIP/declaration guidance together.


    **Earlier accepted source receipt (later rejected: producer Scope; stale001 context):** applied in9b8ed775a10743d8fa5a1423a89ea9c7b37d67d0 (spec-fix-d/bookmark32, independent queued commit; not main). Supersedes rejected8bf1ba748f42 after queue acceptance, retaining the exact original Node/native regression and typed lifetime witness while composing the landed producer-lead/newer source clauses. Three immutable-main regressions fail; Node3/Bun3, exact strictTS5.9.3 environment controls and nativeEffect4.1.0 cold/fresh/finalized consumptions pass. Spec/docs/regeneration/forms pass; no form changes. Rebase only generated token conflicts were regenerated; changed pages scanned free of merge markers. ORIGINS identifies this as the producerR/Scope interaction, explicitly not a Circle in v28. No new compiler-conformance or main receipt.

    Applied in d3020bc2f4eefd238467d242b1742c479ae47a4b (spec-fix-d/bookmark37; complete independent replacement, queued not main). Rejected9b8 superseded only after acceptance; same original3 regressions/type/lifetime counterpart retained while preserving newer001 declaration context. Node/Bun/strict-native/spec/docs/regen/forms pass without decision moves.

    **Immutable-main source publication (773bddb1d57f, 225).** Chapters 001/002/008 and public VIP-21 publish inferred producer `Exclude<RBody, Scope.Scope>`, preserving other requirements, explicit annotation checking and `Scope.Scope` values. The typed two-consumption witness records cold construction and a fresh/finalized callback `Scope.Scope` per consumption. This is source publication only; decide-live did not execute the witness. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.

### Detail 287

**A producer's written return annotation must expose its Stream contract, just as an Effect function's annotation exposes its Effect contract.** (R10 Opus OPUS-3; accepted VIP-21, chapter002's existing `EK2102` row, chapter001's `EK0106` rule; principles1/4/8.) After normal type-alias resolution, an explicit producer annotation must resolve to `Stream.Stream<A,E,R>`. A bare `any`, `unknown` or `never`, or a genuine union in place of that Stream contract, is `EK2102`. Aliases of the accepted Stream type remain valid. Ordinary TypeScript normalization still applies: an alias such as `Stream.Stream<number> | never` that resolves to the single Stream type is not a new rejection. A union success channel inside `Stream.Stream<A | B,E,R>` is likewise a Stream.

    The inferred form is unchanged: omit the annotation to infer the Stream's channels under VIP-21, including its Scope subtraction. A written contract supplies the existing element/error/requirement checks; this decision creates no channel-slot inference, new annotation syntax or change to yield, buffer or return-value behavior. Preserve independent native body/type diagnostics, with `EK2102` owning this invalid written-return contract.

    ```vibe
    type Numbers = Stream.Stream<number>
    effect function* values(): Numbers { yield 1 }       // valid alias
    effect function* erased(): unknown { yield 1 }       // EK2102
    effect function* choices(): Stream.Stream<number> | undefined { yield 1 } // EK2102
    ```

    Effect TypeScript counterpart for the type boundary is `const values = (): Stream.Stream<number> => Stream.make(1)`; the general producer expansion remains VIP-21's `Stream.callback`. This exact-contract restriction is deliberately stricter than TypeScript's native `async function*` annotation check, which the reviewer shows accepting `any` and `unknown`. VibeLang's producer is the promised Stream-producing callable, with the same explicit-container requirement as `EK0106`, not an instruction to inherit every native generator return annotation. State that difference rather than saying TypeScript rejects those two types.

    Publish002, AppendixB and a dated VIP-21 clarification. Cases/fuzz cover omitted annotations, Stream aliases, normalized and genuine unions, `any`/`unknown`/`never`, channel unions and nested callable ownership. Keep known compiler gaps keyed; this decision is not a passing compiler case.

    Decided by the agent from VIP-21's Stream result, the already stated `EK2102` contract, principle1 (an exposed Effect/Stream contract), principle4 (one container-contract rule) and principle8 (do not add untyped producer-return permission), 2026-11-01, under Will's 2026-10-29 delegation. Class A.

### Detail 301

**Keep `EK2104` for accepted yield placement; if the old layer-order checker must remain temporarily, inventory its unchanged error as interim `EK9209`.** (impl-hunt-run core request2026-11-02T09:11Z; accepted VIP-21 and AppendixB; details60/189/212; Will15:57: code numbering is the agent's job; principle4.) This settles a diagnostic-identity collision, not a new language/API design or approval of the old layer-declaration grammar.

At immutable main `41e2c4db4e29`, `diagnostics.go` and `layers_check.go` still use `EK2104` for "This statement follows the layer's members, but a layer's setup statements come first." The accepted release table and public VIP-21 already assign `EK2104` to yield placement. One compiler must not use that code for both rules. Recover the source-rule-owned yield check with its existing `EK2104` trigger, including the source context/formal-initialization boundaries of212; native generators/native diagnostics remain distinct.

If coordinated removal of the legacy layer-declaration checker is already authorized and lands first, remove the obsolete diagnostic with that work and no interim emission is needed. Otherwise preserve the actual legacy check's current severity, trigger, source range, message and repair note, changing only its identity to interim `EK9209` in the same recovery. Do not remove a still-reachable compatibility check merely to clear the collision. `EK9209` is a labelled transitional implementation inventory entry under189, not an accepted layer construct, a permanent VIP-92 rule, a new warning or a configurable error. Its retirement ownership stays with the legacy layer removal owners `del-2`/`del-rest`; `impl-hunt-run` owns recovery of the yield check. This decision does not authorize either owner to skip the other's semantic/preservation gates or infer a new layer-language retirement approval.

Version both directions: older artifacts print layer-order `EK2104`; the coordinated transitional artifact may print layer-order `EK9209` and yield-placement `EK2104`; a final artifact with no legacy checker prints no layer-order code. Update the actual registry and AppendixB transitional inventory together, with a release note and exact source/artifact receipts. Retire the interim row only with evidence that its declaration/emission is gone. Do not reuse `EK9209` for another meaning. Do not call a queued renumber current main, alias both meanings in severity settings, add a blanket registry exemption, weaken the protected registry oracle, or put an already-catalogued code into an unassigned-`legacyDeclared` allowance. Normal row-based checking must account for it; protected-test ownership still applies.

The current language uses ordinary native Layer construction, for example:

```vibe
service Counter { n: number }
const CounterLive = Layer.effect(Counter, effect {
  const n = try Effect.succeed(7)
  return { n }
})
effect function badYield() { yield 1 } // EK2104: no source producer owns yield
```

Effect TypeScript counterpart for the admitted layer:

```ts
import { Context, Effect, Layer } from "effect"
class Counter extends Context.Service<Counter, { n: number }>()("Counter") {}
const CounterLive = Layer.effect(Counter, Effect.gen(function* () {
  const n = yield* Effect.succeed(7)
  return { n }
}))
```

An `Effect.gen` implementation generator is not a source producer and grants no source `yield` permission to `badYield`. Keep valid native generator controls, positive/negative producer/formal-context cases, the historical legacy-order witness on a compatibility artifact, and exact code/message/severity inventory checks. Include the defect-neighborhood regression and spec-quoted keyed fuzz coverage with the owner's recovery; a numeric-registry pass alone does not prove trigger identity. The chapter/spec owners apply this inventory and the compiler owner supplies executable before/after evidence.

Allocation evidence: the immutable main41e2 source scan of all `typescript/tsc/internal/vibelang`, `vibelangfuzz`, `docs/design/src` and `docs/design/vips` contains no `9209` occurrence; exact8,926,165-byte snapshot/hash is in `decide-live-scratch/ek9209-allocation-audit.json`. Supplemental immutable parser and compiler-options sources also contain no `9209` occurrence; `ek9209-parser-options-audit.json` records that separate1,373,085-byte scan/hash. Neither scan is a compiler/registry test run. The shared detail log had no competing allocation; the historical fix35 proposal is explicitly preserved as a proposal, not prior acceptance. Only these selected immutable sources, the actual checker, accepted catalog/publicVIP21/34 and details60/189/212 were inspected; this lane has not run the compiler, registry tests, Go/fuzz or a merge gate, and has changed no repository code or protected oracle.

Decided by the agent from Will's code-numbering ruling recorded in60, accepted VIP-21/VIP-34, existing189/212 and principle4 (separate versioned compatibility identity; no extra language rule), 2026-11-02 under the 2026-10-29 delegation. Class A; no new Will question. This is policy/allocation only, not a current-main emission or completed implementation receipt.
