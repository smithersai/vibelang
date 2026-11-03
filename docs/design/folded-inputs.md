# Folded specification inputs

This receipt records the waiting patches reconciled against the simplified specification. The linked chapters and accepted VIPs define the language; old wording, diagnostic inventories and implementation rollout status do not override them. A retirement described here does not claim that its codemod or repository migration has shipped.

## respect TypeScript exact optional keys

Folded: schema-exact-optional.patch (applied at docs/design/src/006-data.md:122)

Folded: 1793652122-fk9-schema-type.patch (already stated at docs/design/src/006-data.md:373)

VIP-15 and Will’s standing TypeScript rule govern optionality. The written schema alias keeps its own documentation and replaces the synthesized alias in either order; that amendment was already present. TypeScript 5.9.3 controls under strict checking: exactOptionalPropertyTypes=false accepts present undefined; true reports TS2375 for a property and TS2322 for a tuple element whose written type excludes undefined.

## complete the single foreign-callable rule

Folded: 1793656127-no-trusted-packages.patch (applied at docs/design/src/007-tooling.md:116)

Folded: 1793693643-sl18-fix-astra-2.patch (applied at docs/design/src/005-services.md:574)

Will’s 2026-11-02 ruling and VIP-4 supersede the stale VIP-40 sentence that permitted an unannotated foreign call in plain code. Preserve explicit intrinsic/thunk annotations; neither the prelude nor an inventory grants package trust. The paired prelude bridge examples were already present.

## fold continuation retirement without admitting handlers

Folded: relic-control.patch (applied at docs/design/src/000-intro.md:78)

Folded: relic-trusted-stale-legacy-inventory.patch (already stated at docs/design/src/000-intro.md:7)

Will’s no-relics ruling governs retirement. Historical D-numbers are not authority and VIP-35 remains open; no new handler facility is introduced.

## fold ordinary mutable-marker migration and retirement

Folded: relic-mutable-codemod.patch (applied at docs/design/src/007-tooling.md:257)

Folded: relic-mutable-rejection-HELD.patch (applied at docs/design/src/007-tooling.md:261)

Will’s no-relics ruling settles the language rule. The HELD note constrains enforcement rollout, not publication of approved spec text: preserving codemods and fresh zero-count receipts remain prerequisites to rejection.

## fold data receiver-method retirement

Folded: relic-data-methods.patch (applied at docs/design/src/007-tooling.md:263)

Folded: relic-data-methods-rejection.patch (applied at docs/design/src/900-appendices.md:1029)

The no-relics ruling retires the compiler receiver extension. Namespace calls and actual native/own methods keep their meaning. Migration precedes rejection; this is specification publication, not an implementation rollout receipt.

## fold resolved prelude and Effect-alias migrations

Folded: relic-rest-a-scope-codemod.patch (applied at docs/design/src/007-tooling.md:269)

Folded: relic-rest-b-module-codemod.patch (applied at docs/design/src/007-tooling.md:271)

Folded: rc-ek4833-alias.patch (applied at docs/design/src/007-tooling.md:182)

VIP-14 provides namespaces, not same-name export shorthands. Migrations and advisories use resolved identity; reordered/defaulted/wrapped Effect aliases must not change type meaning.

## fold fork and wire migration contracts

Folded: relic-try-forms-fork-codemod.patch (applied at docs/design/src/007-tooling.md:275)

Folded: relic-try-forms-try-wire-codemods.patch (applied at docs/design/src/007-tooling.md:277)

Folded: relic-try-forms-rejections-HELD.patch (applied at docs/design/src/900-appendices.md:1049)

VIP-2/VIP-5/VIP-17 and denied VIP-24 settle the forms. HELD is an enforcement rollout constraint; the preserving migration and zero-use requirements are retained in published text.

## fold empty legacy trust-wrapper retirement

Folded: relic-trusted-empty-wrapper.patch (applied at docs/design/src/007-tooling.md:285)

Will’s no-relics ruling removes the unapproved wrapper. Preserve defect identity rather than silently replacing a defect with an UnknownError failure. The source HOLD remains an enforcement prerequisite, not a spec-publication dependency.

## state inferred Effect-argument warning boundaries

Folded: fuzz-effect-generic-arg.patch (applied at docs/design/src/002-running.md:24)

Folded: conf-auto-pipe-arrow-body-admission-d246-d247.patch (already stated at docs/design/src/900-appendices.md:1075)

EK4802 remains a configurable advisory; explicit program-data type arguments opt out. VIP-23’s pipe-arrow grammar rejection and EK2301 ownership were already stated.

## fold ordinary fix file selection

Folded: 1793683286-fixscope-alchemy.patch (applied at docs/design/src/007-tooling.md:297)

Folded: 1793657811-trailing-blocks-final.patch (already stated at docs/design/src/007-tooling.md:241)

VIP-34’s write boundary and VIP-11’s denied trailing blocks remain intact. The selected-file option affects repair writes, not the compiler’s normal declaration emission.

## fold resolution migration and package declaration layout

Folded: 1793633870-resolve-like-tsc.patch (applied at docs/design/src/007-tooling.md:118)

Folded: 1793689889-flow-sidecar-pack.patch (applied at docs/design/src/007-tooling.md:124)

Folded: sidecar-outside-root.patch (already stated at docs/design/src/007-tooling.md:54)

Folded: 1793693984-sl18-fix-astra-3.patch (already stated at docs/design/src/007-tooling.md:54)

Will’s module-resolution ruling and VIP-27 govern the simplified text. Sidecar ownership/root inference was already present. The old source-extension rewriting prose is superseded: tsc 5.9.3 declaration emit preserves a written ./dep.ts with rewriteRelativeImportExtensions=true; the VibeLang twin preserves ./dep.vibe. JavaScript rewriting is separate. Generated old-resolution tables are not restored as normative chapters.

## reconcile declaration spelling with the TypeScript twin

Folded: 1793682039-declstyle-from-tsc.patch (applied at docs/design/src/001-functions.md:563)

Folded: 1793667173-rc-entry1.patch (applied at docs/design/src/001-functions.md:484)

Folded: 1793657310-vip3-sugar.patch (already stated at docs/design/src/900-appendices.md:1153)

VIP-27/VIP-30’s later TypeScript-twin amendment wins over the patch’s old rule changing .vibe to .ts in declarations; written declaration specifiers remain written. tsc 5.9.3 emits ./dep.ts unchanged even with rewriteRelativeImportExtensions=true. The obsolete declarationImportStyle paths are ignored for every value with a nonfatal warning; no spelling option returns. VIP-3’s infer-slot retirement and VIP-26’s lexical main binding were already stated.

## record already folded grammar and running rules

Folded: 1793639574-sl15-fix-opus-1.patch (already stated at docs/design/src/002-running.md:671)

Folded: 1793652497-fk48-service-shape.patch (already stated at docs/design/src/005-services.md:44)

Folded: 1793653095-impl-hunt-run.patch (already stated at docs/design/src/002-running.md:1156)

Folded: 1793658761-vip-throw-expr.patch (already stated at docs/design/src/003-failures.md:61)

VIP-9’s later native namespace reconciliation governs Name.Shape visibility. The old producer patch rejected `any`/`unknown`/compatible unions; the standing TypeScript rule and current Stream.callback twin supersede that restriction. TC39 throw expressions use the current VIP-41 number; VIP-40 belongs to TypeScript module declarations, so the obsolete conflicting number is not restored. Existing do-expression label-chain and EK0204 compiler-gap rules remain intact.

## record already folded review and table inputs

Folded: 1793689134-sl17-fix-opus-1.patch (already stated at docs/design/src/002-running.md:196)

Folded: 1793689877-sl17-fix-astra-2.patch (already stated at docs/design/src/900-appendices.md:321)

Folded: 1793692491-sl18-fix-opus-1.patch (already stated at docs/design/src/003-failures.md:45)

Folded: 1793692940-sl18-fix-astra-1.patch (already stated at docs/design/src/007-tooling.md:487)

These round-17/18 corrections are already in the publication tip. This receipt changes no language rule.

## record the simplified grammar and diagnostic inventories

Folded: 1793657528-lang-tables.patch (applied at docs/design/src/900-appendices.md:3)

Folded: 1793659478-lang-tables.patch (already stated at docs/design/src/900-appendices.md:959)

Both old registry patches mechanically centralized the then-current grammar/diagnostic inventories. The simplified appendix already owns the grammar productions and language, transitional and imported-lint tables; tooling owns repair triggers and preservation boundaries. Keep the current accepted rules and their reconciliations rather than reintroducing the removed historical grammar census, obsolete registry duplicates or old diagnostic descriptions. The normative tables remain the simplified specification’s source, and generated imported lint tables retain their own generator. The old census’s pending throw-expression claim is superseded by accepted VIP-41. VIP-40’s module productions now use the appendix’s `text` fences, `=` notation and individual production headings: the existing grammar-layout regression fails on the base and passes with this normalization; syntax and meaning are unchanged.

## fold preserving legacy entry-dispatch migration

Folded: relic-rest-b-entry-marker-codemod.patch (applied at docs/design/src/007-tooling.md:287)

VIP-26 and VIP-33 require explicit runner calls and retain the platform boundary. Expand proved legacy CommonJS startup without changing callable kind or import-only behavior; preserve and report unsupported ESM sites rather than guessing bundled entry identity. No new language form or Will question is required.

## match TypeScript definite-assignment exemptions

Folded: 1793695660-conf-auto-custommatcher-type-surface.patch (applied at docs/design/src/004-match.md:347)

Standing TypeScript rule and VIP-7. TypeScript 5.9.3 strict twin: conditional assignment then read is accepted for any, unknown, void and number | undefined; number and string report TS2454. The update-clause read uses the same type-dependent check. Runtime uninitialized-cell behavior and use-before-declaration checks remain unchanged.

## Round 19: restore VIP-40’s accepted plain-call boundary

Reconciled: 1793693643-sl18-fix-astra-2.patch at docs/design/vips/0040-module-declarations.md:154. Its service examples remain folded; its rejecting unannotated plain-call sentence is superseded by VIP-40’s accepted text before `8c554d6c31eb`. An unknown unannotated contract stays an ordinary call in plain code; an explicit `@throws {unknown}` is known throwing. Both require a bridge in effect code. This restores agreement with chapter 3 and the explicit program runners of VIP-26, without creating a runner exemption.

## Round 19: complete the inferred-argument warning input

Folded: fuzz-effect-generic-arg.patch (applied at docs/design/src/002-running.md:24 and docs/design/src/007-tooling.md, under VIP-5’s inferred Effect arguments amendment).

The earlier fold omitted the warning-table row and the explicit-type-argument editor action/batch refusal. Both are now present. Preserve the input’s declared-Effect-result exclusion: a generic inferred result is not a declared program position. The compiler lane’s report records direct, container, callback, overload, method and constrained-parameter coverage; TypeScript itself accepts program data and the added check remains a configurable warning.

## Round 19: complete the sidecar-root reconciliation

Folded: 1793693984-sl18-fix-astra-3.patch (already stated at docs/design/src/007-tooling.md:54; the same root rule now also governs docs/design/vips/0027-declaration-output.md’s overlapping-directory paragraph).

The directory amendment already follows TypeScript’s declaration source root. Remove the surviving unconditional config-relative claim from its later paragraph. Native TypeScript `5.9.3` emits `decl/x.d.ts` for a sole `src/x.ts` without `rootDir`, and `decl/src/x.d.ts` with explicit `rootDir: "."` or a composite project. Overlap, selected-output cleanup and native `rootDirs` resolution keep their existing rules. This corrects the omitted sentence, not the implementation owned by `sidecar-outside-root` or the earlier `sl18-review-astra` fix.
