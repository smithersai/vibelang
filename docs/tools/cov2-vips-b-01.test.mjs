// Pending coverage obligations for this lane; no compiler conformance is claimed.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0017-fork.md#e3e140138d6af8a1
// VIP-17: parenthesized fork catch diagnostics.
// Activation: Compile fork (e catch h), (fork e) catch h, and unparenthesized controls; require no EK0505 for parentheses and EK0506 only for the Fiber catch.
test.todo("rule-evidence: docs/design/vips/0017-fork.md#decision | cov2-vips-b parenthesized fork catch diagnostics | present | *Corrected 2026-10-30: the quick fix was `fork (e catch h)`, which contradicted decided detail 99's own Effect TypeScript, `Effect.forkChild(Effect.catch(e, \u2026))` (found by the round-19 Fable review).* The parenthesized forms are not `EK0505`; `(fork e) catch h` is still `EK0506`, as a `Fiber` is not an Effect in Effect 4.1.1.")

// rule-evidence: docs/design/vips/0019-for-concurrent.md#be892d4246ccf5de
// VIP-19: native concurrency domain.
// Activation: Check number and "unbounded" against native Types.Concurrency, reject "inherit", and compare the same operands in for concurrent.
test.todo("rule-evidence: docs/design/vips/0019-for-concurrent.md#decision | cov2-vips-b native concurrency domain | present | In effect 4.1.1, `Concurrency` is a number or `\"unbounded\"` (`Types.d.ts`); the decision as sent also listed `\"inherit\"`, which 4.1.1 doesn't have.")

// rule-evidence: docs/design/vips/0019-for-concurrent.md#84082ffd5bd96457
// VIP-19: numeric concurrency runtime.
// Activation: Compare visitation, peak concurrency, and Exit for negative, zero, fractional, NaN, finite positive and infinite limits with Effect.forEach.
test.todo("rule-evidence: docs/design/vips/0019-for-concurrent.md#decision | cov2-vips-b numeric concurrency runtime | present | On Effect `4.1.1`, numeric limits below `1` still visit every item sequentially as `1` does; positive integers bound concurrent items, while other numbers retain Effect's own behavior.")

// rule-evidence: docs/design/vips/0019-for-concurrent.md#e782bc9bae7a0f6f
// VIP-19: concurrency fiber identity.
// Activation: Compare item fiber ids with the parent for limits 1, 2 and "unbounded"; sequential uses parent, parallel forks.
test.todo("rule-evidence: docs/design/vips/0019-for-concurrent.md#decision | cov2-vips-b concurrency fiber identity | present | In Effect `4.1.1`, concurrency `1` runs items sequentially on the enclosing fiber; higher limits and `\"unbounded\"` fork per item.")

// rule-evidence: docs/design/vips/0021-producers.md#3b282487657a0632
// VIP-21: retired producer diagnostic.
// Activation: Assert EK2101 is absent from active diagnostic and severity registries, including a negative configuration control.
test.todo("rule-evidence: docs/design/vips/0021-producers.md#decision | cov2-vips-b retired producer diagnostic | present | The old `EK2101` is retired and will never be reassigned.")

// rule-evidence: docs/design/vips/0021-producers.md#75071da52199147a
// VIP-21: written producer native contracts.
// Activation: Compile declarations and expressions with the same annotations as Stream.callback, retaining compatible and incompatible controls.
test.todo("rule-evidence: docs/design/vips/0021-producers.md#wills-words | cov2-vips-b written producer native contracts | present | **Clarified 2026-11-03: written producer contracts.** Written return annotations follow TypeScript's ordinary contract checking on the `Stream.callback` counterpart.")

// rule-evidence: docs/design/vips/0021-producers.md#e6bd074af6225da0
// VIP-21: producer channels and annotation fallback.
// Activation: Check success, error and requirement channels separately, then a non-Stream annotation against the inferred whole Stream type.
test.todo("rule-evidence: docs/design/vips/0021-producers.md#wills-words | cov2-vips-b producer channels and annotation fallback | present | A written `Stream.Stream<A, E, R>` checks the yielded values, escaping errors and supplied requirements; otherwise infer the body channels and check the resulting Stream against the annotation.")

// rule-evidence: docs/design/vips/0021-producers.md#0511a9493ea9c171
// VIP-21: producer aliases any unknown unions.
// Activation: Compile direct and aliased Stream, any, unknown and compatible unions; reject incompatible annotations with exactly EK2102.
test.todo("rule-evidence: docs/design/vips/0021-producers.md#wills-words | cov2-vips-b producer aliases any unknown unions | present | Aliases, `any`, `unknown` and compatible unions are admitted; an incompatible annotation is `EK2102`.")

// rule-evidence: docs/design/vips/0022-interruption-blocks.md#a8c9f8d1e9fe9fcb
// VIP-22: restore concurrent head and body.
// Activation: Place restore in head binding defaults and bodies at sequential and parallel limits inside uninterruptible; require EK2202.
test.todo("rule-evidence: docs/design/vips/0022-interruption-blocks.md#decision | cov2-vips-b restore concurrent head and body | present | **Amended 2026-10-30: `restore` in a `for concurrent` body.** `restore` inside any `for concurrent` head binding initialization or body is a compile error (`EK2202`), whatever the limit: each item runs as a separate Effect that the enclosing mask does not govern.")

// rule-evidence: docs/design/vips/0023-pipe.md#88d75aa7cd5ffd1c
// VIP-23: pipe effect arrow covering.
// Activation: Exercise bare plain, async and effect arrow bodies at the right edge, with parenthesized valid controls.
test.todo("rule-evidence: docs/design/vips/0023-pipe.md#prior-art | cov2-vips-b pipe effect arrow covering | present | **Clarified 2026-11-03: arrows at the right edge.** The arrow-body covering restriction includes `EffectArrow`, as it includes `AsyncArrowFunction`.")

// rule-evidence: docs/design/vips/0023-pipe.md#903aee00838d9c25
// VIP-23: pipe diagnostic ownership.
// Activation: Require EK2301 for missing topic and each whole bare arrow body; retain independent native-expression diagnostics.
test.todo("rule-evidence: docs/design/vips/0023-pipe.md#prior-art | cov2-vips-b pipe diagnostic ownership | present | **Clarified 2026-11-03: pipe diagnostics.** Adopted pipe grammar and early errors without a more specific code use `EK2301`, including a missing topic and a whole bare plain, `async` or `effect` arrow body.")

// rule-evidence: docs/design/vips/0023-pipe.md#1c141e44061f0121
// VIP-23: parenthesized pipe arrow.
// Activation: Compile x |> (() => %) and invoke the resulting closure; compare with a TypeScript temporary capture.
test.todo("rule-evidence: docs/design/vips/0023-pipe.md#prior-art | cov2-vips-b parenthesized pipe arrow | present | Parenthesize the arrow, `x |> (() => %)`.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#9b77f698158ab897
// VIP-26: top level Promise await and rejected try.
// Activation: Compile Promise top-level await under supported options and require the owning diagnostic for a top-level try Effect.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#decision | cov2-vips-b top level Promise await and rejected try | present | `await` there is ES top-level await of a Promise (VIP-5), and `try` is not allowed, because a top level is not an `effect` function.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#657b0febacc88ea2
// VIP-26: ordinary function main.
// Activation: Export a plain main with an observable counter; module import must not call it, and an explicit call must increment once.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#decision | cov2-vips-b ordinary function main | present | A function named `main` is an ordinary function, and you call a runner yourself, exactly as in Effect TS.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#6fe6b872cde3e319
// VIP-26: explicit NodeRuntime import.
// Activation: Check that an unimported NodeRuntime is unresolved and that the explicit @effect/platform-node import resolves.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#decision | cov2-vips-b explicit NodeRuntime import | present | *Corrected 2026-11-02: the Decision example imports `NodeRuntime` from `@effect/platform-node`, which is not in scope (VIP-14), as chapter 1 does (found by the round-6 review).*")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#7dfa949b3adf3b16
// VIP-26: all vibe files external modules.
// Activation: Check binding isolation and duplicate local names across moduleDetection modes and all effectGlobals/effectModules combinations, including files with no imports.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#amendment-source-file-kind | cov2-vips-b all vibe files external modules | present | Every source `.vibe` compilation unit is an external module before binding and checking, independently of written imports and exports, required prelude imports, `vibe.effectGlobals` and `vibe.effectModules`.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#62576f853a8abb03
// VIP-26: top level await options.
// Activation: Compare supported and unsupported module/target combinations and CommonJS package mode against native TypeScript diagnostics.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#amendment-source-file-kind | cov2-vips-b top level await options | present | Top-level `await` therefore requires supported module and target options.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#f60cc1f65858f126
// VIP-26: no implicit runner.
// Activation: Import an exported effect main and observe zero body executions until the consumer explicitly runs its Effect.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#amendment-source-file-kind | cov2-vips-b no implicit runner | present | This adds no implicit runner or special `main`.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#0e5c71d26e4133c6
// VIP-27: declaration semantic comparison discretion.
// Activation: Run declaration comparison with quote, whitespace, extension, import order and member order changes, and negative type/name/doc controls.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#decision | cov2-vips-b declaration semantic comparison discretion | present | Formatting, quote style, import extension spelling, and import and member order where `tsc` doesn't care don't count (\"Byte identical seems a bit extreme shouldn't it have some level of discretion?\").")

// rule-evidence: docs/design/vips/0027-declaration-output.md#a9bfea09ebda13fb
// VIP-27: public plain callable throws never.
// Activation: Inspect emitted declarations for every public non-effect call signature and verify a separate consumer sees thrown type never.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#decision | cov2-vips-b public plain callable throws never | present | **`@throws`.** A non-effectful exported function carries `@throws {never}`, because a `.vibe` function can't throw (VIP-4) and a TypeScript function with no `@throws` throws `unknown`.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#68feb199cb49dd6e
// VIP-27: host throws annotation spelling.
// Activation: Inspect shipped host annotations for canonical @throws type syntax and consume them through foreign call checking.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#decision | cov2-vips-b host throws annotation spelling | present | The `@throws` annotations VibeLang ships for JavaScript's globals (VIP-4) use the same spelling.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#c71921fd7ccac3f0
// VIP-27: twin JSDoc and forbidden source throws tag.
// Activation: Compare the documented function twin after adding @throws {never}, and reject the same tag in .vibe source with EK0406.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#decision | cov2-vips-b twin JSDoc and forbidden source throws tag | present | Preserve the source documentation and add that tag to the twin's JSDoc before running `tsc`; do not add it to the `.vibe` source, where it is `EK0406`.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#ab84b6b8845122f6
// VIP-27: migration enables enumeration sidecars.
// Activation: Run setup on an isolated fixture whose tracked script enumerates *.ts; verify sidecars enabled and the live migration trees remain untouched.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01 | cov2-vips-b migration enables enumeration sidecars | present | The migrate flow's setup turns it on where tracked code enumerates `*.ts` files in a folder that will hold `.vibe` files.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#4058bab071c99405
// VIP-27: public spelling preserves compatibility identity.
// Activation: Compare ordinary declaration import spelling and compatibility module identity independently using distinct nominal brands.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01 | cov2-vips-b public spelling preserves compatibility identity | present | Ordinary `.d.ts` spelling is separate, under the 2026-11-03 amendment below; it cannot change which module a compatibility declaration represents.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#1142b60f1dc8b56c
// VIP-27: discovered sidecar yields to source.
// Activation: Exercise include and default glob source/sidecar pairs; assert source selection and regeneration of stale output bytes.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | cov2-vips-b discovered sidecar yields to source | present | **Amended 2026-11-01: a sidecar is an emit output.** Discovery through `include` or default globs selects the source and omits its compatibility declaration, as native `.ts`/`.d.ts` discovery does.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#69a7716cf6d0917d
// VIP-27: explicit sidecar input overwrite protection.
// Activation: Select source and sidecar via files, require exit 1 and TS5055, and compare the sidecar bytes before and after.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | cov2-vips-b explicit sidecar input overwrite protection | present | A declaration explicitly selected in `files` remains an input: an attempted compatibility write over it reports `TS5055`, exits `1`, and leaves its bytes unchanged.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#d6cef667787d1eb1
// VIP-27: vibex and mapped sidecar protection.
// Activation: Repeat explicit-input byte preservation for .d.vibex.ts and sidecarDir-mapped declarations.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | cov2-vips-b vibex and mapped sidecar protection | present | This includes `.d.vibex.ts` and mapped sidecar locations.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#8bbc40fc4488bd77
// VIP-27: required sidecar under noEmit.
// Activation: Cross noEmit and declaration:false with discovered/explicit input selection; compatibility output remains required while JS/public outputs follow native controls.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | cov2-vips-b required sidecar under noEmit | present | VIP-27's independent compatibility write still runs under `noEmit: true` and `declaration: false`; those options retain their ordinary JavaScript/public-declaration output controls.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#608508298ee8f6a7
// VIP-27: nonrelative sidecar source redirect.
// Activation: Cross package exports, paths and #imports with realpath/preserveSymlinks and node_modules; redirect only a known available source outside node_modules.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | cov2-vips-b nonrelative sidecar source redirect | present | **Amended 2026-11-01: sidecars reached by non-relative names.** After native resolution and `realpath`/`preserveSymlinks` handling, a non-relative export, `paths` or `#imports` resolution to a known `.d.vibe.ts`/`.d.vibex.ts` sidecar uses its available source only when the final path is outside `node_modules`.")

// rule-evidence: docs/design/vips/0027-declaration-output.md#62b07b8007aa750b
// VIP-27: anonymous cycle declaration elision.
// Activation: Compile recursive builders at the changed anonymous cycle sites; require /*elided*/ any and no new TS5088, compared with pinned native TypeScript.
test.todo("rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-cyclic-inferred-declaration-types-2026-11-01 | cov2-vips-b anonymous cycle declaration elision | present | Declaration serialization retains TypeScript 5.9 and 7.0 behavior at the anonymous-type cycle sites changed by [TypeScript #64461](https://github.com/microsoft/TypeScript/pull/64461): write `/*elided*/ any` at the repeated type rather than report the new `TS5088`.")
