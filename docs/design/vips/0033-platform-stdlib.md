# VIP-33: the platform standard library

**Status:** accepted, 2026-10-29: Will's 10-26 rulings, re-presented against VIP-1 to VIP-32 and recorded under his standing approval of recommendations.

## Decision

```ts
import { NodeServices } from "@effect/platform-node"   // a platform package: imported, not in scope
effect function readConfig(path: string) {
  const fs = try FileSystem.FileSystem             // Effect's platform service, injected by a layer
  return try fs.readFileString(path)
}
effect function main() {
  provide NodeServices.layer { try readConfig("app.json") }   // VIP-12; the platform layer is chosen at the edge
}
```

1. **Platform access only through injected Effect services** (`FileSystem`, `Path`, `ChildProcess`, `HttpClient`, …), each provided by a per-platform layer. A `.vibe` file has no `node:*` value imports and no Node globals (`process`, `Buffer`). Code that needs them lives in a `.ts` file; VIP-25 removed inline modules, so a `.ts` file is the escape.
   - **Amended 2026-10-29: no exception inside `Effect.try` / `tryPromise` arrows.** A platform call there, such as `tryPromise(() => fetch(url))`, is the same error as anywhere in `.vibe`. Its quick fix and the codemod move the body into a sibling `.ts` module, or point to the Effect service (`HttpClient` for `fetch`). Recorded under Will's standing approval of recommendations.
2. **What Effect lacks goes under `Experimental.X`**, named after the Effect module it extends, and is written so it can be proposed upstream. No per-project wrappers, and nothing that Effect already provides.
3. **Subpath namespaces are in scope** (`HttpClient`, `FileSystem`, `Path`, `ChildProcess`, … from Effect's subpath packages), with VIP-14's precedence rules.
4. Old VibeLang's alias `Path.join(…)` → `Path.Path.join(…)` (D311) was a service shorthand, which VIP-10 denied. You write `(try Path.Path).join(…)`.
5. Old VibeLang's provisional D312, under which the entry provided NodeServices for `main`, is gone (VIP-26).

*Corrected 2026-11-02: the Decision example imports `NodeServices` from `@effect/platform-node`, a platform package that is not in scope (VIP-14), and provides it inside `effect function main()`, because `provide` belongs in effect code (VIP-12); chapter 5 shows the same program (found by the round-6 review).*

*Corrected 2026-10-29: the module `FileSystem` is a namespace, and the service key it exports is `FileSystem.FileSystem` (likewise `Path.Path`); in effect 4.1.0, `yield*` of the namespace is a defect.*

- **Amended 2026-10-29: the banned globals.** A reference in any `.vibe` code to a Node global (`process`, `Buffer`, `global`, `__dirname`, `__filename`, `require`, `module`, `exports`, `setImmediate`, `clearImmediate`), a web I/O or host-state global (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `navigator`, `location`, `document`, `window`, `self`, `Worker`, `SharedWorker`, `BroadcastChannel`, `postMessage`, `alert`, `confirm`, `prompt`, `crypto`, `performance`), `console` or a timer (`setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask`) is a compile error whose quick fix names the Effect service or moves the code to a `.ts` file. ECMAScript library globals (including `Intl`) and web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`) stay allowed. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 56).
- **Amended 2026-10-29: the banned globals are derived, not listed.** A value reference in `.vibe` code is `EK4402` when the symbol it resolves to is declared in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, not in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist. A local binding, an import or an Effect module in scope shadows the global first. The allowlist is closed: the web data utilities above plus `AbortSignal`, which Effect passes to `Effect.tryPromise` callbacks; `AbortSignal.timeout` stays banned. The set is generated into `docs/design/inventory/platform-globals.json`. This replaces the enumerated list above, whose names keep their quick fixes. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 101).
- **Amended 2026-10-29: `globalThis` and `import()`.** `globalThis` may appear in `.vibe` code only as the object of a statically named member access. A banned platform member is `EK4402`; `eval` and `Function` follow [VIP-1](0001-effect-and-async-functions.md), including its `Function` exemptions for the right operand of `instanceof` and a statically named `prototype` access. Every other use of `globalThis` is `EK0107`. `import(expr)` with a computed specifier stays unchecked; a string-literal `data:` or `blob:` specifier is `EK0107`. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 73 and 74).
- **Amended 2026-10-29: bare `Worker`.** Bare `Worker` is Effect's `effect/workers` namespace, as `Headers`, `Response` and `Event` are Effect's; the banned `Worker` entry covers the host binding only (`globalThis.Worker`, `self.Worker`). Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 76).
- **Amended 2026-10-29: `import.meta` is limited to `import.meta.url`.** In `.vibe` code `import.meta` may appear only as the object of `.url`. Every other member (`dirname`, `filename`, `env`, `main`, `resolve`, host additions) and every other use of `import.meta` (an alias, destructuring, a computed key, an argument, a spread) is `EK4402`; a type position is TypeScript's. The quick fix names the Effect service (`Path`, `Config.String`) or moves the code to a `.ts` file. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 90).
- **Amended 2026-10-30: one rule for platform members.** `EK4402` asks one question of a statically named value, an identifier, `.name`, `?.name`, a literal key or a destructured property: does the symbol it resolves to reach the platform, by doing I/O, starting a timer, or reading or changing host state? That is a banned global, or a member of an allowlisted global that reaches the host: `AbortSignal.timeout`, `URL.createObjectURL` and `URL.revokeObjectURL`. An alias keeps the symbol, and a key that is not statically known stays unchecked. A name that resolves to nothing is `TS2304`. `docs/design/inventory/platform-globals.json` records the banned globals, the allowlist and every allowlisted member, classified, and a test fails when one is unclassified. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later"; `URL.createObjectURL` and `URL.revokeObjectURL` follow from this VIP's "All web apis and all node.js apis should be wrapped and effectful", and no `.vibe` file in the repository uses them.

## Will's words (2026-10-26)

> "All web apis and all node.js apis should be wrapped and effectful. In fact, a lot of this is ALREADY wrapped and effectful. Platform should always be dependency injected. Effect has a platform package. If it doesn't support something we should extend it to support it."

> "Make sure you do NOT implement anything that is already in effect."

> "make Effect namespace global and every namespace below Effect global and if we were forced to add something because Effect doesn't already have a namespace for it it should be under Experimental."

> "Node.js should only even be available via dependency injection or via escaping to normal typescript"

- **Amended 2026-11-01: fresh platform companion.** The platform codemod may create a new owned sibling `.ts` companion only when it preserves run phase, captures, receiver and public types. It never overwrites or edits an existing foreign file; a collision or unavailable preservation proof gives the not-fixed explanation. This is VIP-34's only exception allowing creation of a foreign-source companion.

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 56

(NW 19; VIP-33) Will's rule (2026-10-26): "All web apis and all node.js apis should be wrapped and effectful." A reference in any `.vibe` code to one of these globals is a compile error whose quick fix names the Effect service or moves the code to a `.ts` file:
    - Node: `process`, `Buffer`, `global`, `__dirname`, `__filename`, `require`, `module`, `exports`, `setImmediate`, `clearImmediate`;
    - web I/O and host state: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `navigator`, `location`, `document`, `window`, `self`, `Worker`, `SharedWorker`, `BroadcastChannel`, `postMessage`, `alert`, `confirm`, `prompt`, `crypto`, `performance`;
    - console and timers: `console`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask`.

    ECMAScript globals (`Date.now`, `Math.random`, `JSON`, `Intl`; `Intl` is ECMA-402) and pure web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`) stay allowed. The spec's `effect { console.log("hi") }` example becomes `effect { try Console.log("hi") }`, and decided detail 4's `setTimeout` sentence moves to Appendix E's `.ts` guidance.
    ```vibe
    console.log("hi")             // error: write try Console.log("hi")
    setTimeout(f, 10)             // error: write try Effect.sleep("10 millis") then f()
    const u = new URL(s)          // ok
    ```
    Effect TS: `Console.log("hi")`, `Effect.sleep("10 millis")`, `HttpClient` for `fetch`, `Clock` for `performance.now`, `Random` for `crypto.getRandomValues`. Decided by the agent from Will's VIP-33 words and principle 8; at most 16 of 1138 `.vibe` files in the repository (7 use `console`, 9 a timer) and need the quick fix; 2026-10-29.

### Detail 73

**`globalThis` is usable only as the object of a statically named member access** (NW 43; Opus M5 and M2; r16-001; amends 30a and 33). In `.vibe` code `globalThis` may appear only as the object of `.name`, `?.name`, `["name"]` or `` [`name`] `` (a string literal or a template with no substitutions). The member must not be `eval` or `Function` (`EK0107`) or a banned platform global (`EK4402`, detail 56). Any other use is `EK0107`: a computed key that is not such a literal, an alias (`const g = globalThis`), destructuring (`const { eval: e } = globalThis`), an argument (`Reflect.get(globalThis, k)`, `Object.keys(globalThis)`), a spread, the right operand of `in`, or `globalThis.globalThis` used as anything but a further static member object. Types are unaffected (`typeof globalThis` in a type position is TypeScript's). The quick fix moves the code to a `.ts` file.
    Public VIP33 reconciliation landed as c080051ae52b from439c77582723 (spec-fix-c; globalThis platform code and VIP1 Function exemptions only).
    ```vibe
    globalThis.structuredClone(v)       // ok: statically named, not banned
    globalThis["URL"]                   // ok
    globalThis.eval(s)                  // EK0107 (30a: indirect eval)
    globalThis["Function"]("return 1")  // EK0107
    globalThis.fetch(url)               // EK4402 (detail 56)
    globalThis[k](s)                    // EK0107: key not statically known
    const g = globalThis                // EK0107: alias
    const { eval: e } = globalThis      // EK0107: destructuring
    "fetch" in globalThis               // EK0107: feature detection lives in .ts
    ```
    Effect TS: none; dynamic global access belongs in a `.ts` module. Decided by the agent from 30a's intent (no code built from strings, which an unchecked `globalThis` access reaches) and principle 8 (a rejected form can be allowed later; a tracked-value analysis cannot be withdrawn); the four round-15 reviewers all recommend rejection; 2026-10-29.

    Later97 qualifies the Function clause: safe `instanceof globalThis.Function` and the permitted static `.prototype` uses follow the same contexts as bare global `Function`. A banned host/platform member is `EK4402`; prohibited `eval`/Function and nonstatic/alias uses retain `EK0107`. Opus28m42 is a public VIP-33 reconciliation under33/73/97/101, not a new ban or exception.

### Detail 201

**`EK4402` asks one question: does the statically named symbol reach the host?** (Amends 101, 154, 162.) A banned global, or a member of an allowlisted global that does I/O, starts a timer, or touches host state: `AbortSignal.timeout`, `URL.createObjectURL`, `URL.revokeObjectURL`. `docs/design/inventory/platform-globals.json` classifies all 50 allowlisted members; an unclassified member fails generation.
    Public VIP33 reconciliation landed as c080051ae52b from439c77582723 (spec-fix-c; globalThis platform code and VIP1 Function exemptions only).
    Status: applied in 12d6a3b9ce5e on main (source/cross-reference revalidated by spec-fix-c; no duplicate patch). Published member inventory and platform-symbol rule agree.
    ```vibe
    URL.createObjectURL(blob)   // EK4402
    ```
    Effect TS: none. Decided by the agent from VIP-33's "All web apis and all node.js apis should be wrapped and effectful", 2026-10-30; no `.vibe` file uses the two `URL` members.

### Detail 251

**`throw` in an `async` VibeLang function rejects its Promise, as in TypeScript.** (Decided 2026-10-31 by effectscript-11, Will's proxy, from Will's own words; not asked of him. Settles the open `async` question in the 2026-10-31 "plain functions never throw" ruling in core-decisions.md.) Will scoped the error explicitly: "If you throw in vibelang itself in a sync function that's an error." On 2026-10-29 he said "we can allow throw and we can allow Promise.reject". So the compile error covers `throw` in sync VibeLang functions only (plain declarations, expressions, arrows, methods, constructors, accessors, plain generators, initializers, plain `catch` handlers); in an `async` function or async arrow or method, `throw` is JavaScript's throw and rejects the returned Promise. An async VibeLang function carries no thrown type (Will: thrown-type tracking exists only for `.ts`/`.js` imports). Effect code that calls it wraps the Promise as for any Promise (`Effect.tryPromise`, or `try` on an Effect built from it), and the rejection reason is `unknown`.
    ```vibe
    async function load(id: string) {
      if (!id) throw new Error("no id")   // allowed: load("") rejects with Error("no id")
      return id
    }
    function check(id: string) {
      if (!id) throw new Error("no id")   // error: a sync VibeLang function can't throw
    }
    ```
    Effect TS: the same native `async function load(id: string) { if (!id) throw new Error("no id"); return id }`; Effect code observes it with `Effect.tryPromise({ try: () => load(""), catch: (error) => error })`. The example uses no platform API; VIP-33 is unchanged. This is nongenerator async Promise behavior. Async-generator APIs keep their separate native construction/resumption phases from detail 108; their call does not itself return a Promise, and parameter execution permissions are unchanged.

### Detail 261

**The proposed browser animation registration API has an Effect boundary; atomic registration needs no plain-host exception.** (exp-browser-foldkit open spec request at 2026-10-31T21:51:47Z and follow-up 2026-11-01T00:31Z; accepted VIP-33 items 1/2, VIP-9 any-member rule, VIP-26 and principles 1, 7 and 8.) For the proposed built-in `Experimental.Animations` capability, expose the check-and-frame-registration operation as an Effect. Perform the pending-commit check and callback registration together in its synchronous native registration function, and install cancellation through the native Effect callback/scoping mechanism. Wrapping that whole atomic operation does not require splitting the check and registration into two separately run Effects. The implementation can use a synchronous helper in its `.ts` platform module; do not advertise that helper as a new plain `.vibe` platform operation or add an exception to VIP-33 merely to migrate a plain rendering loop.

    The concrete proposal `nextFrameUnless(register)` is the recommended operation shape; its final name and callback contract remain runtime implementation work, with the same timing/cancellation and public-API preservation tests as the original minimized pattern. This decision does not standardize an arbitrary callback signature or a second runner. A synchronous renderer requiring an immediate cancel function remains in `.ts` when an Effect-returning rewrite cannot preserve its API. Do not silently convert it to an Effect or Promise, weaken migration identity checks, or change animation timing to raise migration counts.

    ```vibe
    // fragment: proposed Experimental runtime member, not present on audited main
    effect function waitForRender(register: Register) {
      const animations = try Experimental.Animations.Animations
      try animations.nextFrameUnless(register)
    }
    // A plain renderer needing synchronous registration stays in its original .ts module.
    ```

    Effect TS:

    ```ts
    // fragment: the same proposed service contract
    const waitForRender = (register: Register) => Effect.gen(function* () {
      const animations = yield* Experimental.Animations.Animations
      yield* animations.nextFrameUnless(register)
    })
    // Its TypeScript implementation performs check + registration in one Effect.callback
    // registration invocation, with cancellation returned to that native operation.
    ```

    Scope: a disposition of this unlanded standard-library API proposal, not a new language diagnostic or a ban on all plain service members. VIP-9 still permits arbitrary member result types; pure operations and native TypeScript integration retain their existing rules. Foreign `.ts` throwing helpers retain their ordinary contracts and required bridges; no local throw permission, annotation scheme or bridge exemption is introduced. Effect execution stays cold and runs only at an admitted `try` site, exactly as the corresponding Promise is awaited. Missing host APIs remain defects when the operation runs, not when the shared browser layer is constructed.

    Immutable main `3356dd67f804` has no runtime Animations module; the reporting lane identifies the candidate as queued `c38e9f7e898d`, not landed. This policy lane has not inspected or changed that candidate, run the proposed API, or proved native/compiler/framework conformance. The implementation owner retains minimized Foldkit regression and neighbourhood property/fuzz coverage: pending/nonpending commits, no-registration-before-run, same-turn check/register, synchronous callback, cancellation/interruption and missing-host controls, plus the original synchronous renderer/public-declaration control. These are required validation targets, not completed test receipts.

    Decided by the agent from accepted VIP-33 (platform access through Effect services; Experimental only for missing capabilities), principle 1 (one native Effect registration boundary), principle 7 (no syntax for a non-Effect exception) and principle 8 (no new plain-host permission while unsure), 2026-10-31. Class A; no Will question.


    **Bounded native feasibility evidence.** `native-loop-r3/atomic-frame-registration.mjs` passes 35 native Effect 4.1.0 cases: 32 pending/nonpending and synchronous/asynchronous callback schedules, two interruption-cleanup controls and one missing-host defect control. Construction stays cold, queued microtasks do not interleave check and registration inside the native callback, cancellation runs once on interruption, and the missing-host failure occurs only when run. This establishes the feasibility of the single native Effect boundary, not conformance of the queued service, a real browser, VibeLang, source typing, or a delivered fuzz generator. Receipt: `animation-frame-policy-reference.json`.


    **261 existing animation APIs remain a valid implementation route, decide-live, 2026-11-02.** `nextFrameUnless` above is a proposed shape, not a mandatory new public API. An existing `nextFrame` Effect plus already admitted Effect operations may satisfy the migration when the actual original same-turn registration, animation-query order, lifetime after caller interruption, cancellation, runtime outcomes and public declaration contract are preserved. Successful compilation or a deferred-start approximation alone does not prove that. The owner is probing pinned60 and matched31 against the unchanged lifetime oracle and a detecting mutant; no pass, adoption or cleared SDK31 HOLD is claimed yet. This applies the existing Effect boundary and principles1/7/8 while avoiding an unnecessary API addition; it grants no raw platform wrapper or execution-placement exception.

### Detail 275

**VIP-33's specifically authorized move to a fresh sibling `.ts` module is a narrow exception to270's general writable-file set.** (Round7 ASTRA-3 follow-up; accepted VIP-33 Decision1 amendment and chapter005's `EK4402` codemod, VIP-34, existing270/272, principles2/4/8.) Detail270's blanket wording was too broad if read as forbidding the companion file the accepted platform codemod explicitly promises. Keep its default owned-source/config boundary and its ban on rewriting existing foreign/dependency/declaration/generated files. For the VIP-33 move only, a safe fix may create a new owned sibling `.ts` companion and change the selected owned `.vibe`/`.vibex` source to call it. It may not overwrite or rewrite an existing `.ts` sibling, a dependency or another project's file. Choose a fresh noncolliding destination or refuse; do not make an existing foreign file writable merely because it is imported.

    Apply the existing semantic/declaration safe-fix checks to the multi-file proposal. Preserve source call/run phase, captures, receivers, evaluation order, error/defect contracts and public types, with the approved foreign bridge where needed. If that proof or the required scoped file creation cannot be made, give the existing not-fixed explanation and retain the source for manual repair; the platform ban itself is not relaxed. An unsafe direct substitution with an Effect service is likewise not an automatic fix. The new file is a real source module reached by the rewritten import, never a declaration, stub or replacement test oracle. This records the already-approved VIP-33 repair, not arbitrary native-file creation or package-wide permission. Migration setups still obey272: no protected target test, fixture, snapshot or runner edit.

    ```vibe
    // app.vibe after the approved safe move; no host binding remains here
    import { request } from "./requestPlatform.ts"
    export effect function load(url: string) {
      return try tryPromise(() => request(url))
    }
    // New requestPlatform.ts: export const request = (url: string) => fetch(url)
    ```

    Effect TypeScript: `load` returns `Effect.tryPromise(() => request(url))` under the original lexical/run boundary; the sibling is ordinary TypeScript with its native host call. That counterpart is illustrative, not proof that an arbitrary source closure can be moved safely.

    Decided by the agent from accepted VIP-33's explicit quick-fix/codemod promise, VIP-34's safe-fix rule, principle2 (ordinary imported TypeScript module), principle4 (one named exception rather than weakening all foreign-file exclusions) and principle8 (fresh file plus refusal when preservation is unproved), 2026-11-01. Class A; no Will question. Reconcile270 and007/VIP-34 scope with005/VIP-33 in one source change; do not delete the approved platform repair merely to match270. Update the VibeLang-owned fix-scope oracle to distinguish approved new-companion creation from forbidden existing-file writes, with a regression and spec-quoted keyed fuzz over collisions, dependencies, referenced projects, captures, both source extensions, refusal and unchanged protected tests. This lane inspected the accepted texts only; it ran no companion-writer/compiler/codemod/fuzz test and changed no source file.

### Detail 278

**Prove a selector rewrite against the same approved source inventory; disclose a separately authorized companion addition rather than hiding a failed pristine comparison.** (Foldkit website selector question at04:30Z, recorded in the04:27Z input delta; existing272 exact-set addendum and275/VIP-33 authorized native companion, principles2/3/4/8.) A selector change itself must preserve exactly the selected file identities after mapping actual migrated modules back to their original names, with counts and full names, not counts alone. A fresh native helper created by an independently approved behavior-preserving extraction is a source-program change, not an extra file a selector widening may silently admit. Preserve both facts in the proof. Do not report a pristine-to-final comparison as equal when it is not:198 versus199 is a failed equality check even if the additional file has a plausible explanation.

    To compose an approved source extraction with a selector rewrite, record and verify the extraction separately, with its exact new file and unchanged original checks. Establish the source inventory after that approved extraction and before the source-extension/selector change. Compare the original selector and the proposed selector across that same logical inventory, using the actual source-rename mapping; both must select exactly the same identities after mapping back. For filename-only discovery, an explicit inventory with original source suffixes may establish the original selector's selection without rewriting or mocking the test. It is not a runtime/transformer/graph proof: run the real unchanged check on the final implementations too. Preserve the raw pristine comparison, the separately approved source delta, the complete projected before/after sets and their construction in the PR. A control showing that the original selector would also select the new helper supports that separation; it alone is not a replacement for the full inventory and original-check proof.

    This gives no general permission to ignore additions. The new source must be the identified, separately authorized change (here275's native companion), not a declaration sidecar, untracked fixture, stub, new page or unrelated product feature admitted to make the counts pass. Do not choose the “before” inventory after seeing a failing migration merely to hide omissions or broadened coverage. Every original selected identity remains present; every authorized companion is declared separately; any other mismatch remains a failure. If that exact composition or its underlying source-preservation proof cannot be established, retain the affected source as TypeScript under272. A test asserting on source text remains subject to272's fourth-addendum restriction, and graph/transformer semantics need their independent actual checks. No test assertion, selector condition beyond the accepted extension change, fixture, snapshot or comparison oracle is weakened.

    ```vibe
    // fragment: the approved source-only extraction is accounted for separately
    import { buildTree } from "./playgroundFileTree.ts"
    export const page = buildTree()
    // The filename selector compares the same page + approved-helper inventory on both sides.
    ```

    Effect TypeScript: the same imported native helper and ordinary call, at the original evaluation phase. Native TypeScript discovery would already include an added .ts helper under an unchanged matching glob. That file addition is established by the separate approved source repair; the later .ts-to-.vibe spelling change and selector widening must preserve that inventory exactly.

    Decided by the agent from accepted VIP-33/275's specific fresh-companion repair,272's exact selected-set requirement, principle2 (ordinary native source discovery), principle3 (actual identities and original selector semantics), principle4 (compose two independently proved operations rather than add a broad count exception) and principle8 (retain the failure/refuse when either proof is incomplete), 2026-11-01. Class A; no language/API change or new Will question. For the reported Foldkit case, retain the pristine198-versus199 FAIL and the narrower same-head selector PASS as distinct receipts. The proposed199-on-both-sides extraction inventory is a required proof, not a result this lane has run. Existing drive-foldkit-web owns the actual source-list data, unchanged tests, PR disclosure and any source-only extraction receipt; this lane inspected the shared report only, changed no target test/source, and ran no actual selector/VibeLang/compiler/fuzz test. Add owner neighbourhood properties over source rename maps, approved helpers, unapproved additions, sidecars, omissions, duplicate basenames and selectors that inspect more than names; preserve stronger target gates.
