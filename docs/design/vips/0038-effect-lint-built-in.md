# VIP-38: Effect's type-aware lint is built into VibeLang

**Status:** accepted by Will, 2026-10-29.

## Decision

- The Effect language service's type-aware rules (effect-tsgo's `effecttsgo/*` rules) run inside the `vibelang` compiler on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions. VibeLang-specific language checks remain confined to `.vibe`. Both are typescript-go forks, so the rule runner is built in rather than run beside it.
- They run wherever VibeLang reports diagnostics: the CLI, the language server, and a lint command for CI. A repo's existing Effect language-service configuration selects and configures them, so a repo's lint script covers `.vibe` the same way it covers `.ts`.
- Tools that only analyze code (cycle checkers such as madge, and dependency graphs) may run on VibeLang's compiled output. That cannot work for formatters, which must read `.vibe` itself (VIP-34).
- **Amended 2026-10-29: the command.** The lint command is `vibelang lint`. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: lint options.** `vibelang lint` takes the compiler's options (`-p`/`--project` and files) and no others. `vibelang --fix` stays the one codemod entry point. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 58).
- **Amended 2026-10-29: codes for the imported rules.** Each imported `effecttsgo/*` rule gets one stable `EK38xx` code, in a table generated from the pinned effect-tsgo version. Severity resolves from `vibe.severities`, then the repository's Effect language-service configuration, then the rule's default; every `EK38xx` code may be set to any value, `"off"` included. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 77).
- **Amended 2026-10-29: the imported rules are pinned to `@effect/tsgo@0.57.0`.** `typescript/tsc/internal/effecttsgo/UPSTREAM` (tag `@effect/tsgo@0.57.0`, commit `999942fa41462eb46dfcb2d718e7671db8e14156`) is the normative pin; `sync.sh <tag>` is the only update path, and a VIP-32 bump runs it and regenerates the `EK38xx` table, keeping every assigned code. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 98).

- **Amended 2026-10-30: stable imported codes.** The normative [`lint-codes.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/lint-codes.json) is generated from the `UPSTREAM` pin, currently `@effect/tsgo@0.57.0`. Keep `EK3801` for `floatingEffect`; allocate the other initial rule names in ascending ASCII order from ordinal 2. Future new names append in sorted order after the highest reserved ordinal, and removed names keep their slots. Codes use the `EK38` prefix and a minimum-two-digit decimal ordinal: after `EK3899` comes `EK38100`. This amends VIP-34's capacity rule for imported lint without reserving `EK39xx` (decided details 98, 106 and 142).

## Will's words

> "1. The effect ts go should absolutely be built into Vibelang in fact this was always supposed to be part of the spec"

> "Some of these can work via just compiling vibe and then running the tool. Obv that doesn't work for formatters though"

## Context

The tool-risk report (2026-10-29, `~/migrate/TOOL-RISK.md` on nyc-02) found type-aware Effect lint was the one tool with no workaround: it blocks alchemy's `lint` and foldkit's `lint:effect`.

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 15

(VIP-38) The lint command is `vibelang lint`.

### Detail 58

(NW 21; VIP-38, decided detail 15) `vibelang lint` takes the compiler's options (`-p`/`--project` and files) and no others. `vibelang --fix` stays the one codemod entry point.
    ```sh
    vibelang lint -p tsconfig.json
    ```
    Effect TS: none. Decided by the agent from principle 8 (a flag can be added later) and principle 4; 2026-10-29.

### Detail 62

(NW 24; VIP-38) A plain `catch` handler whose result type is an Effect gets a VIP-38 lint warning with the quick fix `catch effect (e) => try …`.
    ```vibe
    fetchUser(id) catch (e) => fetchUser("guest")               // warning: the fallback is an unrun Effect
    fetchUser(id) catch effect (e) => try fetchUser("guest")    // the fix
    ```
    Effect TS: `Effect.catch(fetchUser(id), () => fetchUser("guest"))`. Decided by the agent from principle 1 (the likeliest Effect TS habit) and decided details 28–29 (TypeScript behavior plus a lint); 2026-10-29.

### Detail 82

**Lint: an extractor whose arity can never match** (NW 48; Fable m7 and design cost 2; r16-004). When a class or fixed pattern's extracted list has a statically known length (an `error` or `schema error` class and the thirty-three retained errors (86/92): 1; `Option.Some`, `Exit.*`, `Result.*`: 1; `Option.None`: 0) and the known length is outside the required-to-total position interval of an extractor without a rest pattern (128: each elision slot counts, optional elements count only in the maximum), VibeLang reports the VIP-38 lint warning `EK0703`. Quick fixes: the bare pattern `when X:`, or `when X(let e):` for a singleton list. Matching is unchanged: the arm still fails at run time (VIP-7, detail 53).
    ```vibe
    when NotFound(): …          // warning: never matches; write NotFound or NotFound(let e)
    when Option.Some(): …       // warning
    when Option.None(): …       // ok: its list is []
    ```
    Effect TS: none. Decided by the agent from the precedent of details 6, 28, 29 and 62 (a dead or unrun construct gets a VIP-38 warning, never a new error) and principle 1; 2026-10-29.

    **Existing inventory/list-rule reconciliation.** Read the retained-error count under86/92 and the arity test under128, as now explicitly published in mainfb3. For example, `Option.None(1?)` admits the empty extracted list and is not warned; runtime matching remains unchanged. This corrects the older summary to already-decided rules, with no newnumber/permission or native/compiler test execution.

### Detail 104

**`try` on an `any` operand stays accepted** (Opus r18 "design decisions I would revisit" 3; restates detail 89 so the next round stops raising it). `EK0502` tests assignability to `Effect.Effect<any, any, any>`, and `any` is assignable to everything, as in TypeScript, where `yield* (v as any)` compiles. A non-Effect `any` value defects at run time, which is the price TypeScript users already accept for `any`. Effect's language service, run by VIP-38, is where an `any`-in-generator rule belongs, not a VibeLang exception.
    ```vibe
    effect function f(v: any) { return try v }   // ok; defects at run time if v is not an Effect
    ```
    Effect TS: `yield* (v as any)`. Decided by the agent from principle 2 (TypeScript's `any` is assignable) and detail 89, which keeps assignability for `EK0502` and excludes `any` only from the "may be an unrun Effect" warnings; changing it would turn compiling `.vibe` into errors with no VIP behind it; 2026-10-29.


    **Immutable-main source publication (e666045ecefb, existing104/89 and VIP-5).** Chapter007 now requires migrations to keep a structurally valid `try` operand, including calls returning `error`/`schema error` instances: their failure must not become success data. Non-Effect Yieldables retain explicit `asEffect()` conversion. The complete737-byte one-file diff is read; `source-e666-migration-operands.json` records source scope only, not compiler/fuzz/gate validation.



    **Pinned API correction (r6 Opus OPUS-1, detail 266).** The historical migration sentence recommending a non-Effect Yieldable `asEffect()` call is not valid general advice for Effect4.1.0. Option and Result have no such method; keep `EK0502` rather than inventing a conversion. Effectable.Class instances already satisfy the Effect test, and actual user adapter methods remain ordinary explicit calls. The structural/any/delegation rule of104 is unchanged; see266 for the pinned native controls.
## Live decisions (lane decide-live, 2026-10-29)

Class A derives existing principles and counterparts. Class B defaults are individually timed; none is unconditional approval before its deadline. No compiler code, spec source, commit, or other lane workspace is changed by this record.
