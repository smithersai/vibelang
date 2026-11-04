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

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


The part of D127 and D309 under which an omitted slot was inferred on a function with a body.

- **Amended 2026-11-01: the retired bare global alias.** The language's shorthand `A!E!R` expands to `Effect.Effect<A, E, R>`; no normative global `Effect<A, E, R>` alias exists. While the legacy prelude alias is accepted, a use resolving to that alias reports migration warning `EK4856`. The quick fix and `--fix` write `A!E!R` where it means the same type in that position without new parentheses, and `Effect.Effect<A, E, R>` through the real `Effect` namespace binding everywhere else: `Effect<number>` becomes `number!!`, while `Effect<A | B, E>`, `Effect<A, E>[]` and an `extends` or `implements` heritage element get the qualified form. Existing parentheses and written default slots stay; where the namespace binding cannot be kept, the fix is refused. Emitted declarations already print `Effect.Effect<…>` and do not change (decided detail 260, 2026-11-02). Imported or local types named `Effect` retain their ordinary meanings. Remove the alias only in a coordinated compiler/codemod/docs release; thereafter a namespace-as-type use is TypeScript's `TS2709`, and an absent binding follows native name resolution.


- **Amended 2026-11-03: written `infer` slots retire.** An annotation means what the same annotation means on the equivalent Effect TypeScript: `A!E!R` is `Effect.Effect<A, E, R>`, and omitted slots are `never`. There is no one-slot inference form. Ordinary conditional-type `infer` remains as in TypeScript. Migration error `EK4857` replaces a legacy written `infer` slot with the checker's inferred type, or removes an effect function's whole annotation when all slots are `infer`, preserving declaration types under VIP-34's safe-fix checks. For the same written `infer` occurrence in a recognized legacy Effect return slot, `EK4857` replaces `TS1338` while this migration exists, following VIP-34's specific-diagnostic rule; independent native errors remain. Valid conditional-type inference and native `infer` outside the migration keep TypeScript's rules and diagnostics. After retirement, `TS1338` remains wherever TypeScript rejects that occurrence. New source omits the annotation to infer its type. This follows Will's 2026-11-02 ruling: "Effect syntax is just syntax sugar. Anything you can do with the normal syntax you would ideally be able to do with the shorthand syntax."
