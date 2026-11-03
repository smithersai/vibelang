# VIP-18: running Effects concurrently: `try.all`, `try.race`, `try.any`, `try.allSettled`

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
const [u, o] = try.all [fetchUser(id), fetchOrders(id)]  // yield* Effect.all([…], { concurrency: "unbounded" })
const fast   = try.race [primary(), mirror()]            // yield* Effect.raceAllFirst([…])   first to finish
const ok     = try.any [primary(), mirror()]             // yield* Effect.raceAll([…])        first to succeed
const rs     = try.allSettled [a(), b()]                 // yield* Effect.all([…].map(Effect.exit), { concurrency: "unbounded" })
```

- These are TC39's await operations, run with `try` (VIP-5) instead of `await`. Each is exact sugar for an Effect function.
- The names keep JavaScript's meanings: `try.all` runs everything at once, like `Promise.all`, even though `Effect.all` defaults to one at a time. `try.race` gives the first to finish, and `try.any` the first to succeed.
- **Amended 2026-10-29:** `try.allSettled` gives each element's `Exit` (success, failure, defect or interruption), and the whole never fails, as `Promise.allSettled` never rejects. Recorded under Will's standing approval of recommendations.
- They use the same `keyword.name` shape as VIP-17's `fork.in`.
- **Amended 2026-10-29: operands are arrays.** An object of Effects uses the `all` global: `try all({ u: fetchUser(id), o: fetchOrders(id) }, { concurrency: "unbounded" })`. An object form of `try.all` can be added later without breaking anything. Recorded under Will's standing approval of recommendations.
- **Amended 2026-10-29: the `try.allSettled` counterpart for an array literal.** The comment above writes `[…].map(Effect.exit)`, which is a TypeScript error when the elements differ in type. For an array literal the counterpart wraps each element, `Effect.all([Effect.exit(a()), Effect.exit(b())], { concurrency: "unbounded" })`, which gives the same `Exit` and keeps the tuple type; any other operand uses `xs.map(Effect.exit)`. Erratum to the comment, following the TypeScript counterpart (Will: VibeLang mirrors the TypeScript counterpart where a VIP is silent).
- **Ambiguity: none.** `try` is a reserved word, so `try.` can't start anything else.

- **Amended 2026-10-30: shared static rules.** `try.all`, `try.race`, `try.any` and `try.allSettled` all run Effects under VIP-5: outside effect code they receive `EK0501`. Each takes an array of Effects under the operand rule; an invalid operand receives `EK1801`. These are the existing context and operand checks for the complete family, not new accepted contexts or operand forms.
- **Amended 2026-10-31: spreads in a `try.allSettled` literal.** A literal containing a spread is evaluated once, in native element order, with each spread using its value's own iterator; the counterpart wraps that array by index (`source.map(Effect.exit)`) and adds no iteration of a compiler-created array, so a changed `Array.prototype[Symbol.iterator]` sees exactly the calls native `[a(), ...xs, b()]` makes. Literal tuple typing, spread-as-array typing and the non-literal heterogeneous-tuple rule are unchanged. Decided by the agent on 2026-10-31 from the exact-sugar contract (decided detail 252; loop round 5 OPUS-3 and ASTRA-2).

## History

About 37 findings over rounds 2 to 11, about when elements are evaluated and about `do` elements. VIP-1, VIP-2 and VIP-5 removed both, and none apply to this design.

## Prior art

`Promise.all`, `race`, `any` and `allSettled`; TC39's await-operations proposal.

## Will's words

> "this is a yes"

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. Principles are numbered as in [the introduction's Details](../src/000-intro.md#details).

### Detail 288

**Stream iteration, concurrent iteration and `try.all` use ordinary assignability to their named operand domains.** (R10 Opus OPUS-4; accepted VIP-18/19/20, chapter002's operand-test rule, existing88/89/104/266; principles2/4.) Check `for try` against `Stream.Stream<any,any,any>` (`EK2004`), `for concurrent` against `Iterable<unknown>` (`EK1901`), and the general `try.all` operand against `ReadonlyArray<Effect.Effect<any,any,any>>` (`EK1801`). These are the source-operand tests, not a nominal constructor test, a spelling test or a test that arbitrarily excludes the bottom type.

    TypeScript assignability admits `any` and `never` and checks aliases, readonly arrays/tuples and unions normally. `unknown` and a union containing `undefined` are rejected when not assignable to the stated domain. A `never` expression has no runtime witness; admitting its type neither invents a value nor guarantees runtime safety for `any`. Keep ordinary definite-assignment/native diagnostics, existing literal-element/spread checking and execution-context rules. There is no implicit conversion from an AsyncIterable to a Stream.

    ```vibe
    effect function bottom(programs: never) { return try.all programs } // operand type admitted
    effect function invalid(items: unknown) {
      for try (const item of items) {} // EK2004
    }
    ```

    Effect TypeScript counterpart: the corresponding parameter domains are `Stream.runForEach`'s Stream, `Effect.forEach`'s iterable and `Effect.all`'s readonly array of programs for this form. A stock TypeScript assignment to those three explicit types provides the static oracle. This does not replace VibeLang's existing loop, concurrency, closing or completion semantics. In particular the current compiler's `EK1801` for `try.all` with `never` is an implementation gap, not permission to contradict002's stated bottom-type rule.

    Publish the three diagnostic rows and the002 explanation, with VIP-18/19/20 companion amendments where needed. Use per-code spec-quoted fuzz matrices over `any`/`never`/`unknown`, valid aliases, structural subtypes, optional unions, readonly tuples, collection elements and nested execution contexts. Retain keyed pending compiler gaps and native negative controls; no test was run by this lane.

    Decided by the agent from principle2 (TypeScript assignability), principle4 (the existing named operand test rather than three exceptions), accepted VIP-18/19/20 and the existing002 `any`/`never` statement, 2026-11-01, under Will's 2026-10-29 delegation. Class A.
