# VIP-34: compiler and tooling requirements

**Status:** accepted, 2026-10-29, under Will's standing approval of recommendations ("assume I accept now. I will interrupt you if I need to").

Before its first release, VibeLang ships no quick fixes or codemods of its own. TypeScript's built-in code fixes remain available.

## Decision

1. **Diagnostics.** Every VibeLang diagnostic has a code (`EKxxxx`) and a message in the user's words that says what is wrong and how to fix it. TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types. A rejection that depends on a VibeLang production, placement rule, proposal-specific early error or explicitly adopted reconciliation uses its owning VIP's `EK` code, even when a TypeScript parser helper implements it. Use an already assigned specific diagnostic for the same rejection; preserve independent native errors.
2. **Codemods.** VibeLang ships no codemod of its own before its first release.
3. **One formatter.** VibeLang's formatter is the only formatter. Prettier and dprint reach it through plugins, so a repo's existing formatter command covers `.vibe` files. Oxfmt has no plugin interface, so a repo's Oxfmt format and check scripts run `vibelang-format` after Oxfmt. Under the same compiler/options, formatting preserves parsed program meaning: bindings and scopes, operator and control-flow targets, evaluation order, receivers and call syntax, ordinary runtime values and effects, coldness, failures, interruption and finalizers. It preserves inferred and declared public types, declarations and throws contracts, and diagnostic codes, categories and occurrences; diagnostic locations and quoted source follow the formatted file. Comments and their code associations survive, including JSDoc, compiler/linter/tool directives and directive-prologue meaning. An unparsable file is reported and left unchanged; formatting is idempotent. Semantic changes are explicit source edits; formatting does not apply diagnostic repairs.

   Ordinary layout and lexical-spelling normalization may change emitted JavaScript bytes. `Function.prototype.toString`, generated source text, source offsets, line/column and stack presentation may reflect the formatted text. This source-text boundary never permits changes to ordinary strings/data, tagged-template raw or cooked values, regex meaning, function names or lengths, property names or directive semantics. For example, changing an escaped string into an actual `use strict` directive changes meaning. Regenerate compiler-generated source-map and declaration-map provenance, including `sourcesContent`, for the formatted file; never retain stale maps. Preservation tests compare parsed source/emit structure, runtime behavior, types/declarations, diagnostics, comments/directives and maps; arbitrary regex stripping is unsound, and a finite structural oracle is not a proof of all program equivalence. Exact-byte tests remain useful where equality is expected, without restricting advertised native formatter style settings.
4. **Existing tools work.** Type checkers work through `.d.vibe.ts` (VIP-27), and linters, Knip, bundlers and test runners each read `.vibe`. Every tool is tested against the dogfood repositories.
5. **Severities.** Warning severities can be adjusted in the config's `"vibe"` section (VIP-30). Errors can't be turned off.

- **Amended 2026-10-29: code numbering.** Each VIP's rules take one fresh hundred-block of diagnostic codes, `EKvvxx` for VIP-vv; an older code is kept only where its rule is unchanged. The specification's Appendix B lists every code. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 60).
- **Amended 2026-10-30: warnings never change the exit status.** `vibelang` and `vibelang lint` exit non-zero only on errors, as `tsc` and ESLint do by default; a repository that wants a warning to fail CI sets its code to `"error"` in `vibe.severities`. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 71).
- **Amended 2026-11-03: imported Effect diagnostics keep the pinned compiler's exit policy.** VibeLang's own warnings do not change compiler exit status unless configured as errors. Compiler diagnostics imported under VIP-38 retain the pinned native Effect TypeScript compiler's exit and `noEmitOnError` policy under the same effective rule, category, inclusion and ignore options; imported warnings affect both by default. The standalone `vibelang lint` command fails only on errors; warnings or suggestions alone exit 0. This narrows the unqualified 2026-10-30 warning rule in VIP-34 (decided detail 71); it does not restate that old rule as already limited to VibeLang diagnostics. The agent's R3 decision (`decide-live-r3-warning-scope.md`) applies Will's standing direction, "It is already implied we match typescript" (`WILL-ANSWERS.md`, 2026-11-03), to the measured pinned compiler. It is an agent derivation from that direction, not a new personal answer from Will.
- **Amended 2026-10-30, clarified 2026-11-03: emit names mirror TypeScript.** `x.vibe` compiles to `x.js` beside `x.d.ts` in `outDir`. With `rewriteRelativeImportExtensions`, relative specifiers `./x.vibe` in emitted JavaScript are rewritten to `./x.js`, as for `.ts`; source-extension admission follows the same tsconfig checks as the native twin ([chapter 7](../src/007-tooling.md#config-files)). Bundler plugins follow the same names. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 72).

- **Amended 2026-10-30: imported-lint capacity.** VIP-38 is the exception to the hundred-code capacity: imported codes use `EK38` followed by a decimal ordinal padded to at least two digits, so ordinal `100` follows ordinal `99` in [VIP-38's generated table](0038-effect-lint-built-in.md). `EKxxxx` is a minimum display width for these codes, and `EK39xx` remains available to VIP-39. Existing assignments remain stable; configuration matches whole codes against the generated table (decided detail 142).
- **Amended 2026-10-31: a missing runtime is one error.** A compilation that needs `vibelang-runtime` and cannot resolve it fails with one error naming the package (`TS2307`), as a missing dependency does in TypeScript, not with an unresolved name per compiler-generated helper.

- **Amended 2026-11-02: the native-resource warning belongs to VIP-34.** `using` in effect code has the default warning `EK0801`: a failure or interruption can abandon the generator before JavaScript disposal. The manual form uses `acquireDisposable` inside `scoped`. The warning never changes TypeScript disposal or starts cleanup by itself. This is VibeLang's TypeScript-form teaching warning, not an imported Effect lint rule. The existing code is retained under the unchanged-code exception. VIP-8's denial authorizes no language rule; its historical warning amendment points here.

## Will's words

> "make sure we have good compile error messages too"

> "They should not only compile and tests pass but we should be able to actually suggest migrating via having everything work including all their existing tooling"

**2026-11-12: one code path.**

1. After reading a report on pluggable VibeLang:

   > "A separate experimental content mapper projects .vibe into TypeScript for stock checking, but lang does not use that path. we don't want this. We want only one code path. content mapper would be ideal. But I don't know if it's 100% viable. Have a fable agent investigate this and decide if we can use content mappers. If we can't use content mappers we likely want as much as possible as content mappers."

2. While discussing why stock `tsc` writes no `.js` for a mapped file:

   > "The content mapper returns typescript. Typesscript compiles that to javascript. That's literally how it's supposed to work what am I missing?"

   > "so what is blocking us from replacing vue's own compiler with tsc?"

   He was shown this diagram:

   ```text
   x.vibe --> our translator --> x.ts (generated file) --> stock tsc --> x.js   (this is what runs)
         \
          --> content mapper (same translator) --> tsc checks it, powers the editor
   ```

   He answered:

   > "Ok I think you get it this is how vibe should work"

3. After learning that Volar v3 hands type checking to content mappers and would add a second editor server:

   > "sounds like forking is actually cleaner than volar but we should better utilize content mappers"

4. He asked:

   > "did you just say we have 2 implementations instead of just turning vibe into typescript?"

   The answer was yes: the fork parsed `.vibe` directly into compiler trees with its own checker hooks and type-directed lowering, producing no TypeScript text; the projection that produced TypeScript text was experimental and stale.

5. He then said:

   > "jesus fix that"

**2026-11-13: removing type-dependent code generation.**

He was asked whether `match` exhaustiveness should lower to a generic test plus `$noMatch` instead of the checker-proven `$assertMatch` last arm, with an `Inline` example and the explanation that both shapes run the same.

> "yea that was an unnecessary transformation. Is there any other place we use types to generate code like this?"

Recorder's reading (not Will's words): this approves emitting the generic `if` plus `$noMatch` and dropping the `$assertMatch` last-arm form.

He was then shown a list of six other places where types affect code generation:

- An `Effect.sync` shortcut and temporaries.
- A call on an `any` receiver.
- Shadowing of `Effect` globals detected from the current file only.
- `Option`, `Exit`, and `Result` recognized only from a direct `effect` import.
- Changing `when Name(x)` to test `instanceof` unless `Name` has its own matcher, moving a plain-function test into a guard and making the old form a compile error.
- Choosing schema codecs by the name as written, with `import type { LibraryDate as Native }` and `export schema S = Native` as the example.

He was told that the last two rows change what programs do and that the schema codec row makes code that compiles today stop compiling. He answered the list as a whole:

> "Yea all this can be removed"

Recorder's reading (not Will's words): this approves removing the other type-dependent code generation so the translator decides from the file as written. The six rows came from a design document and had not been checked against the compiler source in that exchange; only the schema codec row was shown with its own code example.

- **Amended 2026-11-01: legacy Effect alias migration.** VIP-3 allocates migration warning `EK4856` to uses resolving to the retired prelude `Effect<A, E, R>` alias. Write the shorthand or qualified type; user-defined and imported types are unchanged.

- **Amended 2026-11-03: declaration import spelling follows TypeScript.** Ordinary package declarations use the native twin’s relative specifiers: `./user.vibe` is declared as `./user.ts` and `./App.vibex` as `./App.tsx`; written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling. Synthesized import types use TypeScript’s spelling for the twin under the same imports and tsconfig. Compatibility sidecars instead keep VibeLang source references such as `./user.vibe` and `./App.vibex`, relocated to the selected compatibility declaration when necessary, to preserve source identity. Neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` rewrites declaration specifiers; JavaScript output rewriting is separate. The retired `declarationImportStyle` paths are ignored with nonfatal deprecation warning `EK3011` for every value (VIP-30). This corrects the earlier substitution of VibeLang source extensions into ordinary package declarations, under Will’s standing TypeScript rule: a package ships `.d.ts` files, not compatibility sidecars.

- **Amended 2026-11-11: Oxfmt has no formatter plugin.** Decision 3 used to say that Oxfmt reaches the VibeLang formatter through a plugin. Oxfmt accepts no Prettier plugins and has no external-formatter option, so no such plugin exists. Prettier (`vibelang/prettier`) and dprint reach the formatter through plugins; Oxfmt repositories run `vibelang-format --write` or `--check` after Oxfmt in their format scripts, and `oxfmt file.vibe` is unsupported.
