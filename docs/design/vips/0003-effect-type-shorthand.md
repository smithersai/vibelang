# VIP-3: `A!E!R` is an alias for `Effect<A, E, R>`

**Status:** accepted by Will, 2026-10-28.

## Decision

| Written | Means exactly |
| --- | --- |
| `User!NotFound!Users` | `Effect<User, NotFound, Users>` |
| `User!NotFound` | `Effect<User, NotFound>`, that is `Effect<User, NotFound, never>` |
| `User!!Users` | `Effect<User, never, Users>` |
| `User!!` | `Effect<User>`, that is `Effect<User, never, never>` |

```ts
effect function load(id): User!NotFound!Users { … }
interface Users { find(id: string): User!NotFound }
```

- `A!E!R` is a type alias, nothing more. It means exactly what `Effect<A, E, R>` means wherever a type can be written, and it behaves exactly the same.
- An omitted slot is `never`, as Effect's own defaults make it. The meaning never depends on where the type is written. In particular, an omitted slot is never inferred, so `User!NotFound` means `Effect<User, NotFound, never>` even on a function with a body.
- To have the type inferred, leave out the annotation (VIP-1).
- **Amended 2026-10-29: `!` beside other type operators.** `!` does not mix with `|`, `&`, function types or conditional types without parentheses: `type T = A | B!E` is a syntax error with a quick fix that parenthesizes, to `(A | B)!E` (`Effect.Effect<A | B, E>`) or `A | (B!E)` (`A | Effect.Effect<B, E>`). Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 47).
- **Amended 2026-10-29: function-type returns.** `(id: string) => User!NotFound` is `(id: string) => (User!NotFound)`, as `() => A | B` is `() => (A | B)`; likewise for constructor types. `!` still does not mix with `|` or `&`, and a conditional type's parts still need parentheses. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 80).
- **Amended 2026-10-30: a line break ends an Effect type.** Each `!`, and the slot after it, start on the line where the previous slot ends; a slot in parentheses may span lines. TypeScript stops its postfix type operators at a preceding line break, and a slot has no closing token, so `now(): number!!` then `later(): number!!` stay two members and a `!` with no slot on its line is TS17019. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later".

- **Amended 2026-10-30: migration warning.** The transitional compiler reports `EK4853` when `--fix` can preserve requirements that the retired omitted-slot rule inferred by writing them explicitly. An omitted slot still means `never`; omitting the whole return annotation instead infers the complete contract. The warning retains its emitted compatibility code until a coordinated compiler/documentation renumber.

## Amendment: ordinary source operand boundaries

An Effect slot accepts ordinary TypeScript source types at the type-operator level. At the optional slot after `!!`, prefer the present `R` when those same-line tokens start such an operand, retaining the existing exclusion of an unparenthesized `{`. Negative literal types remain admitted: `number!!-1` means `Effect.Effect<number, never, -1>`, and `x as number!! - 1` consumes that requirement. Parenthesize the whole assertion, `(x as number!!) - 1`, to select subtraction; its operands still receive ordinary TypeScript checking. This is syntax-based, independent of symbol lookup and spacing. Parser-only JSDoc forms (`?T`, `T?`, `!T`, `*`) are not source type operands, even inside parentheses: `?` and `*` at an optional-slot boundary remain expression operators where admitted, while an additional `!` follows the existing bang/non-null rules. Existing line-break and type-operator restrictions remain.

- **Amended 2026-10-30: surrounding type and expression punctuation.** Only optional `R` after `!!` excludes an unparenthesized object type; required slots admit it. An optional tuple element marks the completed Effect type, keeping omission and indexed `undefined`. At the optional-`R` boundary, `<` continues a comparison and `[` starts a tuple requirement; a generic function requirement needs parentheses. Existing `as`/`satisfies` expression continuations and contextual type aliases keep their ordinary roles. Prefer present `R` between complete source parses, with no symbol lookup; a recovery tree that strands the rest of the expression does not compete. A complete parse includes TypeScript’s automatic semicolon insertion: `x as A!!as` at the end of a line, then `B` on the next, is two statements with `R = as`, while `x as A!! as B` on one line is one chained assertion. [Appendix A](../src/900-appendices.md#effectoperand) states these boundaries and their checked examples.

## Prior art

Zig's error unions write `NotFound!User`, error first. VibeLang writes the success type first because `Effect<A, E, R>` lists it first.

## Will's words

> "Keep it but get rid of that complexity where we can infer R. It's simply an alias for Effect<...> and should work the exact same as if we wrote it the long form way"

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 47

(NW 7; VIP-3) `!` does not mix with `|`, `&`, function types or conditional types without parentheses: each such type is a syntax error with a quick fix that parenthesizes.
    ```vibe
    type T = A | B!E       // syntax error
    type U = (A | B)!E     // ok
    type V = A | (B!E)     // ok
    ```
    Effect TS: `Effect.Effect<A | B, E>` and `A | Effect.Effect<B, E>`. Decided by the agent from principle 8 (either binding can be chosen later without breaking code); 2026-10-29.

### Detail 260

**A bare `Effect<A, E, R>` type is not a VibeLang form: write `A!E!R` or `Effect.Effect<A, E, R>`; the transitional compiler reports migration warning `EK4856` with a `--fix` rewrite.** (ifix-svc-r4 row 46, held "needs Will"; fix-vip-globals' reading of VIP-3; chapter 000 "and nothing more"; VIP-3's own expansions `Effect.Effect<A | B, E>`; VIP-14; VIP-34 migration warnings as in VIP-3 `EK4853` and VIP-9 `EK4854`/`EK4855`; principles 1, 2 and 7.) VIP-14 puts Effect's modules in scope exactly as `import { Effect, Stream, Schema } from "effect"` would, and in Effect TypeScript the bare name `Effect` is a namespace: `Effect<number>` as a type is TypeScript's own error (`TS2709`, cannot use namespace as a type). VIP-3 names the language's alias `A!E!R` and expands it to `Effect.Effect<…>`; its table's `Effect<User, NotFound, Users>` is prose for that expansion, not a second global alias. No VIP declares a global type `Effect<A, E, R>`, so the old prelude's alias that today's compiler still provides (`export let x: Effect<number>` compiles without an import) is outside the language. Rule: in `.vibe` the type `Effect<…>` means what TypeScript says given what is in scope; a local or imported `Effect` type wins as always, and the in-scope module alone gives the TypeScript error. Transition: while the compiler still accepts the bare alias it reports `EK4856` (warning, VIP-34 migration block, next free after `EK4855`) on each use, with a quick fix to the `A!E!R` spelling (`Effect.Effect<A, E, R>` where `!` cannot be written without parentheses the user rejects); `--fix` applies it; the alias is removed in a coordinated release, after which `effectModules: false` needs an import, as TypeScript requires. Declaration output already prints `Effect.Effect<…>`, so emitted `.d.vibe.ts` files do not change.

    ```vibe
    export let a: Effect<number>            // EK4856: write number!!
    export let b: number!!                  // VIP-3
    export let c: Effect.Effect<number>     // VIP-14: the module in scope, as after import { Effect } from "effect"
    ```

    Effect TS: `let b: Effect.Effect<number>`; a bare `Effect<number>` after `import { Effect } from "effect"` is `TS2709`.

    This changes no accepted program today (a warning with a mechanical fix), so it is not a breaking change needing Will; the later removal follows the same coordinated release rule VIP-3's `EK4853` amendment states. Fixers add the warning with its quick fix, a `--fix` idempotence case, a compiler case that `effectModules: false` plus an explicit `import type { Effect } from "effect"` keeps `Effect.Effect<…>` working, and a keyed fuzz mutation over type positions (annotation, alias, generic argument, return type, `!` slot) for the rewrite. Decided by the agent from chapter 000's authority rule, VIP-3's own `Effect.Effect` expansions, VIP-14's import-equivalence, principle 1 (idiomatic Effect writes `Effect.Effect` or VibeLang's `!`), principle 2 (TypeScript's namespace-as-type error) and principle 7, 2026-10-31. Class A; no Will question.


    **260 deterministic repair trigger, decide-live, 2026-11-02 (round15 OPUS-3).** Choose the shorthand only when it represents the same resolved legacy Effect type in its actual enclosing source position without introducing new parentheses. Otherwise keep that position and write the corresponding qualified `Effect.Effect<A, E, R>` through its real namespace binding. This is a grammar/grouping test, not an interface-only list or a new per-site user preference. It covers both `extends` and `implements` heritage elements and nested type operators that would need new grouping. Preserve any existing explicit grouping, argument defaults and type meaning; an imported/local type named `Effect` is not the retired alias and receives no such repair. If required namespace identity cannot be preserved, refuse safely under277.

    ```vibe
    type Basic = number!!
    interface Parent extends Effect.Effect<number> {}
    type Items = Effect.Effect<string | number, Error>[]
    // Heritage and the array-of-Effect type keep the qualified spelling.
    ```

    Effect TS: `type Basic = Effect.Effect<number>; interface Parent extends Effect.Effect<number> {}; type Items = Effect.Effect<string | number, Error>[];` with the ordinary Effect namespace import. These examples concern type positions, not a promise that an arbitrary empty class implements the Effect protocol. “Declarations remain qualified” means emitted native/public and compatibility declarations retain their required Effect TypeScript spelling and277 contract; it does not prohibit shorthand in authored type aliases or other source declarations. Approved263 native module-specifier changes remain independent.

    This makes the existing260 phrase “where ! cannot be written without parentheses the user rejects” deterministic under principle4; it changes no accepted source type or public contract. VIP-3, chapter007's EK4856 text and their tests must publish the same trigger, with source/emitted declarations distinguished. Owners retain failing-main regression and keyed coverage for annotations, aliases, generic arguments, slots, union/intersection/conditional/function/array positions, heritage, existing parentheses, local/imported Effect shadows, globals disabled, idempotence and declaration bytes. No new compiler/native test was run by this lane. Decided by the agent from existing260/277, accepted VIP-3, principles2/3/4/8 and the recorded no-new-parentheses policy, 2026-11-02 under the 2026-10-29 delegation. No new numbered decision or Will question.

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


The part of D127 and D309 under which an omitted slot was inferred on a function with a body.

- **Amended 2026-11-01: the retired bare global alias.** The language's shorthand `A!E!R` expands to `Effect.Effect<A, E, R>`; no normative global `Effect<A, E, R>` alias exists. While the legacy prelude alias is accepted, a use resolving to that alias reports migration warning `EK4856`. The quick fix and `--fix` write the shorthand, or `Effect.Effect<A, E, R>` in an interface heritage element, preserving grouping, defaults and declarations. Imported or local types named `Effect` retain their ordinary meanings. Remove the alias only in a coordinated compiler/codemod/docs release; thereafter a namespace-as-type use is TypeScript's `TS2709`, and an absent binding follows native name resolution.
