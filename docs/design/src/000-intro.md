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

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

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

### Detail 244

**`EK0801` (`using` in effect code) is a VIP-34 TypeScript-form warning; a denied VIP carries no rule.** (spec-fix-a `000-denied-vip-rule-authority`, found 2026-10-31 on main 1d56b687ec64; details 13/60/77/213; VIP-34; VIP-8 denied 2026-10-28.) The rule of detail 13 stands unchanged: `using` in effect code gets a warning, because the resource leaks on a failure or interruption, with the quick fix `acquireDisposable` inside `scoped`; `using` keeps the TypeScript meaning. Only its public home moves: record it as an amendment of VIP-34, the twelfth entry of the TypeScript-form warnings list (a legal TypeScript form with an Effect idiom to teach and a quick fix, like the `EK48xx` rows), and cite VIP-34 in the Appendix B row. The code stays `EK0801` under the detail 60 unchanged-code exception, stated beside the `EK48` exceptions in Appendix B. VIP-8 keeps its denial and its 2026-10-29 amendment text, which now points to the VIP-34 amendment as the authority. The 000 authority sentence is unchanged: option B (an amendment to a denied VIP may add a diagnostic) would add an exception to the authority rule for one row. Not VIP-38: detail 77 gives imported Effect lint rules `EK38xx` codes and tsconfig-style configuration, and this warning is a VibeLang effect-code rule. The 007 `vibe.severities` example keeps `EK0801`. No program changes meaning or severity.
    ```vibe
    effect function readAll(path: string) {
      using file = openSync(path)   // EK0801 warning (VIP-34): leaks if the Effect fails or is interrupted
      return file.readAll()
    }
    effect function readAllSafe(path: string) {
      return try scoped(effect {
        const file = try acquireDisposable(() => openSync(path))
        return file.readAll()
      })
    }
    ```
    Effect TS: `readAll` is `Effect.gen(function* () { using file = openSync(path); return file.readAll() })`, the form the VIP-8 amendment records as leaking on a failure or interruption; `readAllSafe` is `Effect.scoped(Effect.gen(function* () { const file = yield* Effect.acquireDisposable(() => openSync(path)); return file.readAll() }))`, whose finalizer runs on every exit (Effect 4.1.0). Decided by the agent from principle 4 (one authority rule, no per-row exception), detail 213 (public rules live in accepted VIPs and their public amendments), detail 60 (a code keeps its number when the home of its rule moves) and detail 13 (the rule itself, unchanged), 2026-10-31. spec-fix-a writes the VIP-34 amendment, the row VIP column, the Appendix B exception sentence and the VIP-8 pointer.

### Detail 267

**Plain functions have JavaScript's stack limit; stack-safe recursion is written as `effect`.** (spec agent, 2026-11-01, from VIP-1 and VIP-4; raised by platform during the VIP-1 plain-functions flip; not a Will question.) VIP-1 makes a plain function plain JavaScript, so deep plain recursion overflows as in JavaScript: a `RangeError` that is an implicit throw, untracked and a defect in effect code (VIP-4: "Implicit throws, such as reading a property of `undefined` or a stack overflow, are not tracked"). An `effect` function's recursion runs on the Effect runtime and is stack-safe. Before the flip, plain recursive functions were inferred as effect code and were stack-safe by accident; nothing promised it. Spec text, chapter 1 (or 8): "Plain functions have JavaScript's stack limit; recursion that must be stack-safe is written as an `effect` function." Cases: a 100,000-deep `effect function` recursion succeeds; a plain twin documents the limit (expects `RangeError`, not a guarantee).
    ```vibe
    function depth(n: number): number { return n === 0 ? 0 : 1 + depth(n - 1) }                // depth(100_000): RangeError, as in JavaScript
    effect function depthE(n: number): number!! { return n === 0 ? 0 : 1 + try depthE(n - 1) } // succeeds with 100000
    ```

### Detail 304

**`do` lowering preserves TypeScript's source-branch flow facts.** (RC-38 `002:do-short-circuit-loses-narrowing`; accepted VIP-2, native plain-function guarantee and principle2.) A `do` body in a short-circuit operand is checked with the ordinary TypeScript narrowing supplied by the original source guard in that branch. A synthesized writable result/completion temporary must not sever the guard's relation to the source variable. Keep guard evaluation once, source short-circuit/side-effect order, native result types and the actual invalidation of a narrowing after source writes. Each operator retains its own native branch facts; this grants no extra non-nullability for a nullish-coalescing RHS.

    ```vibe
    export function probe(x: { n: number } | undefined): number | undefined {
      return x && do { x.n }
    }
    export function invalid(x: { n: number } | undefined) {
      return x && do { x = undefined; x.n } // retains the native error
    }
    ```

    Effect TS: these remain ordinary TypeScript functions; the valid no-jump counterpart is `export function probe(x: { n: number } | undefined): number | undefined { return x && (() => x.n)() }`. TypeScript5.9.3 accepts it. The invalidating-assignment counterpart still rejects the property read. An illustrative immediate arrow is not a general lowering recipe: retain source callable bindings, outward jumps and any admitted suspension. Do not require an assertion, annotation, different target source or weakened strictness to recover an originally valid guard.

    Reviewer pass126 reports six falsely rejected guard shapes on `fe7b802fbf05`: truthiness, null check, positive/negative `typeof`, discriminant and const guard alias; their native counterparts accept and older `509a2110` controls agree. Explicit ternary, surrounding `if` and inside-`do` guard controls accept; unguarded/invalidated accesses retain real `TS18048`. Its28 compiler calls include17 accepts and11 rejections (seven current false rejections including the duplicate initial witness, four intentional negative-control rejections). Fifteen runtime calls cover accepted programs only. These are attributed receipts, not this lane's Vibe/compiler execution, implementation or a full-suite claim. RC10's inference cycle and contextual-literal reports remain distinct.

    Chapter002/impl-hunt-run, core-block and checker owners retain a failing-main regression and keyed spec-quoted fuzz/property neighbourhood: both branch outcomes, truth/type/discriminant/alias guards, nested logical/nullish forms, effectful guard evaluation once, source mutation invalidation, valid ordinary/conditional controls and real unsafe-access rejection. Preserve the actual source flow rather than suppressing diagnostic codes. No new diagnostic or public package API. Decided by the agent from principle2 (mirror TypeScript), accepted VIP-2 and `000-intro.md`/`002-running.md`'s native flow/conditional-evaluation guarantee, 2026-11-02 under the 2026-10-29 delegation. Class A; no Will question.

    Sources: `loop/scoped/rev-compiler/FINDINGS.md` pass126; `pass126-narrow.json`, `pass126-narrow-matrix.json` and source/config controls.
