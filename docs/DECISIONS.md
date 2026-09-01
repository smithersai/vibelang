# Smithers decision ledger

This ledger records accepted design decisions. Together with the published
specification pages and linked design drafts, it forms the Smithers product
specification.

Status:

- **Locked** — explicitly accepted by the language designer.
- **Direction** — accepted principle whose detailed spelling or mechanics remain open.
- **Open** — discussed but not decided.

Last reconciled with the published specification pages: 2026-08-27.
Latest ledger decisions: 2026-08-28.

This ledger is the tie-breaker over the published specification pages
(`specification/index.mdx` §Source of Truth), so it must never be staler than
they are. The 2026-08-23 revision reduced the language substantially: grammar
cut to one form (`if (const x = f(); cond)`), postfix `!` replacing `.unwrap()`
with the TypeScript non-null assertion removed, `Optional<T>` withdrawn in
favour of `T | undefined`, and TypeScript established as the only compilation
target with the near-native/LLVM and Wasm targets, the `TypeScript` requirement,
feature classification, and the portability pin all withdrawn.

The 2026-08-27 revision made **one-shot delimited continuations** the runtime
primitive. Typed failures, dependency injection, and durable execution are now
handlers over that one mechanism rather than three separate lowerings. Nothing an
author writes changed: `Result<A, E>`, postfix `!`, `Capability.context()`,
`Layer.provide`, and `durable(...)` keep their spelling and their observable
behavior. What changed is what the compiler emits underneath them, what the
durable runtime does at run time, and — recorded plainly in
[Durable Execution](/specification/durable-execution) §What Replay Trades Away —
two capabilities that are given up to get there.

## Pending ratification — one-shot delimited continuations, 2026-08-27

**Three decisions below were adopted on a recommendation and are awaiting the
owner's sign-off.** They are written into the ledger and the specification pages
as though accepted, because leaving them unstated would have left the pivot
undocumented. Each is a self-contained block with an explicit reversal
instruction. Until the owner strikes the pending marker, a reader MUST treat
these three as provisional and everything downstream of them as resting on a
provisional foundation.

### PR-1 — Build the Effect Manifest **(pending ratification)**

**Adopted:** the compiler derives and publishes a static **Effect Manifest** per
Flow — reachable Action identities, capability requirement row, external-input
contracts, failure row, and site table. Sets and tables only: no control-flow
edges, no branch structure, no execution counts. It exists for versioning and
signing, not for scheduling; nothing at run time reads it to decide what to do
next.

**Reasoning.** The alternative on the table was to delete the execution-plan
template and replace it with nothing but a serialized effect row. Four
capabilities read the plan today and have no replay equivalent: deployment
closure checking, ahead-of-time external-signal addressability, non-executing
inspection, and meaningful signing. Ahead-of-time addressability is not a
convenience — without it, the requirement that a delivery client can
schema-validate, authorize, and idempotently commit a delivery to a wait the Flow
has not yet reached becomes unsatisfiable, and it is a locked MUST. The Manifest
is roughly 680 net-new lines against a subsystem of about 30,000; not building it
saves about 1% of that subsystem and costs four capabilities. It also buys back
the signable pre-execution artifact outright and about half of static
version-divergence detection — the two things the pivot otherwise trades away.

**The discipline that keeps it honest:** the Manifest MUST be sound with respect
to reachability and imprecise about everything else. The moment it acquires an
edge, a branch, or a count, it has started growing back into a plan and the pivot
has been undone by accretion.

**What the Manifest inherited on 2026-08-31, and what it still owes.** The six
`SMITHERS41xx` walls in the Plan lowerer are withdrawn — a runtime branch, a
runtime loop, an optional projection, a non-boolean conditional, an expression
the Plan could not name, and a call the Plan could not name. A body holding any
of them is no longer refused: the Plan lowerer declines it without a diagnostic
and the Flow publishes this Manifest instead. Thirteen `17-durable` conformance
cases moved with them, on both backends, in one commit.

That transfers a guarantee. `SMITHERS4112` used to refuse every call the Plan
could not name *before* the Manifest was consulted, so the Manifest's soundness
obligation was never load-bearing. It is now, and it was **measured failing**:
a Flow body calling a same-file helper that performs an Action published
`actions: []`, which is exactly the silent narrowing the locked sentence above
forbids. Both backends now fail the Manifest closed on any call they cannot
account for, presuming only a callee declared entirely in the default library.

Two exemptions, named rather than silent, and both are debts this decision owes:

1. **`Capability.context()` is exempted by name.** The capability requirement
   row is Manifest content this decision locks and neither backend derives yet,
   so a capability read is neither accounted for nor refused. Refusing it would
   break the vertical slice, whose first line is one; accounting for it means
   minting a capability identity and deciding whether a read takes a site row.
2. **The compiler-owned combinators are exempted**, correctly: `fanOut`,
   `sequential` and `loopWhile` carry their effects in the callbacks they are
   handed, and the descent visits those as children.

Neither exemption may be widened, and the first must close when the Manifest's
exact content is defined.

**To reverse:** strike this block, delete §Effect Manifest from
[Durable Execution](/specification/durable-execution), and remove the Manifest
from the Flow descriptor and from the signed artifact in that page's
§Compiler-Recognized API and §Distributed Deployment. Inspection (phase 3) then
has no artifact to read and the phase disappears with it; the locked
external-signal addressability sentence must then be withdrawn as unsatisfiable
in the same edit.

### PR-2 — Journal key is `(siteId, occurrence)` **(pending ratification)**

**Adopted:** a journal entry's key is the pair of a content-addressed site
identity and an occurrence index minted at **submission**, in the scheduler's
deterministic order. It is not an execution ordinal, and the occurrence index is
never assigned at completion.

**Reasoning.** Site identity preserves order-independence, so two requests at
different sites may complete in either order and still converge. That is what
lets the existing journal schema and the existing crash-matrix test survive
untouched — and a required edit to that test is a stop signal, because it would
mean journal semantics changed. Site identity also gives a divergence report a
**named source location**, which an ordinal cannot: an ordinal off-by-one names
nothing. The only thing an execution ordinal buys is ordering two suspensions at
the same site in the same iteration, and the occurrence counter already handles
that.

**To reverse:** strike this block and rewrite §Journal Identity in
[Durable Execution](/specification/durable-execution). Divergence reporting loses
its source location, and the store schema and crash-matrix test require a rekey.

### PR-3 — Fail closed on version divergence **(pending ratification)**

**Adopted:** an execution is pinned to the Flow source identity it started under.
A coordinator whose Flow source identity differs MUST abandon that execution
rather than replay it or terminalize it. No versioning API ships in v1; the
question is recorded as Open.

**Reasoning.** A facility for changing a Flow body while executions of it are
live would be the single largest addition to the normative surface in this
revision — larger than the continuation model itself. The pinning substrate
already exists and survives, so failing closed costs no new machinery. Failing
closed also lets the divergence diagnostic accumulate evidence about which edits
people actually attempt, which is the input a versioning API needs and which
nobody has today.

**Say plainly what this costs**, because it is the one place where the pivot is
strictly worse than what exists: today the version answer is *total and static*.
Under replay it becomes a partial static answer plus a named dynamic one. See
[Durable Execution](/specification/durable-execution) §What Replay Trades Away.

**To reverse:** strike this block and design a versioning API. §Versioning in
[Durable Execution](/specification/durable-execution) becomes its home, and the
"treat a body edit with live executions as an operational migration" instruction
is withdrawn.

### Not decided here — six open questions

These are **not** adopted, not recommended-and-adopted, and MUST NOT be read as
settled by anything above. Each is recorded in full below with its evidence:

1. Whether losing implicit fan-out parallelism is acceptable — §Durable execution. A **product** call, not an engineering one.
2. R1 subclass substitution — §Requirements and dependency injection.
3. Dynamic import: ledger, corpus, and product disagree three ways — §TypeScript target.
4. `@module @throws {never}` is doing two jobs — §Compiler and delivery.
5. `compatibility.mdx` §Dynamic Features versus the shipped `eval` refusal — §TypeScript target. **The most urgent**, because shipped behavior already diverges from a locked sentence.
6. Postfix `!` placement: `failures.mdx` §Refusal Conditions versus the shipped `SMITHERS1204` — §Typed failures. Added 2026-08-27 by measurement.

Questions 5 and 6 are the same *kind* of conflict pointing in **opposite
directions**, and that is the thing a reader must be able to see. In 5 the
implementation is ahead of a locked permission; in 6 the specification is ahead
of the implementation. The specification pages carry a direction marker at each
site — `(IA-n)` and `(SA-n)` — defined in
[Specification Status](/specification/index) §Specification–Implementation Gaps.
A marker records a gap and resolves nothing.

Two further gaps were found while applying this revision, in places where the
proposal was simply silent. They are recorded as questions in §Durable execution
rather than filled with an invented rule: how an order-independent concurrency
combinator reaches the deterministic scheduler, and what the Effect Manifest's
site-table diff normatively obliges an implementation to do.

## Identity and compatibility

- **Locked:** The language is named **Smithers**.
- **Locked:** Smithers source uses `.sm`.
- **Open:** The JSX-capable extension has not been confirmed; `.smx` must not
  imply a stricter or sounder language mode.
- **Locked:** Smithers is not a syntactic superset of TypeScript. `.sm` has an
  intentionally TypeScript-derived grammar with a small set of deliberate,
  documented differences such as Result propagation and declarations in
  conditionals.
- **Locked:** Smithers can directly import TypeScript and JavaScript modules.
  `.ts`, `.tsx`, and JavaScript sources retain their own syntax and semantics;
  they are interoperability inputs, not source that must parse as `.sm`.
- **Locked:** Syntax shared by Smithers and TypeScript keeps TypeScript behavior
  unless a divergence is explicitly accepted and documented. Smithers does not
  make gratuitous syntax changes.
- **Locked:** Smithers adds precision incrementally rather than imposing a
  globally sound type system. TypeScript escape hatches remain available and
  can be discouraged by lint rules.

## Function model

- **Locked:** **Authored** functions remain ordinary, eager functions. `.sm` has
  no `Effect<A, E, R>` value, no `Result.gen` do-notation, and no `.run()` step:
  a program is entered by calling a function. The compiler may emit a function
  whose inferred effect row is non-empty in a **resumable calling convention**,
  and a compiler-owned handler loop may drive it. That convention is a lowering
  detail, not a language surface: it is unspellable in `.sm`, never appears in an
  authored type or public declaration's value syntax, is never named in a
  diagnostic, and no source construct can obtain, name, store, or resume a
  continuation. See [Effects](/specification/effects).
- **Locked:** A function that can complete with an `Error` returns
  `Result<A, E>`. A fallible async function returns
  `Promise<Result<A, E>>`. Failure is represented by the ordinary return value,
  not an erased side channel.
- **Locked:** Plain `return value` inside a Result-returning function produces
  the success variant. `throw error` produces the error variant and exits the
  function. Authors do not write `Result.ok(...)` or `Result.err(...)`.
- **Locked:** Fallibility and requirements are inferred transitively whenever
  possible. `Result<A, E>` makes the public failure contract explicit;
  compiler-aware context types preserve `R` in editor and declaration
  signatures.
- **Locked:** Smithers does not introduce an Effect-style fiber runtime, or any
  user-visible fiber type. The durable runtime drives emitted bodies with a
  deterministic scheduler; that scheduler has no source-language surface and is
  not obtainable from non-durable code.
- **Locked:** A function's effect row is the pair `(E, R)`. It is part of the
  function's static type, is preserved in exported declarations, and is carried
  by a function **value**, not only by a function declaration. Assigning a
  function with a non-empty row where a function with a smaller row is expected
  is a type error. An unannotated function type carries the empty row. A function
  whose row is empty is never emitted in the resumable calling convention.
- **Open, and scoped to a flag:** the migration's `effectLowering: "yield"`
  option (`CompileOptions`, default `"return"`) emits **one** function whose row
  is empty in the resumable convention: the callback of a `Layer.provide`, which
  becomes the delimited computation the installed handler runs. Every other
  function the option lowers has a non-empty requirement row, so the obligation
  above holds for all of them. The exception is accepted temporarily and only
  under the flag, and it is recorded here rather than left in a commit message
  because it is a knowing contradiction of
  [Compatibility](/specification/compatibility) §TypeScript Target's "infallible
  functions MUST NOT be wrapped".

  It is narrower than the migration plan budgeted for. That plan expected the
  option to need a *uniform* convention — every `.sm` function emitted as a
  generator — because `collectFacts` records no call edge for a call through a
  value and the emitter would then have no way to choose `yield* f()` over `f()`
  (gap G2). Measured, the uniform convention was not needed: the checker's
  resolved signature decides the call site wherever an edge is absent, and a
  function declaration mentioned anywhere except in callee position is kept in
  the ordinary convention, which together leave nothing undecided in 515 corpus
  programs. What remains undecidable — a call through a function-typed
  **parameter**, where only a requirement row on the callee's TYPE could settle
  it — is refused outright as `SMITHERS1807` rather than guessed. The refusal
  retires when that row exists (`requirements` on `TypeShape`), and the flag and
  this exception retire with it.

## Typed failures

- **Locked:** Any ordinary class extending `Error` is a nominal recoverable
  error. Smithers does not require a `TaggedError("Name")` factory or separate
  error-declaration syntax. The compiler supplies stable identity and transport
  metadata without changing normal `Error` behavior.
- **Locked:** The `Result` type is built in. Its quality-of-life API is modelled
  on Dillon Mulroy's `better-result`: matching, transformation, sequencing,
  recovery, observation (including the `tap*` family and async variants),
  collection (`all`, `allAsync`, `partition`, `partitionAsync`), foreign
  adaptation (`try`, `tryPromise`), and codecs. Smithers omits `Result.ok`,
  `Result.err`, and `TaggedError` because ordinary `return`, `throw`, and
  `class ... extends Error` construct those, and omits `Result.gen`/`yield*`
  do-notation because postfix `!` already propagates. That omission is a
  constraint on the authoring surface. The compiler may emit `yield*` in the
  lowered form of a function with a non-empty effect row; that form has no `.sm`
  spelling.
- **Locked:** Postfix `!` is the spelling for propagating an error from a
  Result-returning function. `findUser(id)!` yields the success value or returns
  the enclosing function's error variant. The compiler tracks the error type and
  lowers the error path; it never throws a recoverable JavaScript exception.
  This is Zig's `try foo()` with an operator TypeScript already has.
- **Locked:** The TypeScript non-null assertion is removed from `.sm`. `x!` no
  longer asserts non-nullness, and the definite-assignment form `x!: T` is gone
  with it. Removing the old meaning entirely is what makes the slot safe to
  reuse: there is no ambiguity, and the assertion was an unsound escape hatch
  that most codebases already lint against.
- **Locked:** `??` and `?.` keep their ordinary nullish meaning and are never
  reinterpreted for failures. Absence and failure are separate axes: `!` is the
  error axis, `??`/`?.` are the absence axis, and both may appear in one
  expression.
- **Locked:** Reinterpreting existing TypeScript syntax is permitted only when
  three conditions hold together: the old meaning is removed entirely so nothing
  is ambiguous, the syntax is a type error or a no-op in the target position so
  no valid program changes behavior, and the form is already widely lint-banned
  so the removal costs real code nothing. `!` is the only form that has met all
  three so far.
- **Direction:** Each reinterpretation is a per-file dialect divergence that no
  editor, linter, or formatter will flag. The cost scales badly, so the budget
  is small and each use must earn its place.
- **Locked:** `smthrs/result` and the Smithers runtime are compiler-owned and are
  not required to be authored in Smithers. This is structural, not a
  convenience: `result` is the lowering target, so emitted code imports it and
  authoring it in the language whose lowering depends on it is circular. The
  compiler links it, `!`/`expect` are rejected inside it, and its public API is
  instance methods, which `.sm` cannot author because `this` is never a Result
  operand. A standard library written in Smithers may exclude these modules
  without being incomplete.
- **Open:** Whether Smithers gains an **error-extraction form**. The language
  currently has no way to get the error value out of a Result — `!` propagates
  it and `match` is callable but not authorable — so `tryRecover`, `tapError`,
  `mapError`, `partition`'s error half, and `flatten` cannot be written in
  Smithers. This is a real language feature with a spelling to choose, and it is
  the root of most of the unauthorable API surface.
- **Locked:** `!` is accepted in any expression position. Three conditions refuse
  it: no enclosing Result channel, non-Result operand provenance, and an
  enclosing `catch`. See [Failure Semantics](/specification/failures) §Refusal
  Conditions. The placement and repeated-loop-header conditions are
  **withdrawn**; the 115-case placement measurement that supported them is
  withdrawn with them and must not be cited.
- **Locked, and this is the irreversible one — `(SA-1)` is narrowed to three
  positions, 2026-08-30.** The gap recorded here between 2026-08-27 and
  2026-08-30 was that this ledger said "`!` is accepted in any expression
  position" while the shipped frontend still enforced the withdrawn
  statement-walk and refused four of the six accepted forms with
  `SMITHERS1204`. The implementation has moved to the ledger. What that cost,
  stated once and measured rather than estimated:

  - **The placement walk is deleted.** `isSafePropagationPlacement` and
    `isInRepeatedLoopHeader` are gone from the reference frontend, and with them
    the rule that a `!` must reach the enclosing statement through an allow-list
    of seven node kinds. `r!.trim()`, `r![0]`, `f(r!)`, `a! + b!`, and a
    propagation in a `for…of`/`for…in` iterable now compile and run.
  - **`SMITHERS1204` and `SMITHERS1703` are kept and narrowed**, and this is the
    one place the migration plan's instruction was not followed to the letter.
    The plan said to retire both. Measured, that is not safe while the shipped
    lowering spells the failure exit as an early `return`: that exit is a
    statement, so its guard is hoisted to the front of the enclosing statement,
    and hoisting is order-preserving only where the operand is evaluated
    unconditionally, exactly once, and with nothing effectful to its left.
    Hoisting `while (next()!) {}` produces a program that **never terminates**;
    hoisting `maybe ?? r!` evaluates an operand the authored program would have
    skipped; hoisting `g() + r!` jumps the guard in front of `g()`. Three
    positions therefore remain refused, by the three predicates
    `repeatedlyEvaluatedPosition`, `conditionallyEvaluatedPosition` and
    `precededByUnhoistedEffect`. Everything else the old rule refused is
    accepted.
  - **The refusals are conditions on the lowering, not on the language, and they
    are uniform across both `effectLowering` modes.** Both modes spell a
    propagation the same way today, so no per-file dialect is created — which is
    the property the plan's "relax unconditionally" instruction existed to
    protect. They retire when the `"return"` lowering does, not before.
  - **`SMITHERS1507` is narrowed** to the two conditions that are still about
    provenance: a foreign callee that is not a stable reference, and an already
    unchecked foreign Result. The "this checked foreign result is used as a
    value" arm was a placement constraint of the hoisted `Result.try(...)`
    wrapper wearing a provenance rule's name; it and its helper are deleted.
  - **`SMITHERS1506` did not narrow. Measured: zero.** The migration plan
    predicted twelve narrowings as a consequence of `SMITHERS1507` marking fewer
    calls unlowerable. Re-run over the 515-case corpus and the 1268-test
    language suite, no `SMITHERS1506` moved. The prediction was wrong, and it is
    recorded as wrong rather than quietly dropped.
  - **`SMITHERS1205` is kept** — `!` inside a `try` that has a `catch` — with a
    rewritten message, and the rewrite found a second defect. Its old message
    named an early `return` that the specification no longer describes. Its
    reason survives intact for `!` and `Result.expect()`: the failure exit
    unwinds the computation, so `finally` blocks and `using` disposals run and
    `catch` clauses do not. It does **not** survive for `panic(...)`, which the
    same check also refuses: a panic lowers to a completion value where the
    enclosing contract names `Panic` and to an unwinding `throw` where it does
    not, and a `catch` really does observe the second. The panic arm therefore
    now carries its own message, true of both lowerings.

  **Three things this cannot be reverted through, and they are why this is the
  point of no return.**

  1. **Programs that were illegal are now legal, permanently.** Four conformance
     cases that certified refusals now certify execution, with re-derived
     stdout; two more lose a code they used to report. Re-refusing them would
     break source that compiled.
  2. **`.d.ts` carries the emitted calling convention**, which
     [Compatibility](/specification/compatibility) §Library Publishing requires.
     That is a published ABI: a consumer reads a declaration to decide how to
     call, so the declaration's shape is part of the package contract rather
     than an internal detail. **Measured on the emitted bytes 2026-08-30, and
     the honest reading is narrower than the plan assumed.** For an exported
     function whose requirement row is non-empty, the default lowering emits

     ```ts
     export declare function needs(key: string): string;
     ```

     and `effectLowering: "yield"` emits

     ```ts
     import { …, type Resumable as __vsResumable } from "smthrs/runtime";
     export declare function needs(key: string): __vsResumable<string>;
     ```

     — the convention, in the declaration, as a type a consumer can read. That
     step was taken by the migration's step 6, not by this one. **This change
     moved no function's convention**, so the shipped `.d.ts` is byte-identical
     before and after it: a function whose row is failures-only, including one
     containing the newly legal placements, still declares `Result<A, E>` with
     `@smithersEffects {"failures":[…],"requirements":[]}` and no convention
     marker. The ABI consequence is real and is already published; what is not
     yet true is that it applies to fallible functions, and it becomes true only
     when the failure exit becomes a delegated suspension.
  3. **Transform-only mode detonates.** The sentence at
     [Compatibility](/specification/compatibility) §Build Integration survives
     verbatim and its blast radius goes from a corner case to the default,
     because whether a callee is a generator is cross-module information. It has
     now been measured rather than asserted; see §Build integration below, where
     the measurement corrects the size of the claim without changing the
     decision.

  **What the Go fork does, said plainly rather than left to a marker.** The
  fork held its own copy of the withdrawn walk in `safeUnwrapPlacement` for a
  few hours on 2026-08-30 and refused six programs the reference accepts — a
  **fail-closed** divergence recorded as six `xfail(go)` markers. **All six were
  retired the same day.** `safeUnwrapPlacement`, `isInRepeatedLoopHeader` and
  `foreignResultIsUsedAsValue` are deleted from
  `compiler/forkbridge/lowering.go.txt` and replaced by the same three
  predicates, so the two backends now refuse the same three positions for the
  same stated reason, and the fork applies them to `Result.expect()` as well as
  to postfix `!`. The port was verified by running both backends over the same
  programs rather than by transcribing the reference's source, which is what
  caught two things a transcription would have missed: deleting
  `foreignResultIsUsedAsValue` alone left `makeCallable()("x")` unreported on the
  fork, because a same-position suppression it had needed outlived it; and the
  fork had never implemented the PANIC arm of `SMITHERS1205` at all, so
  `panic(...)` inside a catch-guarded `try` compiled there and the `catch`
  swallowed the abort. Both are closed. `Markers holding a fail-open` stays at 0.
  The reference is the normative backend; a fork that refuses more is a lag, not
  a second dialect, and the markers are what stop it becoming one silently.

- **Locked:** Calling `panic(...)` does not widen a return type into
  `Result<A, Panic>`. This follows from the existing rules rather than being a
  new decision: panic is tracked separately from ordinary recoverable Error
  variants, and ordinary Result recovery must not swallow it. `E` is the
  expected-error channel and a panic is not an expected error, so forcing the
  widening puts the panic where `unwrapOr`/`recover`/`match` consume it. A
  function that validates an argument or refuses a forgery must be able to abort
  with a plain return type. An author may still annotate `Result<A, Panic>`
  explicitly; the prohibition is on the compiler forcing it.
- **Locked:** Result values are must-use: a Result must be returned, awaited when
  wrapped in a Promise, matched, transformed, explicitly inspected, or
  propagated with `!`. Silently discarding one is a compile error.
- **Locked:** `Error.prototype` has compiler-aware quality-of-life methods,
  initially `is`, `matches`, `match`, `matchPartial`, and `rootCause`.
  `error.match({...})` is exhaustive for a statically known error union and keys
  cases by compiler-stable nominal Error identity.
- **Locked:** There is no general `throws` clause, prefix `try` expression,
  postfix recovery expression, or `!T` marker. Smithers does have an explicit
  way to catch the distinguished `panic` channel; ordinary JavaScript
  `try/catch` remains available inside imported JavaScript and TypeScript.
- **Locked:** An unannotated function that reaches `throw error`, propagates an
  error Result with `!`, or returns a Result is inferred as `Result<A, E>`. Public,
  abstract, and declaration-only contracts spell fallibility directly as
  `Result<A, E>`.
- **Locked:** Every imported JavaScript or TypeScript runtime value is assumed
  capable of throwing unexpectedly or rejecting, even when its declared return
  type does not say so. Calling it therefore adds the distinguished, checked
  `panic` case to the Smithers failure channel by default. This also covers a
  foreign implementation violating its declared signature.
- **Locked:** A caller must propagate that `panic`, explicitly catch it, or call
  through a trusted adapter that catches and translates it. There is no
  unchecked direct use of an unannotated JavaScript or TypeScript function.
- **Locked:** `panic` is available from `smithers:exceptions` and accepts an
  optional message or underlying error. `Reflect.panic` and compiler/runtime
  invariant failures enter the same distinguished channel.
- **Locked:** The compiler recognizes JSDoc on JavaScript and TypeScript
  boundaries. `@throws {never}` is a trusted opt-out from the default `panic`
  case, while `@throws {T}` declares the stated foreign failure channel.
- **Direction:** Foreign `@throws` annotations are trust claims surfaced in
  declarations and tooling. Exact rules for overloads, multiple annotations,
  declaration merging, validation, and generic error types remain to be
  specified.
- **Locked:** Smithers does not add `defer` or `errdefer`. Cleanup uses TC39
  explicit resource management (`using`), which is already standard and already
  in TypeScript. Deferred cleanup was convenient but not a TypeScript pain point
  worth new grammar. Rollback on a Result error exit is written as ordinary code
  in the failure path. The unrelated TC39 `import defer` proposal is untouched by
  this decision.

## Absence and nullability

- **Locked:** Smithers has no built-in `Optional<T>`. Absence uses TypeScript's
  existing `T | undefined` unions with ordinary narrowing, optional chaining,
  and nullish coalescing. TypeScript already expresses this precisely, and every
  JavaScript consumer already understands it.
- **Locked:** Absence and typed failure remain separate concepts. A fallible
  function returns `Result<A, E>`; a lookup that can find nothing returns
  `T | undefined`; one that does both returns `Result<A | undefined, E>`.
- **Locked:** Existing TypeScript `undefined`, optional parameters, and optional
  properties keep their ordinary meaning. Nothing is reinterpreted.
- **Locked:** The `?T`, payload-capture, `orelse`, and `.?` grammar is removed
  and does not return.
- **Direction:** An `Optional<T>` container may be reconsidered later as an
  ordinary standard-library type. It does not get compiler lifting, `!`
  propagation, or outside-in nesting rules if it does.
## Requirements and dependency injection

- **Locked:** A capability is an abstract class extending `Context` from
  `smthrs/context`. The class is both its service contract and nominal key,
  providing an Effect-inspired model with less generic ceremony.
- **Locked:** `Capability.context()` is a compiler-recognized library call. It
  returns the capability instance and adds its class to the enclosing function's
  inferred requirement row; no `uses` source-language grammar is needed.
- **Locked:** The inferred context is part of the function's static type. It is
  not an explicit argument that callers pass by hand.
- **Locked:** Requirements propagate through callers by inference.
- **Locked:** Provider composition is imported from `smthrs/provider`, not
  expressed as a special `provide { ... }` block.
- **Locked:** Layers package and provide implementations to ordinary functions;
  they are dependency environments, not task supervisors or implicit resource
  managers.
- **Locked:** The base public type is exactly `Layer<Provides>`. It receives
  already-acquired implementations, so initialization failures and construction
  requirements are not phantom Layer parameters; higher-level provider policy
  may model those concerns separately.
- **Locked:** `Layer.provide(layer, body)` keeps the layer environment active
  until `body` and the Promise it returns settle. It does not discover, register,
  cancel, or join other Promise work implicitly.
- **Locked:** A provided environment is reachable only through requests delegated
  to its handler, so it becomes unreachable exactly when the handler observes the
  computation's completion or abandons it. No promise-settlement hook,
  Promise-provenance rule, or author-written adapter is required, and a host
  lacking such a hook is fully supported.
- **Locked:** A reference to a capability's `context` member that is not an
  immediate call on a statically determined `Context` subclass is rejected. The
  compiler must be able to identify, at every access site, exactly one nominal
  capability key and one runtime constructor value. This was previously described
  as row hygiene; it is now the precondition that makes rewriting
  `Capability.context()` into a handler-answered effect request sound.
- **Locked:** Resource acquisition and finalization are explicit ordinary code,
  initially using `using`. A Layer receives an already acquired service;
  it does not own that service's lifetime. Resource-owning Layer conveniences
  may be added later without changing this base rule.
- **Locked:** Fire-and-forget and detached work are initially unavailable in
  authored `.sm`. Every started Promise must be consumed by `await` or by a
  recognized combinator whose resulting Promise is itself consumed before the
  enclosing scope exits.
- **Locked:** Imported JavaScript or TypeScript that starts hidden background
  work owns that work. APIs needing caller-controlled lifetime must be adapted
  to expose an explicit completion and/or disposal handle.
- **Locked:** Every started Promise must be consumed. Under replay this promotes
  from lifetime hygiene to replay correctness: an unconsumed Promise is an
  unjournaled, unreproducible interleaving.
- **Open:** Layer merging and nested override precedence still need exact APIs
  and semantics, and still fail closed. Requirement-environment lowering closes
  in principle: `Layer.provide` installs a handler and `Capability.context()`
  issues a request that handler answers. See
  [Effects](/specification/effects).
- **Open:** The public declaration encoding of the context row and the JS
  lowering may use phantom function metadata, compiler-threaded hidden
  parameters, ambient context, or handler-answered effect requests. These choices
  must not change source calls. Whatever encoding is chosen must additionally
  carry whether a function is **effectful**, because a cross-module caller cannot
  lower its call site without that fact.
- **Open — R1, subclass substitution at a capability receiver.** A concrete
  `typeof Db` annotation is accepted as a capability receiver and records the
  nominal key `Db`. But a subclass of `Db` is assignable to `typeof Db` and its
  nominal key is a *different* one, so a program can check clean against a
  satisfied layer and panic at run time with a capability that was never
  provided. This is not a fork-versus-reference disagreement: **both backends
  behave identically**, and the hole is deliberately pinned as a KNOWN RESIDUAL
  test at **both** sites that read a capability receiver — the `.context()`
  receiver and the `Layer.succeed` capability argument. Those two sites are one
  function on purpose: a layer's provided set and a body's required set are one
  fact about one program and have to be computed once.

  Three fixes are on the table and **two of them contradict forms the language
  currently accepts.** (1) Require the binding to be `const`: this refuses
  `let C = Db` that is never reassigned, which is a correct program that compiles
  and runs today, and the corpus pins several mutable-alias spellings that
  resolve correctly. (2) Refuse any receiver whose only evidence is the checker
  type: this takes out `(x as typeof Db).context()`, which is deliberately
  preserved and separately pinned. (3) Leave the hole and pin it — which is the
  status quo, and is why the residual exists as a test rather than as a bug.

  It is also a *bounded* residual, not an open-ended one: the two most obvious
  unsound shapes are already refused. A type parameter merely *bounded* by
  `typeof Db` is refused at both sites, precisely because a bound never pins a
  key; and a subclass used directly as a receiver correctly records the
  **subclass** as the key rather than its base. What is unpinned is the middle
  case: passing a subclass where a concrete `typeof Db` parameter is declared. No
  test pins that shape in either direction.

  **Not resolved here.** Any fix must move all three receiver walks together —
  the two capability sites and the `panic` template-tag alias walk share the same
  binding step and would otherwise read `let` differently from each other.

## Imports and platform dependencies

- **Locked:** JSON `with { type: "json", mode: "const" }` needs no handwritten
  declaration or schema and produces a deeply readonly literal type. Existing
  TypeScript JSON imports retain their existing types and runtime behavior.
- **Locked:** Every non-code or foreign-source import uses standard import
  attributes to select its loader and mode. Examples include
  `with { type: "json", mode: "const" }`, `with { type: "text" }`,
  `with { type: "mdx" }`, and `with { type: "zig" }`. File extensions do not
  create a second implicit loader-selection grammar.
- **Locked:** Markdown and MDX are supported by built-in loaders. MDX is a
  general module format; libraries may supply component vocabularies and
  runtimes for domains such as agent prompts.
- **Locked:** Arbitrary file formats can be integrated through user-defined
  comptime loaders. A loader turns compiler-known input into a typed module;
  users do not duplicate its result type in a declaration file.
- **Direction:** File imports are first-class incremental build nodes. Their
  keys include the input content, loader implementation and options, target,
  and declared transitive dependencies.
- **Open:** The exact loader registration API and the default module shapes for
  Markdown and MDX remain to be specified; see `docs/ASSET_LOADERS.md`.
- **Locked:** Platform-specific functionality is always represented by strongly
  typed requirements.
- **Locked:** `process`, `window`, `document`, filesystem, network, and similar
  host facilities are unavailable as ambient globals. They must be supplied as
  dependencies.
- **Locked:** Only facilities present in every JavaScript environment may be
  unconditional globals. Host-sensitive operations on otherwise universal
  objects still need capabilities where applicable, such as clock or random.
  The rationale is upgraded from capability hygiene to **replay correctness**:
  because a Flow body re-executes on every resumption, an operation whose result
  can differ between two executions of the same code on the same inputs must be
  reachable only through a capability whose answer the runtime journals.
- **Locked:** Five further per-member obligations follow from that, listed in
  [Compatibility](/specification/compatibility) §Determinism-Sensitive Members.
  `WeakRef` and `FinalizationRegistry` leave the universal set, because GC timing
  is something no capability can mediate and no journal entry can describe.
  `SharedArrayBuffer` and `Atomics` leave it, because they observe another
  agent's schedule. `Promise.race` and `Promise.any` charge a `Scheduler`
  requirement, because their value *is* arrival order; every other `Promise`
  member stays free. The `Date` members that read the host time zone charge
  `Clock` even when an explicit instant is supplied; `getTime()` stays free. The
  `Intl` and locale-comparison members charge a `Locale` requirement, because
  they are functions of the host ICU version and locale data — and a collator
  used as a sort comparator makes the resulting *ordering* host-dependent.
- **Locked:** Those walls are **uniform**, not scoped to Flow bodies. A rule that
  fires in one file and not another is a per-file dialect, which this ledger
  already warns against by name, and it does not work mechanically either:
  requirement inference is whole-program, so a Flow's helper lives in another
  file. The cost is explicit and accepted — a collator in an ordinary CLI
  formatter also charges `Locale`.
- **Locked:** ECMA-262 permits implementation-approximated results for several
  `Math` operations and `**`. A deployment should pin an engine version across
  the artifacts that can resume a given execution, and a runtime must not treat a
  last-ulp difference in those operations as a journal-integrity failure.
- **Locked:** Using a value from TypeScript/JavaScript code is modeled as a
  dependency. Type-only imports do not create runtime requirements.
- **Direction:** Direct host-module usage carries an exact module requirement,
  such as `Module<"node:fs">`, rather than only a coarse platform bit.
- **Locked:** A capability may have different implementations by JavaScript host. A
  filesystem requirement can be supplied by Node, Bun, Deno, or a test
  implementation when available.
- **Locked:** Importing Zig and Rust through generated, strongly typed Wasm
  bindings should be exceptionally easy; Bun is an interoperability inspiration.
  This is a loader that produces a module the JavaScript host calls, not a
  compilation target.
- **Direction:** Existing C, Zig, Rust, Bun, Deno, or libuv implementations may
  be reused behind providers where technically and legally suitable.

## TypeScript target

- **Locked:** TypeScript is the only compilation target. The TypeScript target
  accepts and interoperates with complete TypeScript in imported `.ts`/`.tsx`
  modules. Authored `.sm` follows the intentionally distinct Smithers grammar.
- **Locked:** A compiled near-native target through LLVM is **withdrawn**. It was
  previously locked as a MUST, was never implemented, and was the largest unmet
  obligation in the repository.
- **Locked:** Wasm as a compilation target is **withdrawn**. Wasm remains
  available as a *library* format: a `.sm` program running on a JavaScript host
  may import Zig or Rust through generated Wasm bindings, which is an asset
  loader rather than a target.
- **Locked:** The built-in `TypeScript` requirement, the portable /
  `TypeScript`-required / forbidden feature classification, and the portability
  pin are all **withdrawn** with it. With a single target, every program depends
  on the JavaScript runtime, so the requirement carried no information and the
  pin had nothing to assert.
- **Locked:** The checked `panic` channel on unannotated foreign calls is
  independent of the above and is retained. It exists because JavaScript can
  throw, not because a second target exists.
- **Locked:** `any` and `eval` remain usable in `.sm`. General Smithers guidance
  may lint against them; the language does not forbid them.
- **Open — the sentence immediately above is contested, and shipped behavior
  already diverges from it. This is the most urgent of the six open questions.**
  The compiler refuses dynamic code evaluation today: `eval`, the `Function`
  constructor, and selection of `constructor` on a callable receiver are all
  rejected, and the conformance corpus certifies the refusal **on purpose, ahead
  of the specification**. The corpus case that does so says exactly that in its
  own notes: the specification "needs amending, and until it is, this case is
  ahead of the specification."

  **Why it was changed anyway, and it is a good reason.** Two `MUST`s in the same
  specification document were being violated, measured, on both backends —
  "Platform-specific globals … MUST NOT be unconditional globals in authored
  `.sm` code" and "Host-sensitive operations such as clock and random access MUST
  still use capabilities". Before the refusal landed, `Date.now()` was refused
  while `eval("Date.now()")` reported no failures, no requirements, and ran;
  `eval("process.platform")` returned the host platform on both backends with
  zero diagnostics; `eval("Math.random()")` bypassed the randomness wall. Twenty
  of twenty-two measured spellings failed open, including a shorthand `{ eval }`
  and `Function.prototype.constructor`. A `MUST NOT` outranks a permission, so a
  permission lost to a prohibition.

  **The narrow reading that might save the locked sentence.** The refusal is on
  the *operation*, not the *name*: `Function` remains a usable type and
  `x instanceof Function` remains a prototype test, while every read that reaches
  the callee is refused. `crypto` already has exactly this shape. So "`eval` is
  not forbidden as an identifier" is defensible — but it is thinner than the
  sentence's plain meaning and must not be assumed without ratification.

  **What the pivot adds to the urgency.** Under replay the hole costs more than a
  wrong published row. An `eval`'d string produces no journal entry, so it
  produces no divergence to detect: a nondeterministic read the compiler could
  not see yields two histories from one journal, silently.

  **Not resolved here.** Ratify the amendment or ratify the narrow reading; the
  corpus and the ledger both stay as they are until one of those happens. The
  proposed replacement text is quoted in
  [Compatibility](/specification/compatibility) §Dynamic Features. The sibling
  case pinning the `any` half of the sentence is untouched and still passes —
  `any` cannot reach the host namespace by itself — so whichever way this is
  settled, the `any` half is not in question.
- **Locked:** Arbitrary dynamic import expressions remain available, since there
  is no target that cannot resolve them. Inside a Flow body a dynamic import is
  subject to the determinism obligations in
  [Durable Execution](/specification/durable-execution) §Flow Determinism like any
  other operation; no separate rule is added for it here.
- **Open — the ledger, the corpus, and the product disagree three ways about
  dynamic import.** The locked sentence above reads absolute. The compiler reads
  it narrowly: a dynamic import of another project module, or of a foreign module
  carrying the trust claim, is ordinary; an untrusted foreign edge, or one whose
  destination cannot be resolved at all, is refused. The corpus encodes exactly
  that narrow reading, and **two of its cases certify a dynamic import as
  compiling *and running*** — one of a trusted foreign module, one of a project
  module — alongside three refusal cases.

  Independently of which reading is right, **the shipped CLI refuses every
  dynamic import**, including the two the corpus certifies as compiling and
  running, with a code-less project error rather than the diagnostic the corpus
  pins: "Smithers dynamic import is deferred until the frontend can preserve its
  exact rewrite map". A computed specifier is refused earlier still, with a
  different code-less error than the one the corpus pins.

  So there are two separable questions. (1) Does the lock permit the refusals the
  corpus pins? (2) Regardless of (1), the product contradicts the lock and the
  corpus *together*.

  **Not resolved here, and no lane should move either side first.** The
  divergence is already recorded in the conformance product-divergence register
  under a single shared cause, and the certifying corpus case carries an
  instruction for the losing outcome: if this is settled against dynamic foreign
  edges, retire the case rather than reinterpreting it.
- **Open:** Type assertion semantics need a final decision. Current candidate:
  safe assertions erase, and reifiable assertions may check and defect on
  failure. The TypeScript non-null assertion is already removed, because `!` is
  the Result propagation operator.
- **Direction:** A future compiled or portable target is an undocumented plan,
  not a commitment. If one is ever pursued, the classification machinery removed
  here is what it would need back.
## Comptime and runtime validation

- **Locked:** Comptime follows Zig: the compiler evaluates code automatically
  when possible, while an imported compiler intrinsic forces compile-time
  evaluation.
- **Locked:** Comptime is not a language keyword. Source imports `comptime` from
  `smithers:comptime` and passes it a value or function. The compiler recognizes
  the resolved binding rather than its local spelling, so aliases work and
  unrelated functions named `comptime` remain ordinary.
- **Locked:** `comptime(value)` forces evaluation of the argument during
  compilation. `comptime(functionValue)` marks and returns a compile-time
  function; it does not invoke the function merely because it was passed.
- **Locked:** `smithers:comptime` is a compiler-owned virtual module. Recognized
  imports and calls are lowered or erased, and uncompiled execution must fail
  while loading the virtual module rather than evaluating arguments at runtime.
- **Locked:** Comptime may generate types.
- **Locked:** Comptime I/O follows Zig's model. Compiler-known imports/embedding,
  including JSON used to derive types, are supported; arbitrary unavailable
  runtime operations are not silently performed during compilation.
- **Locked:** There is no `runtime type` declaration modifier.
- **Locked:** Validators, codecs, schemas, equality, hashing, and similar
  artifacts are derived at comptime from ordinary types.
- **Locked:** External data remains `unknown` until parsed or validated, as a
  best practice rather than a globally enforced rule on the TypeScript target.

## Control flow

- **Locked:** Smithers adds no expression-form control-flow grammar. Blocks,
  `if`, `switch`, `while`, and `for` are TypeScript statements and keep
  TypeScript behavior. A value-position `if` is a ternary, and a value-position
  `switch` is a function call or a lookup — neither is a TypeScript pain point
  worth new grammar.
- **Locked:** Smithers does not add labeled `break` values, loop `else`
  completion, labeled block or loop values, `defer`, `errdefer`, a braceless
  value `if`, or an arrow-arm switch. None of these is a TC39 proposal.
- **Locked:** The one accepted grammar addition is declarations in conditionals,
  adopted early from the TC39 Stage 1 proposal of that name. It is accepted
  because it is standards-track, not because it is convenient.
- **Locked:** Smithers does not add a throw-expression grammar in the initial
  scope. Ordinary `throw` statements produce Result errors; expression-form
  throw may be reconsidered when the TC39 proposal is available upstream.
- **Locked:** A future grammar addition requires an active TC39 proposal. Value
  semantics that TypeScript can already express belong in the type system, the
  standard library, or a compiler-recognized imported intrinsic — never in the
  parser.

## Concurrency

- **Locked:** Prefer relevant TC39 concurrency work instead of inventing a fiber
  abstraction. The compiler-owned resumable calling convention is not a fiber
  abstraction and must not be presented as one: it has no user-visible type, no
  source-language surface, and is not obtainable from non-durable code.
- **Locked:** Concurrent effect requests inside a Flow body are dispatched
  through a runtime-owned scheduler. The scheduler assigns each request a
  submission index in a deterministic order derived from program order, journals
  the order in which requests completed, and on resumption delivers completions
  in the journaled order. A combinator whose result depends on arrival order —
  including `Promise.race` and `Promise.any` — is not reachable except through
  the scheduler. The scheduler has no source-language surface.
- **Locked:** Smithers follows TC39's module-expression, source-phase import,
  shared-struct, concurrency-governor, and cancellation work where it fits.
  A governor limits fan-out; it does not own child-task lifetimes.
- **Locked:** Smithers does not add special Promise or join grammar. Static or
  library combinators start concurrent work, `await` consumes the resulting
  Promise, and Result combinators collect expected outcomes.
- **Direction:** A structured-concurrency library combinator may own child
  lifetimes, cancel siblings, and wait for cleanup without changing the parser.
- **Locked:** Cancellation is visible in typed failures and is provided through
  the dependency model rather than manually threaded tokens. Under one-shot
  continuations cancellation *is* "the handler declines to resume", which is a
  cleaner fit for the dependency model than a token was.
- **Locked:** Authored `.sm` code must transitively consume every started
  Promise with `await`: either directly or through a recognized combinator such
  as `Promise.all` whose result is awaited. Promise instance chaining through
  `.then()`, `.catch()`, or `.finally()` is a compile error. Imported
  TypeScript/JavaScript modules retain normal Promise behavior internally.
- **Locked:** Awaiting a fallible async operation produces its
  `Result<A, E>`; `await` does not silently unwrap or discard the Result.
- **Direction:** Promise subclasses, custom thenables, and other behavior that
  prevents sound consumption or lifetime analysis may be rejected in `.sm`;
  the exact supported Promise subset is still open. This becomes more urgent
  under replay, where the question is determinism rather than lifetime analysis
  alone.
- **Locked:** Imported TypeScript and JavaScript modules retain ordinary Promise
  behavior internally, and that is a genuine gap in replay determinism rather
  than a harmless carve-out. A Flow body must not depend on the interleaving of
  work started inside an imported module: any such work must be consumed at the
  boundary through a single awaited value, and the runtime journals only that
  value.

## Durable execution

- **Locked:** Durable execution is a language-level feature, not merely an
  observability library.
- **Locked:** Smithers's durable execution supersedes the need to build the
  separate `~/flows` library. That implementation is prior art and reusable
  runtime machinery, not the required user API.
- **Locked:** An Action is an abstract runtime operation with an open,
  replaceable provider implementation and a closed typed signature.
- **Locked:** An Action implementation is an ordinary function or callback.
  There is no separate Effect value in Smithers and no Action implementation
  wrapper beyond the policy/provider object that installs the function.
- **Locked:** Action signatures return `Result<A, E>` or
  `Promise<Result<A, E>>`; input, success, Error, and requirement information
  comes from that ordinary function signature. Persistence schemas/codecs are
  compiler-derived rather than repeated as schema arguments.
- **Locked:** Durable declaration is not a language keyword. Source imports
  `durable` from `smithers:flows` and passes it a statically resolvable function.
  The compiler recognizes the resolved binding rather than its local spelling.
- **Locked:** `smithers:flows` is a compiler-owned virtual module. A recognized
  `durable(...)` call becomes a Flow descriptor carrying the Flow's pinned source
  identity, its derived codecs, its Effect Manifest, and a reference to the
  emitted Flow body — not a runtime callback wrapper. The identity, codecs, and
  Manifest are serializable; the body is not reconstructible from them.
  Uncompiled execution fails while loading the virtual module.
- **Locked:** A Flow is an ordinary function whose execution is placed under the
  durable handler. `durable(...)` does not change what the function computes; it
  changes only which handler answers the function's effect requests. Ordinary
  control flow — branches, loops, `let` bindings, closure capture, and recursion
  — executes unchanged inside a Flow.
- **Locked:** The compiler does not invoke the durable source function with
  proxies or symbolic JavaScript values to discover its graph, at any phase,
  including replay. An `Action.run` expression emits a journaled effect request
  bearing a stable site identity and the derived codecs for its input and answer;
  applying `!` to its Result emits the ordinary failure exit and is given no
  durable-specific meaning. Action implementations do not run during compilation
  or inspection.
- **Locked:** The emitted Flow body must be present in every artifact that can
  create or resume an execution of that Flow, and reachable by the Flow's pinned
  source identity. Tree-shaking must not remove it from such an artifact.
  Inspection must not load it. A coordinator must not require a live function
  side table, a proxy-recorded graph, or any value that did not arrive from the
  journal or from the Flow's declared input.
- **Locked:** Durable execution distinguishes compilation, deployment build,
  inspection, and execution. Inspection reads the Effect Manifest and reports a
  **bound on what a Flow may request**. It is not a prediction of what a run will
  do and must not be relied on as one.
- **Locked:** Runtime-dependent control flow inside a Flow body uses ordinary
  TypeScript statements and is not represented in the Effect Manifest. The
  Manifest is **sound with respect to reachability** — every Action identity,
  capability key, and external-input contract a run can reach appears in it — and
  may be imprecise about count and order. A call whose callee the compiler cannot
  resolve is either rejected inside a Flow body or forces the Manifest to include
  the full effect set of the callee's module; it never silently narrows the
  Manifest.
- **Locked:** Effect ordering inside a Flow body is the program order of the
  body. Concurrency is started explicitly through a recognized combinator.
  Implicit reordering or auto-parallelization of independent Action calls does
  not occur.
- **Locked:** A journal entry's key is `(siteId, occurrence)`. The site identity
  is content-addressed from the Effect Manifest; the occurrence index is assigned
  at **submission**, in the scheduler's deterministic order — never at completion
  and never as a bare execution ordinal. Two requests at different sites may
  complete in either order and still converge. Recorded as **PR-2, pending
  ratification**.
- **Locked:** Resumption re-executes the Flow body from its entry point, answering
  each request from the journal entry at its `(siteId, occurrence)` until the
  journal is exhausted, then dispatching the first request with no entry. If the
  body issues a request whose site identity does not match the entry at that
  occurrence, or completes with entries unconsumed, the runtime reports a
  divergence **naming the offending source site**, fails the attempt, does not
  commit, and abandons the execution rather than recording a terminal outcome.
- **Locked:** An execution is pinned to the Flow source identity it started
  under. A coordinator whose Flow source identity differs abandons that execution
  rather than replaying it or terminalizing it. Recorded as **PR-3, pending
  ratification**.
- **Locked:** The compiler derives and publishes a static **Effect Manifest** per
  Flow: reachable Action identities, capability requirement row, external-input
  contracts, failure row, and site table. Sets and tables only — no control-flow
  edges, no branch structure, no execution counts. It exists for versioning and
  signing. Recorded as **PR-1, pending ratification**.
- **Locked, and it is a loss:** static flow-version divergence detection is
  downgraded. The previous model decided statically and totally whether an
  in-flight execution could move to a new Flow version by diffing two plan
  templates node by node, before the new coordinator touched a journal. Under
  replay that total static answer does not exist — it is the hardest unsolved
  problem in this class of system, and the state of the art detects divergence
  only at run time and without a source location. What replaces it is a partial
  static answer plus a named dynamic one. Strictly better than run-time-only
  detection with no source location; **strictly worse than what exists today**.
- **Locked, and it is a loss:** the signable pre-execution artifact is
  downgraded. An operator could previously sign *what a Flow will do*. The signed
  artifact is now `{flowSourceDigest, effectManifest, journalSchemaVersion,
  routingManifest}` and attests to what a Flow **is** and what it **may request**.
  One honest correction shrinks the loss — the previous artifact was already a
  template rather than a trace, because an unresolved branch stayed an explicit
  conditional in the reported plan — so what is actually lost is *bounded may*:
  the static ceilings that made the template finite. The Effect Manifest buys
  this back and about half of the versioning loss. It **must not** be described
  as equivalent to the artifact it replaces.
- **Locked, and it is a loss:** implicit fan-out parallelism disappears. The
  previous model ran every independent Action concurrently with zero author
  annotation, and that was safe only because journal keys were content-addressed
  rather than positional. Under program-order execution, concurrency becomes
  explicit and scheduler-mediated. This is recorded as an accepted capability
  loss, not a silent deletion — see the open question below, which is what has
  **not** been decided about it.
- **Open — is losing implicit fan-out parallelism acceptable? This is a product
  decision, not an engineering one, and it is not made here.** The trade-off:
  for a framework whose Actions are model calls, a 20-way independent fan-out
  that becomes sequential is a wall-clock regression measured in minutes, on a
  workload where that is the dominant cost. Against that, program order is what
  makes replay reproducible without a plan, and implicit concurrency is what made
  the previous journal keys have to be content-addressed in the first place. If
  the loss is **not** acceptable, an explicit concurrency combinator must ship in
  the same release as the first Flow that needs one; it cannot be follow-on work,
  because a Flow written against sequential semantics and later parallelized is a
  changed body with live executions. If it **is** acceptable, say so, because it
  will otherwise be reported as a bug by the first user who measures it.
- **Open:** journal boundedness. A Flow body containing an unbounded loop can
  journal without bound, and each resumption re-executes the whole prefix of the
  body, so an execution with *n* requests resumed *n* times costs O(n²) body
  execution. The previous model bounded this by construction through static
  ceilings on plan nodes, loop rounds, and fan-out steps; those ceilings go with
  the plan and no replacement is specified. A runtime should impose a
  journal-size limit and must fail closed rather than silently truncate. A
  continue-as-new equivalent is user-visible API and should not be designed under
  pivot pressure.
- **Open:** How an *order-independent* concurrency combinator reaches the
  scheduler. `Promise.all` and its keyed and settled variants charge no
  `Scheduler` requirement, because their result does not depend on arrival order
  — yet they start concurrent requests that must still acquire submission indices
  deterministically. Two locked obligations are in tension until this is settled:
  every concurrent request is dispatched through the scheduler, and every
  `Promise` member other than `race` and `any` stays free. Recorded rather than
  resolved.
- **Open:** The Effect Manifest's **site-table diff has no normative rule.** It is
  described as recovering "a site with committed evidence must not change its
  semantics", but that is a statement of what the diff buys back, not an
  obligation on an implementation. What counts as a site's *semantics*, and what
  an implementation must do when a site with committed journal evidence changes,
  are unspecified. Recorded rather than invented.
- **Locked:** Durable Actions and Flow executions can run across processes,
  sandboxes, and machines. Deployment builds can emit multiple TypeScript
  worker artifacts plus a coordinator and routing manifest.
- **Direction:** Placement belongs to provider/deployment layers rather than
  the abstract Action, allowing multiple target and location implementations
  of one closed signature.
- **Direction:** Durable execution includes persisted lifecycle, attempts,
  retries and deadlines, cancellation, timers/signals, child executions,
  journal/history, idempotency, fencing, compensation, and recovery.
- **Direction:** Cross-machine Action values must satisfy a compiler-checked
  durable schema/codec contract. Large values use typed artifact references.
- **Direction:** Journal and runtime state can commit atomically with each
  other, not with an arbitrary external service. External retry safety requires
  destination-side idempotency/deduplication, a fencing or transaction protocol
  the destination enforces, or an explicit compensation strategy.
- **Locked:** Sealing is a content-cache guarantee, and compensation repairs
  consequences; neither one independently provides exactly-once external
  effects.
- **Direction:** Recovery safety and cache eligibility are separate Action
  policy dimensions. `sealed` means hermetic/deterministic/shared-cache-safe,
  not merely “implemented.”
- **Locked:** Every resolved Action node is adopted into run-local durable state
  before exposure downstream, including cache hits, successes, typed failures,
  and defects. Restart does not depend on a cross-execution cache entry still
  existing.
- **Locked:** Cross-execution reuse distinguishes nondeterministic memoization
  from deterministic content caching. Memoization atomically makes the first
  committed success canonical for an explicit key, scope, and generation;
  content caching asserts that an equivalent result can be reproduced from the
  complete content key.
- **Direction:** Run-local node identity, downstream idempotency identity,
  nondeterministic memo identity, and deterministic content identity are four
  distinct keys. Content keys include canonical inputs, implementation and
  policy versions, relevant dependency/toolchain facts, and explicit salts.
- **Direction:** Content-cache eviction changes performance only. Memo expiry
  or reset opens a new semantic generation while existing runs retain the
  generation and value digest they adopted.
- **Open:** Stable persisted IDs, wire encoding, journal-schema migration, and
  provider and deployment syntax remain open questions in
  `docs/DURABLE_EXECUTION.md`. **Plan loop/fan-out semantics and explicit
  sequencing syntax are closed** and are removed from that list: program order is
  order, so there is no sequencing construct to spell, and there are no loop or
  fan-out templates to give semantics to. Stable *source* identity is likewise
  closed — it is normative as the journal key — which is a different question
  from the persisted-ID encoding, which stays open.

## Asset-backed prompts and agents

- **Locked:** Prompt authoring with MDX is provided by the agent library on top
  of the general MDX loader. Prompt components and model-specific rendering are
  library APIs, not language syntax.
- **Locked:** The initial standard agent follows the existing code-writing
  design: on every turn the model produces ordinary TypeScript, which the
  library compiles and runs.
- **Locked:** Generated code can call only the functions explicitly passed into
  its execution environment. Passed functions may be ordinary callbacks,
  durable Actions, compiled Flows, or typed adapters around tools and MCPs.
- **Locked:** The code-writing agent and its sandbox are entirely library-level
  features. The agent library supplies an otherwise confined execution
  environment by default; Smithers adds no agent-specific sandbox syntax,
  effect system, or runtime requirement.
- **Direction:** The reusable agent primitives cover prompt rendering, model
  invocation, turn/history state, TypeScript compilation and execution,
  function-surface binding, and completion. They should make custom agents
  small compositions rather than framework implementations.
- **Direction:** Model calls, generated-code compilation, and execution may be
  wrapped in Actions and assembled with Flows to inherit journaling, caching,
  retries, inspection, and recovery without making those concerns intrinsic to
  the agent API.
- **Open:** Exact agent APIs and sandbox backends are library design work; see
  `docs/AGENT_LIBRARY.md`.

## Standard library

- **Locked:** The standard library should match or improve on the breadth of
  Effect's standard library while presenting ordinary Smithers APIs.
- **Locked:** Platform is a universal dependency and platform implementations
  are selected through capabilities and comptime.
- **Direction:** Compute-heavy components may call into Wasm modules, especially
  implementations written in Zig, but JS/Wasm boundaries are chosen by
  measurement rather than ideology.
- **Direction:** The standard library includes typed schema/validation,
  collections, configuration, streams, schedules, batching, platform services,
  and structured concurrency without copying Effect's wrapper/combinator
  ceremony.

## TC39 policy already accepted

- **Locked:** Adopt early where suitable: module expressions; source-phase
  imports; structs/shared structs; governors; async iterator helpers including
  unordered operation; `Promise.allKeyed`/`allSettledKeyed`; declarations in
  conditionals; discard bindings; Import Text and Import Bytes;
  cheap stack capture; `Reflect.panic`; cancellation; and a worker failure
  protocol. Smithers does not add Promise or structured-join parser syntax.
- **Locked:** Capabilities subsume AsyncContext for compiled dependency
  propagation; an interop adapter may exist at TypeScript boundaries. The reason
  is no longer "Smithers keeps its own async-local frame" but "the handler
  answers the request, and no ambient store is consulted".
- **Locked:** Smithers does not own expression-form control-flow grammar. See
  [Control flow](#control-flow): blocks, `if`, `switch`, `while`, and `for` are
  TypeScript statements. Room is deliberately left for future pattern-matching
  syntax to converge with TC39 rather than being pre-empted by an invented
  form.
- **Locked:** Forked platform declarations must be audited for Result errors,
  defects, and requirements.
- **Locked:** Standing rejections include Block Params, reinterpretation of
  existing negated `in`/`instanceof`, partial application that conflicts with
  capability calling conventions, cancelable Promises, withdrawn Record &
  Tuple, and distributed-promise/eventual-send designs.
- **Direction:** Shared structs are adopted but can be implemented after lower
  risk concurrency features.

## Compiler and delivery

- **Locked:** Build on the Go compiler now located under `tsc/` in
  `microsoft/TypeScript`, tracking upstream with a minimal diff.
- **Locked:** The canonical compiler fork is `smithersai/TypeScript`. Smithers
  vendors an exact fork revision at `vendor/typescript` as a squashed Git
  subtree; fork revisions are pinned in `typescript-fork.json`.
- **Locked:** The fork should make TypeScript extensible/configurable through a
  narrow plugin interface rather than embedding every Smithers feature directly
  throughout upstream code.
- **Locked:** The TypeScript backend lowers Smithers constructs into TypeScript
  before the ordinary TypeScript pipeline completes checking and emission where
  feasible. "Where feasible" narrows: constructs whose lowering depends on a
  whole-program row are lowered after inference completes, because generator
  emission needs completed row inference.
- **Locked:** A published `.d.ts` preserves Result contracts, requirement rows,
  **and each exported function's emitted calling convention**. A cross-package
  caller that cannot read a callee's calling convention fails closed rather than
  assuming the ordinary one. This is a published ABI and a larger commitment than
  the rows alone were.
- **Direction:** Delivery hooks such as content mappers may feed `.sm` source
  into the compiler, but semantic phases share one checked Smithers IR rather
  than parallel frontend models.
- **Open:** The exact compiler seams and plugin ABI require an architecture
  audit of the pinned upstream TypeScript revision.
- **Locked:** The toolchain should follow Go's batteries-included model:
  compiler, formatter, test tooling, language service, and build integration in
  one coherent distribution.
- **Locked:** `.sm` soundness configuration is mandatory and identical on every
  JavaScript host: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `isolatedModules`, `verbatimModuleSyntax`, and `useDefineForClassFields`.
  Making soundness target-conditional would mean a file valid for TypeScript is
  inconsistent across builds. Imported `.ts` keeps its own configuration.
- **Locked:** Deprecated and superseded compiler options are rejected rather
  than ignored, including `keyofStringsOnly`, `suppressImplicitAnyIndexErrors`,
  `noStrictGenericChecks`, `out`, `charset`, `importsNotUsedAsValues`,
  `preserveValueImports`, `experimentalDecorators`, and
  `emitDecoratorMetadata`. TypeScript's `erasableSyntaxOnly` set is treated as
  guidance about which forms are dying.
- **Locked:** Emit, module, and library options select output rather than
  legality. They remain configurable, since a `.sm` program may be emitted for
  Node, Bun, Deno, a browser, or an edge runtime.
- **Locked:** Decorators are not the mechanism for `comptime`, `durable`, or
  `native`. The Stage 2.7 proposal attaches only to classes, methods,
  accessors, fields, and auto-accessors — never to free function declarations,
  which is where those intrinsics apply. Free-function and parameter decorators
  are separate Stage 1 proposals. The imported-intrinsic call form also gives
  resolved-binding-identity recognition, which decorators cannot.
- **Locked:** Smithers must work inside existing JavaScript builds without
  adopting a Smithers-specific build system. `.sm` compiles to TypeScript before
  any other build tool processes it, so every downstream plugin sees ordinary
  TypeScript.
- **Locked:** That integration ships as an `unplugin` factory, giving Vite,
  Rollup, webpack, esbuild, Rspack, Rolldown, Farm, and the Bun bundler one
  implementation instead of one hand-maintained adapter each. The plugin runs
  first in the host pipeline, emits source maps, and resolves `.sm` specifiers.
- **Locked:** The plugin is delivery, not semantics. The same lowering the CLI
  performs is what a bundler gets; nothing may behave differently because it was
  built by a bundler.
- **Direction:** Because Smithers inference is whole-program and a bundler
  transform is per-file, the plugin offers a checked mode that drives a real
  program and a transform-only mode for fast rebuilds. Transform-only fails
  closed on anything needing cross-module information and is not a conforming
  implementation. Its blast radius grows from a corner case to the default:
  whether a callee is emitted in the resumable calling convention is
  whole-program information, so transform-only fails closed at nearly every call
  site reaching a function with a non-empty effect row. It is a fast-rebuild
  convenience for files with empty rows and must not be presented as a general
  build mode.
- **Measured 2026-08-30, because "the default" was an estimate and this ledger's
  numbers are supposed to be measured.** Over every cleanly-compiling conformance
  program (242 cases, 1205 call sites), classifying each call site by whether one
  file alone can decide the callee's convention: **93.2% are decidable in-file** —
  same-file declaration 37.6%, compiler prelude or intrinsic 29.8%, lib/host
  23.2%, foreign `.ts` 2.7% — and **6.8% fail closed**, of which cross-file `.sm`
  calls are 1.1% and checker-unresolved sites 5.7%. Cross-file callees that
  actually carry a non-empty effect row — the population the sentence above names
  — are **0.2%** of all call sites corpus-wide.

  The corpus is 228 of 242 single-module, so that understates a real project.
  Restricted to the multi-module programs (14 programs, 65 call sites): **21.5%
  fail closed**, and **4.6%** reach a non-empty-row callee across a file
  boundary. Over the shipped `poc/src` tree (123 non-test files, 17,014 call
  sites), **10.7%** of call sites are cross-file within the project.

  **The blast radius is real and it is not "nearly every call site".** The
  sentence above is true as a conditional — a cross-file call to a non-empty-row
  callee does fail closed, and one file cannot tell — but read as a claim about
  how much of a program stops compiling it is high by roughly an order of
  magnitude: about one call site in five in a multi-module program, not four in
  five. Recorded so nobody re-derives it, and so the product decision rests on
  the measured number. **The decision does not change:** transform-only stays
  unusable as a general build mode, because the fifth of call sites it refuses is
  not a subset an author can predict, confine, or design around.
- **Direction:** Comptime loaders and their imported assets participate in the
  compiler's content-addressed incremental graph, forming an early part of the
  broader build-machine design without requiring loader authors to use a
  separate build language.
- **Direction:** The compiler should grow into a Bazel-like incremental build
  machine. Parsing, checking, comptime evaluation, loaders, generated code,
  custom linters, durable Effect Manifest derivation and journal-identity
  assignment, foreign compilation, bundling, and deployment
  partitioning are explicit graph work with content identities and declared
  dependencies.
- **Open:** The build graph, rule/plugin contract, remote cache/execution
  boundary, and integration seams with TypeScript's existing incremental state
  require their own architecture design.
- **Open — the `@module` / `@throws {never}` marker is doing two jobs, and they
  agree today only by accident of enforcement.** Job one is
  **module-initialization safety**: a foreign module whose top-level code can
  panic before any checked call boundary is refused unless its leading JSDoc
  carries both `@module` and `@throws {never}`, and that refusal walks
  transitively through reached foreign modules. Job two is **access control for
  the compiler-owned prelude**: authored `.sm` must not reach a `Result`
  constructor. Job two is *not* enforced by the marker at all — it is enforced by
  **specifier form**, against an exact registry of compiler-intrinsic specifiers,
  with prefix matching deliberately refused because it has already been a
  fail-open twice.

  The two jobs coincide because the runtime modules that would otherwise need the
  marker deliberately do not carry it. `runtime/result.ts` and `runtime/panic.ts`
  are **unmarked on purpose, and their unmarkedness is the forgery guarantee**:
  `result.ts` also exports the lowering hooks that construct Result variants, so
  trusting the whole module would put a `Result` constructor one import away from
  authored `.sm`. The brand seam authored `.sm` *is* allowed to reach lives in a
  separate module that carries the claim truthfully, and every one of its exports
  is a predicate or an assertion — nothing there can construct a Result, a Panic,
  or an Error. That separation is pinned by a test that shows an unmarked wrapper
  re-exporting `result.ts` still draws the initialization refusal.

  **Why this is a question and not a note.** One marker is standing in for two
  invariants with different failure modes. Marking `result.ts` to satisfy job one
  would break job two silently. Enforcing job two through the marker rather than
  through specifier form would re-introduce the prefix fail-open. Nothing states
  which invariant the marker owns, so a future edit that "tidies up" the
  unmarkedness would look like a cleanup and be a forgery hole.

  **Not resolved here.** The candidates — split the marker into two tags, or
  state normatively that module-initialization trust and prelude access control
  are separate mechanisms that must never be unified — have not been costed.

## Immediate unresolved design work

1. Finalize checked versus TypeScript-only semantics for `as`.
2. Define Layer merge/override rules and requirement-environment lowering; base
   Layers do not own resources or child work.
3. Ratify or reverse PR-1, PR-2, and PR-3, then resolve the six open questions
   in the order this ledger ranks them — the `eval` contradiction first, because
   shipped behavior already diverges from a locked sentence, and the fan-out
   product call second, because an explicit combinator cannot be follow-on work.
   The remaining durable questions in `docs/DURABLE_EXECUTION.md` follow, one at
   a time.
4. Define the Effect Manifest's exact content and the site-identity scheme, then
   map them onto the pinned TypeScript compiler seams. The shared Plan/expression
   IR this item previously named is withdrawn with the plan.
5. Specify the comptime loader registration API and the built-in Markdown/MDX
   module shapes.
6. Design the agent library's minimal prompt, turn, execution, and passed-
   function interfaces; this is library work, not language grammar.
7. Design the compiler's incremental build graph and plugin contracts for
   generators, linters, foreign tools, durable Manifest derivation, and bundle
   partitioning.

## Amendment record — one-shot delimited continuations, 2026-08-27

House practice is that a rewritten locked sentence stays visible. The sentences
below were Locked in this ledger and are no longer. They are recorded here so a
reader who has quoted one can see what replaced it, and so that reversing any of
PR-1 through PR-3 has a text to reverse to.

**Withdrawn — the function model.**

> "Functions remain ordinary, eager functions. There is no `Effect<A, E, R>`
> value, interpreter, or `.run()` step."

Replaced under §Function model. The guarantee survives for **authored**
functions, which is the guarantee that was ever load-bearing; what is withdrawn
is the claim that it also describes emitted code.

**Withdrawn — the placement rule.**

> "Which expression placements accept `!` is now normative … The rule is five
> conditions, the first being that every node enclosing the `!` up to the nearest
> statement or arrow is one of seven forms … Measured over 115 cases; 34 accepted
> forms."

Three conditions replace five, and every previously rejected expression-nested
placement is now accepted, permanently. The 115-case measurement is withdrawn
with the rule.

**Withdrawn — promise-settlement revocation.**

> "Revocation happens at the returned Promise's state transition, before any
> queued reaction can reuse the environment. The runtime may reject a
> pre-existing Promise whose earlier observers make that boundary unverifiable;
> `async () => await existingPromise` is the explicit adapter. A host without a
> synchronous Promise-settlement hook must fail closed for an async Layer scope
> rather than leave authority live for an extra microtask."

The guarantee it protected is unchanged and now holds structurally. Three
obligations are withdrawn as unnecessary rather than relaxed: the
Promise-provenance rule, the fail-closed refusal on a host without the hook, and
the author-visible adapter.

**Withdrawn — the Flow as a plan.**

> "A Flow is the closed program produced by lowering the checked syntax, control
> flow, and data flow of a function passed to `durable(...)` into a statically
> analyzable execution-plan template."
>
> "An `Action.run` expression lowers to a plan node and typed symbolic value."
>
> "Runtime-dependent control flow is legal only when represented explicitly in
> Plan IR."
>
> "Durable execution distinguishes template compilation, deployment build,
> plan/preview, and execution. Unknown runtime branches and fan-out stay explicit
> in Plan IR during plan/preview."

**Inverted, not withdrawn — the disappearing source function.**

> "The durable source function disappears after the compiler emits the plan
> template, schemas, requirements, Result error union, identities, and debug map.
> Plan/preview loads emitted Plan IR without loading or invoking that function or
> any Action implementation."

The emitted body is now what resumes an execution, so it must be **present**
wherever an execution can be resumed. The half of the sentence that refused a
live function side table survives and is strengthened; the half that made the
body removable is reversed. This is the one place in this revision where a locked
obligation became its own opposite, and it constrains tree-shaking.

**Retained deliberately, against two prior designs** — the refusal of `!` inside
a `try` block with a `catch`. Under the new lowering the abort path still runs
`finally` and still skips `catch`, so the authored text still reads as though the
failure were catchable when it is not. The rule's reason survives verbatim; only
its explanation changed.

**Not withdrawn, and deliberately so** — every authoring-surface decision in
§Typed failures, §Absence and nullability, §Comptime and runtime validation,
§Control flow, and §Grammar. Nothing an author writes changed in this revision.
