// Pending coverage obligations for this lane; no compiler conformance is claimed.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0017-fork.md#e3e140138d6af8a1
// VIP-17: parenthesized fork catch diagnostics.
// Activation: Compile fork (e catch h), (fork e) catch h, and unparenthesized controls; require no EK0505 for parentheses and EK0506 only for the Fiber catch.
test.todo("rule-evidence: docs/design/vips/0017-fork.md#decision | cov2-vips-b parenthesized fork catch diagnostics | present | *Corrected 2026-10-30: the quick fix was `fork (e catch h)`, which contradicted decided detail 99's own Effect TypeScript, `Effect.forkChild(Effect.catch(e, \u2026))` (found by the round-19 Fable review).* The parenthesized forms are not `EK0505`; `(fork e) catch h` is still `EK0506`, as a `Fiber` is not an Effect in Effect 4.1.1.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#657b0febacc88ea2
// VIP-26: ordinary function main.
// Activation: Export a plain main with an observable counter; module import must not call it, and an explicit call must increment once.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#decision | cov2-vips-b ordinary function main | present | A function named `main` is an ordinary function, and you call a runner yourself, exactly as in Effect TS.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#f60cc1f65858f126
// VIP-26: no implicit runner.
// Activation: Import an exported effect main and observe zero body executions until the consumer explicitly runs its Effect.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#amendment-source-file-kind | cov2-vips-b no implicit runner | present | This adds no implicit runner or special `main`.")

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
