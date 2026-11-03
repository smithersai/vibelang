# The VibeLang specification

This specification defines VibeLang as the accepted VibeLang Improvement Proposals (VIPs) and their public amendments define it, and nothing more. Each VIP lives in [`docs/design/vips/`](../vips/README.md), with the reasons for the decision and its history. Where this text and an accepted VIP or its public amendment disagree, the VIP wins and this text is the bug. Authorized clarifications are recorded in public amendments to the relevant VIP and its affected chapter, with the applicable pinned references and explicit reconciliation notes. Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies.

Declaration serialization has one explicit exception for [cyclic inferred types](001-functions.md#declaration-output); ordinary TypeScript recursion checking still applies.

The previous specification and its decision log (`D1` to `D558`) are in `docs/design/history/`. They are historical and not normative: nothing in them is part of the language unless a VIP adds it.

## Principles

VibeLang is TypeScript with a small set of constructs for writing Effect programs. Four principles decide every rule.

1. **Syntax decides.** A keyword on a function, a block or an expression decides what it means. A function literal never becomes an Effect because a parameter expects one, and a type never decides whether a loop consumes a Stream (VIP-1, VIP-2, VIP-20). Class patterns follow their separate [dispatch rules](004-match.md#class-patterns), including static call and construct signatures (VIP-7, amended).
2. **Exact sugar for Effect.** Every construct means one specific piece of Effect TypeScript, shown beside it in this specification. Compiled code gives the same `Exit` as that Effect TypeScript, with finalizers in the same order (VIP-31). Failures, defects, interruption and `Cause` combination follow Effect. VIP-7 adds exhaustiveness checking and generated error matchers to TC39 matching, and retains compiler fixed checks for Effect's `Option`, `Exit`, `Result` and tagged errors until Effect ships custom matchers; none patches Effect at runtime. The retained tagged-error checks use resolved constructor bindings (aliases included, shadowing excluded) and each module's own guard (including subpath errors: `HttpClientError.HttpClientError` uses `HttpClientError.isHttpClientError`; VIP-7, amended), not `instanceof` or a bare `_tag` test, as listed in [Retained fixed patterns](004-match.md#retained-fixed-patterns).
3. **No ambiguity.** Every new keyword has exactly one reading. The new keywords are contextual, except `fork` and `join`, which are reserved words in effect code exactly as `await` is in an `async` function ([the grammar's Effect parameter](900-appendices.md#the-effect-parameter); VIP-17, amended). The expression forms of `try` and `catch` reuse words already reserved by JavaScript. "A little bit of ambiguity is unacceptable" (VIP-8). A proposal that can't meet that bar is denied (VIP-8, VIP-10, VIP-11, VIP-24).
4. **TypeScript's meaning outside Effect code.** Plain functions, `async` functions, `await`, `throw`, `using`, classes, `do` expressions and the pipe operator keep their TypeScript or pinned TC39 meaning. The [contextual-keyword rules](900-appendices.md#contextual-keywords) apply throughout `.vibe`, including plain code; a TypeScript statement beginning with one of those identifiers can therefore parse differently. The additional static checks still apply: [throw tracking and `@throws`](003-failures.md#thrown-types) apply only to non-effectful functions; functions returning an `Effect`, `Stream` or `Layer` cannot throw JavaScript exceptions; `throw` in an `effect` body means typed failure through `Effect.fail` (VIP-4, amended). [Legacy JavaScript restrictions](001-functions.md#direct-eval) also apply throughout `.vibe`, including plain functions (VIP-1, VIP-4, amended). [Platform restrictions](005-services.md#the-platform-standard-library) apply throughout `.vibe`, including plain functions and wrapper arrows (VIP-33).

## The language at a glance

| Construct | Means exactly | VIP | Chapter |
| --- | --- | --- | --- |
| `effect function f() { }`, `effect function (x) { }` (an expression), `effect () => …`, `effect m() { }` (a method) | a function returning `Effect.gen(function* () { … })` | 1 | [Functions](001-functions.md) |
| `A!E!R` | `Effect.Effect<A, E, R>` | 3 | [Functions](001-functions.md) |
| `try e` (unary, with the precedence of `await`) | `yield* e` | 5 | [Running Effects](002-running.md) |
| `e catch (err) => y`, `e catch effect (err) => …` | `yield* Effect.catch(e, …)` | 5 | [Running Effects](002-running.md) |
| `effect { … }` | `Effect.gen(function* () { … })` | 2 | [Running Effects](002-running.md) |
| `fork e`, `fork.in(s) e`, `fork.scoped e`, `fork.detached e`, `join f` | `Effect.forkChild`, `forkIn`, `forkScoped`, `forkDetach`, `Fiber.join` | 17 | [Running Effects](002-running.md) |
| `try.all [ … ]`, `try.race`, `try.any`, `try.allSettled` | `Effect.all(…, { concurrency: "unbounded" })`, `raceAllFirst`, `raceAll`, … | 18 | [Running Effects](002-running.md) |
| `for concurrent (const x of xs) { }` | `Effect.forEach(xs, …, { concurrency, discard: true })` | 19 | [Running Effects](002-running.md) |
| `for try (const x of stream) { }` | `Stream.runForEachWhile` | 20 | [Running Effects](002-running.md) |
| `effect function* p() { yield x }` | `Stream.callback` | 21 | [Running Effects](002-running.md) |
| `uninterruptible { restore { } }`, `interruptible { }` | `Effect.uninterruptibleMask`, `Effect.interruptible` | 22 | [Running Effects](002-running.md) |
| `throw e` in an `effect` function | `return yield* Effect.fail(e)` | 4 | [Failures](003-failures.md) |
| `error E { fields }` | `class E extends Data.TaggedError("E")<…> {}` | 13 | [Failures](003-failures.md) |
| `schema error E { fields }` | `class E extends Schema.TaggedError<E>()("E", { … }) {}` | 29 | [Failures](003-failures.md) |
| `match (x) { when P: …; }` | TC39 pattern matching, plus an exhaustiveness check, generated error matchers and fixed Effect pattern checks | 7 | [Pattern matching](004-match.md) |
| `service S { members }` | `class S extends Context.Service<S, { … }>()("key") {}` | 9 | [Services](005-services.md) |
| `provide L, K = v { … }` | `yield* Effect.provide(Effect.gen(…), [L, Layer.succeed(K, v)])` | 12 | [Services](005-services.md) |
| `retry`, `sleep`, `Schema`, `Layer`, … | Effect's exports and modules, in scope without an import | 6, 14, 33 | [Services](005-services.md) |
| `schema S { fields }` | `const S = Schema.Struct({ … }); type S = typeof S.Type` | 15 | [Data](006-data.md) |
| `data D { V; W { f: T } }` | `Data.TaggedEnum` and `Data.taggedEnum` | 16, 28 | [Data](006-data.md) |
| `x.vibex` | a `.vibe` file read with `.tsx`'s JSX language variant | 39 | [Configuration and tooling](007-tooling.md#vibex) |

The table abbreviates the full translations: preserve [source function bindings](001-functions.md#meaning), dispatch [outward jumps](002-running.md#region-bodies) after `provide` and interruption blocks, and add the [custom matcher](004-match.md#class-patterns) to error classes. All Effect TypeScript meanings use the [pinned `effect` 4.1.0](007-tooling.md#the-effect-version).

Classes without an own `Symbol.customMatcher` use `instanceof`, built-ins use `Array.isArray` or `instanceof`, and primitives test `typeof` too, because compiled JavaScript can't read the pinned draft's engine slots. [Class patterns](004-match.md#class-patterns) gives the full rule.

What VibeLang leaves out is just as deliberate. The [appendix](900-appendices.md#denied-vips) lists the denied VIPs: no Effect meaning for `using`, no `Users.find(id)` shorthand, no trailing blocks, no `wire`, no inline modules. The open VIPs (handlers, the declaration manifest, Effectify the universe) are not part of the language.

## How to read this specification

Constructs generally have four parts; the type shorthand keeps its static rule under **Meaning**:

- **Syntax**, as links to the productions of [Appendix A](900-appendices.md#appendix-a-grammar), the only place the grammar is written, with prose and examples.
- **Static rules**, with the diagnostic each rule reports and its code in [Appendix B](900-appendices.md#appendix-b-diagnostics). VIP-34 requires every diagnostic to have a code; each imported Effect language-service rule prints a stable `EK38xx` code (VIP-38, amended).
- **Meaning**, as the exact Effect TypeScript the construct equals, beside the VibeLang.
- **Examples.**

A detail that no accepted VIP, public amendment, or TypeScript or pinned TC39 counterpart decides is marked **Undecided (pending VIP)**. Such details are not part of the language until decided.

### Examples are pending

The compiler is being changed to match the VIPs. Until it does, every VibeLang example here starts with a `// compiler-gap: pending VIP-N` line, which the snippet checker (`docs/tools/check-snippets.ts`) reports as a known gap rather than a failure. An Effect TypeScript comparison that needs undeclared helpers is marked `// fragment`, for example when it calls `fetchUser` without declaring it. Complete comparisons omit that marker and can be checked as self-contained programs. [Appendix D](900-appendices.md#appendix-d-flipping-pending-examples) says how to flip an example once its VIP is implemented.

## Chapters

1. [Functions and Effect types](001-functions.md): VIP-1, VIP-3, VIP-4 (legacy JavaScript), VIP-26, VIP-27.
2. [Running Effects](002-running.md): VIP-5, VIP-2, VIP-17 to VIP-23.
3. [Failures](003-failures.md): VIP-4, VIP-13, VIP-29.
4. [Pattern matching](004-match.md): VIP-7.
5. [Services and the environment](005-services.md): VIP-9, VIP-12, VIP-6, VIP-14, VIP-33.
6. [Data](006-data.md): VIP-15, VIP-16, VIP-28.
7. [Configuration and tooling](007-tooling.md): VIP-30, VIP-32, VIP-34, VIP-38, VIP-39.
8. [Runtime guarantees](008-runtime.md): VIP-31.
9. [Appendices](900-appendices.md): the grammar, the diagnostics, the denied and open VIPs, and flipping pending examples.

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. A cited “principle N” is one of the eight decision principles: 1 least surprise and idiomatic Effect TypeScript; 2 mirror TypeScript or TC39; 3 syntax decides; 4 fewer rules; 5 legacy JavaScript banned; 6 effectful functions can't throw; 7 drop non-idiomatic behavior; 8 conservative when unsure.

### Detail 207

**A snippet's explicit fragment label describes missing context, not its role as an Effect comparison.** (live `000-fragment-labels`; records the existing snippet-checker contract, source correction already queued by spec-fix-a.) Use `// fragment` when the displayed block intentionally lacks the definitions/imports/fixtures needed to check it independently in its documented context. A complete Effect TypeScript counterpart remains an ordinary checked comparison without that opt-out; do not label every counterpart a fragment. Keep compiler-gap/pending metadata separate and retain the checker's current classification rules, including its existing missing-name treatment for ordinary noncomparison blocks. This corrects the introduction's universal statement; it changes no syntax, language semantics or checker behavior.
    **Immutable-main source receipt (695576, 207).** Verified at immutable main `695576acb44b`: 000 distinguishes incomplete helper-dependent fragment comparisons from complete independently checkable comparisons. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    ```vibe
    function three() { return 3 } // complete, with no missing helper or fragment opt-out
    ```
    Effect TS: `import { Effect } from "effect"; function three() { return 3 }; Effect.runSync(Effect.sync(three))` is a complete checked counterpart; a displayed `Effect.sync(() => fetchUser(id))` that omits its helper and fixture context is an explicitly labeled fragment instead. Decided by the agent from principle 4 (one meaning for the existing opt-out marker), principle 2 (complete TypeScript programs receive ordinary checking), and `docs/tools/check-snippets.ts`'s existing extract/classify contract, 2026-10-30. The checker says Effect comparisons are checked too and fragments opt out explicitly, recognizes the marker independently of the comparison role, and classifies complete comparisons through their diagnostics. No new Will choice is involved. Source fix `ce9cec641cd568257f7e067b5fb0eb6eb72375ad`/`vibe/alpha-spec-fix-a-12` is already reported queued: its commit receipt reports a baseline-failing/after-passing documentation regression using actual extract/classify behavior plus regeneration/docs/token checks. Decide-live inspected the existing checker and commit stat read-only and independently ran neither that fixing test nor a compiler-conformance check. Preserve this as a documentation/tool-contract resolution, not a new compiler permission.

Landing receipt: source ce9cec641cd5 landed in main 695576acb44b (queue 1793373383-spec-fix-a, gate mq-10302026-7).

Applied in ce9cec641cd5 (spec-fix-a), landed main695576acb44b. Actual extract/classify regression passed again in the landed19-test receipt; see spec-fix-a.REPORT.md. This is source/tool-contract publication, not compiler conformance.

### Detail 213

**Public language rules must be recoverable from accepted VIPs and their public amendments, not a private decision layer.** (Opus rounds21–23 m15; live `000-public-authority-priority`; public/private source boundary.) Preserve accepted VIP decisions and authorized clarifications; reconcile each applicable ruling/detail into the relevant public VIP amendment and affected chapter in the same source change. The public priority statement then points to those accepted VIP/amendment texts, their pinned references and explicit reconciliation notes where applicable, and the chapters that specify them. A private ruling, a private decision-file path or an unspecified 'applicable decided detail' is not an additional normative source that public readers must discover. When a public chapter disagrees with an accepted VIP or its amendment, cite and correct the public disagreement; when a VIP is silent, record an authorized derived clarification in its public amendment instead of relying on hidden precedence. Open/denied VIPs and old historical decisions do not enter the language by being mentioned in an internal report. Do not delete an approved semantic rule merely because its publication is pending: the missing public reconciliation is documentation delivery work, and receipts must distinguish 'decided internally', 'source queued' and 'present on main'. Publish only the language rule, rationale and relevant primary references. Do not copy this private decision file wholesale, or publish private operational/commercial notes, account details, runbook material or hidden deliberation as the repair. Retain source/review receipts privately where needed. This completes the existing public record without changing any admitted program's meaning.
    **Immutable-main source scope (d0cdbe, 213).** 000/VIP README publish the accepted public VIP/amendment priority chain. Public VIP7 binding-cell and VIP9 shape/generic amendments are present, without asserting every corresponding chapter counterpart or all private decisions are published. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Public VIP33 reconciliation landed as c080051ae52b from439c77582723 (spec-fix-c; globalThis platform code and VIP1 Function exemptions only).
    Publication receipt: applied in c36e89ad7f0d (spec-fix-c; VIP7 actual-test negation; queued, not a main receipt). Existing004 source receipt896853cf4870 remains separate.
    Publication receipt: applied in ac8433dd4267 (spec-fix-c; VIP7 cell rules; queued, not a main receipt).
    Public service publication: relevant VIP9 amendments applied in 267e5893ff47c15cb06959b176b9ed613815524f (spec-fix-c; submitted, no main receipt). Chapter005 counterpart/admission guidance remains separately submitted in45d9623587db; other213 publication stays with its owners.
    Public schema publication: relevant VIP15/29 amendments applied in 5a5f50ed1e2e14f0c674ecb6dad891316dc71ee0 (spec-fix-c; queued, not on main). This publishes the owned schema rules; other213 public-authority work remains with its owners.
    Status (public priority statements): applied in 5e8c36c30453 (spec-fix-a; queued, not yet a main landing receipt). Public amendments accompany new source clarifications; no private decision log was published.
    ```vibe
    effect function one() { return 1 } // VIP-1: calling constructs a cold Effect
    effect function use() { return try one() } // VIP-5: written execution runs it
    ```
    Effect TS: `function one() { return Effect.gen(function* () { return 1 }) }`; `use` executes it with `yield* one()`. A public reader can derive both from the accepted VIPs and chapters without a private file. Decided by the agent from the user's rule that reusable language documentation is public while private operational/commercial context stays private, VIP-index acceptance authority, and principle 4 (one explicit public source chain instead of a hidden parallel authority), 2026-10-30. Amend 000/the VIP index consistently and reconcile affected VIP notes; this record authorizes no publication by the decision-only lane and makes no claim that every existing detail is already incorporated.
    Status (spec-fix-a chapters): applied in d772570a95c9 (000) and a1379f905be0 (001), landed in main 86b5972e0cfb; 900 in a79043b70074, landed in main 77510050781c. Each numbered decided-detail citation now cites the accepted VIP amendment that records the rule.


    Independent main read: `root-main-c080-vip33-receipt.json` verifies `c080051ae52b` is an ancestor of fetched main `b77fec1e7951`, and retains the public VIP-33 source/hash. Its globalThis paragraph uses `EK4402` for banned platform members and links VIP-1 for the existing Function instanceof/prototype exemptions, while other globalThis misuse stays `EK0107`. This verifies only the73/97/201 publication slice and public ownership, with no compiler/regression execution.

    Independent batch source read: `root-batch695-source-receipt.json` records the complete52,596-character seven-file design diff from `b77fec1e7951` to on-main `695576acb44b`, read in four contiguous slices. It verifies source publication for pipe131/145/156/157/170, contracts138/173, decorator/overload139/175/188, advisory124, arrow-head184 shapes and fragment207. Compatibility189/194 and later184/211/catalog companions retain separate unlanded scopes. No compiler, generated-doc gate or conformance rerun by this lane.

Landing receipt: source 5e8c36c30453 landed in main d0cdbe5a0a7f (queue 1793380654-spec-fix-a, gate mq-10302149-2).

Public VIP2 static predicates: applied in3d60171bb38d (spec-fix-a; queued, not main). Complete177/182 source and an explicit relevant-VIP amendment accompany the same fix; four before failures/seven after passes and exact spec-target receipt are retained.

Public VIP27 Bun-script clarification: applied in36d702266edd (spec-fix-a; queued, not main). Native Bun1.4.2 and TypeScript5.9.3 prove command dispatch/sidecar checking; source001/VIP27/user docs/changelog reconcile the factual tool claim without changing a language/API rule.


    Tooling citation publication: applied in6b79a76736b69a50a31883d6f963bd06fd5597de (spec-fix-d/bookmark43; source queued, not main). All fifteen chapter007 private numbered citations now link to accepted public VIP5/30/32/34/38 amendments; every code fence is unchanged. Before/after guards, keyed citation-family fuzz, publication gates and known-main-RED fullshort receipts are retained. Other213 publication remains with its owners.

    Runtime citation publication: applied in f10be1bb637bb1b40f1c52320ea802a45b88955f (spec-fix-d/bookmark44; source queued, not main). The four chapter008 private reference groups now cite accepted public VIP7/17/31 amendments; every code fence stays unchanged. Before/after quote guards, keyed case/spacing/number fuzz controls and publication/fullshort receipts are retained.

    Chapter008 public-reference recovery applied in `99b1f81f8a0e` (spec-fix-d44; queued on988137e1, replaces rejectedf10be1bb637b; source-only receipt).

    Chapter007 public-reference recovery applied in `aab9908727f2` (spec-fix-d43; queued on tested988137e1, replaces rejected6b79a76736b6; main warning-row additions retained).

    **Immutable-main source publication (773bddb1d57f, 213).** Chapter 007 replaces its fifteen private numbered-rule citations with accepted VIP-5/30/32/34/38 links. No code fence changes in this citation slice. The separately pending eleven-advisory amendment and `EK0801` authority repair under details 124/244 are not certified by this citation receipt. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.

    **VIP-39 chapter/publication corrections (Loop r4 Opus OPUS-2/3/6).** The accepted VIP already settles the extension and native JSX behavior. Publish its file kind, type/grammar competition, module classification, resolution order, JSX options, `.jsx`/`.js` output and `.d.vibex.ts` sidecar throughout000/001/007/AppendixA and affected references; pending chapter delivery does not remove the accepted feature. Native `react-native` retains JSX just as `preserve` does, so both belong in the downstream-framework-transform group; only `react`/`react-jsx`/`react-jsxdev` transform it in TypeScript. Preserve the existing stated framework limitations and no-extra-run-ban rule. Native JSX scanning also merges adjacent `</` into `LessThanSlashToken`, even outside a tag, so qualify the source-parsing/relational-pattern guarantees and add that scanner clash. Write a space in `a < /b/.source.length` or `when < /b/:` when the separate relational token and regex are intended; do not introduce a pattern-only scanner exception or modify upstream scanner rules. Native TS5.9.3 controls in `native-loop-r3/jsx-scanner-modes.log` confirm the parser difference, whitespace control and five emit-mode groups; they are not VibeLang pattern/framework checks. Decided by the agent from accepted VIP-39's native scanner/checking/emit and unchanged-production requirements, principle2 and existing213's public-authority/publication rule, 2026-10-31. No new numbered policy or code. Add mode/scanner/context/spacing regressions and spec-quoted fuzz controls, retaining source-order and ordinary pattern semantics.

### Detail 310

**Unsupported pre-VIP special forms retire through preserving migration; historical decisions are not language authority.** (Will's no-pre-VIP-relics standing ruling recorded in `loop/WILL-ANSWERS.md`, 2026-11-03, verbatim relayed by effectscript-11; its D152 application; existing213/274/277 and principles1/2/3/4/7/8.) The legacy Option/Stream receiver-method extension, such as `value.map(f)`, retires. For every pre-VIP VibeLang special form reported by `vibelang-forms -legacy` that no current accepted VIP adds or inherits, implement the preserving codemod to the VIP form or ordinary Effect TypeScript API, migrate the repos and corpus, then reject the retired form with a clear diagnostic and list the change in release notes. No new question asks Will to confirm this inventory.

    ```vibe
    import { Option, Stream } from "effect"
    export const optional = Option.map(Option.some(1), value => value + 1)
    export const mapped = Stream.map(Stream.make(1), value => value + 1)
    export effect function collect() {
      return try Stream.runCollect(mapped)
    }
    ```

    **Effect TS:**

    ```ts
    import { Effect, Option, Stream } from "effect"
    export const optional = Option.map(Option.some(1), value => value + 1)
    export const mapped = Stream.map(Stream.make(1), value => value + 1)
    export function collect() {
      return Effect.gen(function* () { return yield* Stream.runCollect(mapped) })
    }
    ```

    Classify the actual legacy operation by resolved identity and the admitted source form, not a member's spelling alone. Ordinary TypeScript methods, including array and user-defined `map`, remain ordinary calls; accepted VIP forms and inherited TypeScript/TC39 syntax are not retired merely because an old inventory labels them legacy. Reconcile a stale inventory with the current accepted source instead of inventing a new ban. The oracle supplies the census; current VIPs and this ruling supply authority. Do not revive retired D-numbers as normative rules or add a compatibility parser exception.

    Migration preserves receiver/argument evaluation, captures, call-versus-run phase, coldness, success/error/environment channels, public declarations and original assertion/coverage contracts. For genuine old source whose behavior cannot yet be preserved, apply existing274's explicit refusal/guard policy and retain a safe TypeScript boundary or prior qualified SDK; do not silently apply a lossy rewrite or call a failed baseline green. This is no general permission to edit protected target tests. Migrate corpus through the owning workflow, retaining minimized old-source migration/rejection witnesses and current positive controls rather than deleting coverage or weakening budgets. Record intended forms-table moves individually with the ruling as their reason.

    Remove pre-VIP decision text from normative chapters as directed; retain D-number references only as history and receipt provenance. The recorded actual Will quote establishes the no-relics principle; effectscript-11's explicit application closes the former external `legacy-forms` question2 about Option/Stream methods. This is an agent application of the recorded ruling, not an invented literal option selection by Will, a timed default, or a completed compiler/codemod rollout.

    Decided by the agent from Will's recorded first-principles/no-relics ruling and existing213/274/277, 2026-11-03 under the 2026-10-29 delegation. Class A; no new syntax, package API or Will question. Regression/property coverage must prove old-form migration and rejection, native counterparts, aliases/shadowing and same-spelling ordinary methods, phases/channels/declarations and retained corpus. This lane records policy only and ran no compiler, migration or product test for this ruling.
