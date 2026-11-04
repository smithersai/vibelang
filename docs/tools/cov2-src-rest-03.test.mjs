import { test } from "node:test"

// Rule-specific coverage backlog. Verification is deferred for the coverage deadline.
// These TODOs specify expected behavior; they do not assert a known compiler mismatch.
// Promote each language witness with its Effect TypeScript twin and complete Exit/type checks.

// docs/design/src/006-data.md#37e2a81b74a8347f — Chapter 006: Ambient data precedence.
test.todo("Chapter 006: Ambient data precedence: explicit and inherited ambient contexts report EK1607 before a missing-body EK1604 [docs/design/src/006-data.md#37e2a81b74a8347f]")

// docs/design/src/006-data.md#e23aaaeedcf2026f — Chapter 006: Data variance.
test.todo("Chapter 006: Data variance: in and out survive alias lowering with TS checks, while const type parameters report TS1277 [docs/design/src/006-data.md#e23aaaeedcf2026f]")

// docs/design/src/006-data.md#b63d69172839d80f — Chapter 006: Generic data helper hygiene.
test.todo("Chapter 006: Generic data helper hygiene: occupied $Outcome$Definition names choose deterministic fresh $2 and $3 suffixes [docs/design/src/006-data.md#b63d69172839d80f]")

// docs/design/src/006-data.md#e72b20e8fe4c264b — Chapter 006: Schema and data declarations.
test.todo("Chapter 006: Schema and data declarations: emitted constant and type aliases match the exported Effect TypeScript twins [docs/design/src/006-data.md#e72b20e8fe4c264b]")

// docs/design/src/006-data.md#5b286039eb01f158 — Chapter 006: Exported generic data helper.
test.todo("Chapter 006: Exported generic data helper: a referenced WithGenerics definition is emitted with a hygienic ordinary implementation name [docs/design/src/006-data.md#5b286039eb01f158]")

// docs/design/src/007-tooling.md#2831d9b13dc39f4c — Chapter 007: Config TS fields.
test.todo("Chapter 007: Config TS fields: vibe.config.json accepts all tsconfig fields including extends and jsconfig applies TS implied defaults [docs/design/src/007-tooling.md#2831d9b13dc39f4c]")

// docs/design/src/007-tooling.md#1820f5b709fab62d — Chapter 007: Vibe config section.
test.todo("Chapter 007: Vibe config section: vibe options are read from the top-level vibe key in vibe, tsconfig, and jsconfig files [docs/design/src/007-tooling.md#1820f5b709fab62d]")

// docs/design/src/007-tooling.md#c965d158b5c48330 — Chapter 007: Mandatory sidecars.
test.todo("Chapter 007: Mandatory sidecars: noEmit and declaration false do not suppress required sidecar writes [docs/design/src/007-tooling.md#c965d158b5c48330]")

// docs/design/src/007-tooling.md#4e8d7bd46457d3b0 — Chapter 007: Native sidecar overwrite.
test.todo("Chapter 007: Native sidecar overwrite: an include-discovered sidecar yields to its source and emit may replace it [docs/design/src/007-tooling.md#4e8d7bd46457d3b0]")

// docs/design/src/007-tooling.md#bb59179bc8d80053 — Chapter 007: Explicit source resolution.
test.todo("Chapter 007: Explicit source resolution: ./tag.vibe stays that module beside tag.ts in imports, re-exports, and inferred import types in both layouts [docs/design/src/007-tooling.md#bb59179bc8d80053]")

// docs/design/src/007-tooling.md#376c812e4e5f44fa — Chapter 007: Sidecar root layout.
test.todo("Chapter 007: Sidecar root layout: explicit rootDir, composite config root, and inferred common-source root match TS 5.9 declaration layout [docs/design/src/007-tooling.md#376c812e4e5f44fa]")

// docs/design/src/007-tooling.md#0f03a3da687cc6ab — Chapter 007: Outside-source sidecar owner.
test.todo("Chapter 007: Outside-source sidecar owner: the compiling project emits under its own sidecarDir or beside the source regardless of nearest config [docs/design/src/007-tooling.md#0f03a3da687cc6ab]")

// docs/design/src/007-tooling.md#37185f717fa9d15c — Chapter 007: Sidecar rootDir exclusion.
test.todo("Chapter 007: Sidecar rootDir exclusion: importing a source outside explicit rootDir reports TS6059 [docs/design/src/007-tooling.md#37185f717fa9d15c]")

// docs/design/src/007-tooling.md#6ad41e1f71280a7c — Chapter 007: Referenced sidecar owner.
test.todo("Chapter 007: Referenced sidecar owner: only the owning referenced project writes its source sidecar under its own sidecarDir [docs/design/src/007-tooling.md#6ad41e1f71280a7c]")

// docs/design/src/007-tooling.md#8e02b8ce910f2344 — Chapter 007: Migration outside sources.
test.todo("Chapter 007: Migration outside sources: setup gives non-owning configs a sidecarDir and paired rootDirs unless references preserve ownership [docs/design/src/007-tooling.md#8e02b8ce910f2344]")

// docs/design/src/007-tooling.md#a0e005fb2d0d531d — Chapter 007: Mirrored sidecar examples.
test.todo("Chapter 007: Mirrored sidecar examples: rootDir dot yields config-relative paths and omitting it uses the common-source inference rule [docs/design/src/007-tooling.md#a0e005fb2d0d531d]")

// docs/design/src/007-tooling.md#b2f24fc80add3502 — Chapter 007: Migration suffix preservation.
test.todo("Chapter 007: Migration suffix preservation: setup and fixes never insert moduleSuffixes [docs/design/src/007-tooling.md#b2f24fc80add3502]")

// docs/design/src/007-tooling.md#08740b402d374195 — Chapter 007: Historical diagnostic config.
test.todo("Chapter 007: Historical diagnostic config: root and compilerOptions vibelang.diagnostics work in all three config names and extended configs [docs/design/src/007-tooling.md#08740b402d374195]")

// docs/design/src/007-tooling.md#afd1a269444d0083 — Chapter 007: Vibex language variant.
test.todo("Chapter 007: Vibex language variant: vibex parses VibeLang with the native TypeScript JSX language variant [docs/design/src/007-tooling.md#afd1a269444d0083]")

// docs/design/src/007-tooling.md#99f81eef65c3c2cd — Chapter 007: Vibex competing grammar.
test.todo("Chapter 007: Vibex competing grammar: TSX scanning, checking, and emit coexist with VibeLang and TSX wins at expression-position less-than [docs/design/src/007-tooling.md#99f81eef65c3c2cd]")

// docs/design/src/007-tooling.md#e5877b1243039358 — Chapter 007: Vibex clash alternatives.
test.todo("Chapter 007: Vibex clash alternatives: as assertions, comma generic arrows for effect async and catch, and spaced regex comparison parse correctly [docs/design/src/007-tooling.md#e5877b1243039358]")

// docs/design/src/007-tooling.md#00e94dcb179b71b6 — Chapter 007: JSX options and pragmas.
test.todo("Chapter 007: JSX options and pragmas: discovered config and file pragmas produce the same semantics as the TSX twin [docs/design/src/007-tooling.md#00e94dcb179b71b6]")

// docs/design/src/007-tooling.md#5771f09901349387 — Chapter 007: Missing JSX config.
test.todo("Chapter 007: Missing JSX config: an element reports TS17004 and importing a vibex file reports TS6142 [docs/design/src/007-tooling.md#5771f09901349387]")

// docs/design/src/007-tooling.md#d8345352dc059dd5 — Chapter 007: JSX emit modes.
test.todo("Chapter 007: JSX emit modes: react, react-jsx, and react-jsxdev transform elements while preserve and react-native retain them [docs/design/src/007-tooling.md#d8345352dc059dd5]")

// docs/design/src/007-tooling.md#9e994c690b15c2e1 — Chapter 007: Direct-operand lint exclusions.
test.todo("Chapter 007: Direct-operand lint exclusions: fork, join, try combinator elements, API arguments, catch heads, and stored or returned Effects do not warn [docs/design/src/007-tooling.md#9e994c690b15c2e1]")

// docs/design/src/007-tooling.md#be5f5876bde8643c — Chapter 007: Bare try construction lint.
test.todo("Chapter 007: Bare try construction lint: direct Effect.succeed and Effect.fail operands report EK4834 with value or throw advice [docs/design/src/007-tooling.md#be5f5876bde8643c]")

// docs/design/src/007-tooling.md#56a2c1d3b1737147 — Chapter 007: Bare try recovery lint.
test.todo("Chapter 007: Bare try recovery lint: direct catch, catchTag, and catchTags operands report EK4835 with catch effect advice [docs/design/src/007-tooling.md#56a2c1d3b1737147]")

// docs/design/src/007-tooling.md#7c5e40755383ee77 — Chapter 007: Bare try provide lint.
test.todo("Chapter 007: Bare try provide lint: direct provide and provideService operands report EK4836 with an order-preserving provide statement fix [docs/design/src/007-tooling.md#7c5e40755383ee77]")

// docs/design/src/007-tooling.md#f4c94ea6f77d6680 — Chapter 007: Direct-operand lint witness.
test.todo("Chapter 007: Direct-operand lint witness: only the first documented demo line warns [docs/design/src/007-tooling.md#f4c94ea6f77d6680]")

// docs/design/src/007-tooling.md#898ee7c1997bb123 — Chapter 007: Child failure semantics.
test.todo("Chapter 007: Child failure semantics: fork Effect.fail leaves the caller running to inspect the child, while a caller throw fails demo [docs/design/src/007-tooling.md#898ee7c1997bb123]")

// docs/design/src/007-tooling.md#a85756be22c8907f — Chapter 007: Migration stage order.
test.todo("Chapter 007: Migration stage order: Effect upgrade and typecheck finish before TS files convert to VibeLang, preserving the failing stage [docs/design/src/007-tooling.md#a85756be22c8907f]")

// docs/design/src/007-tooling.md#f00796d3ca302f6b — Chapter 007: Coordinated Effect upgrade.
test.todo("Chapter 007: Coordinated Effect upgrade: runtime rejects a mismatched exact pin and VibeLang upgrades with its pinned Effect release [docs/design/src/007-tooling.md#f00796d3ca302f6b]")

// docs/design/src/007-tooling.md#0335c9e2b7545207 — Chapter 007: Effect version diagnostic.
test.todo("Chapter 007: Effect version diagnostic: resolving Effect 4.0.3 reports the resolved version, VibeLang release, pinned 4.1.1, and upgrade-both advice [docs/design/src/007-tooling.md#0335c9e2b7545207]")

// docs/design/src/007-tooling.md#27fd72cc9ce887f5 — Chapter 007: Language-check confinement.
test.todo("Chapter 007: Language-check confinement: VibeLang-specific checks do not leak into ordinary TypeScript files [docs/design/src/007-tooling.md#27fd72cc9ce887f5]")

// docs/design/src/007-tooling.md#68984669f80eafc0 — Chapter 007: Safe import removal.
test.todo("Chapter 007: Safe import removal: --fix retains imports whenever removal changes public names, bidirectional types, or documentation in any scope [docs/design/src/007-tooling.md#68984669f80eafc0]")

// docs/design/src/007-tooling.md#1f8e68ac273369fd — Chapter 007: Import identity normalization.
test.todo("Chapter 007: Import identity normalization: harmless formatting and ordering permit removal while inferred imports retain the same public type [docs/design/src/007-tooling.md#1f8e68ac273369fd]")

// docs/design/src/007-tooling.md#87fb7c250d47357e — Chapter 007: Unused import cleanup.
test.todo("Chapter 007: Unused import cleanup: noUnusedLocals removes source-unused imports after fixes so TS6133 is not introduced [docs/design/src/007-tooling.md#87fb7c250d47357e]")

// docs/design/src/008-runtime.md#d90f0bc7225bb431 — Chapter 008: Pinned runtime semantics.
test.todo("Chapter 008: Pinned runtime semantics: failure, defect, interruption, finalizer trace, and ordered Cause combinations match Effect 4.1.1 [docs/design/src/008-runtime.md#d90f0bc7225bb431]")

// docs/design/src/008-runtime.md#6e6975c64b8feb56 — Chapter 008: Operand evaluation order.
test.todo("Chapter 008: Operand evaluation order: lowering temporaries preserve source order including scope and operand of fork.in [docs/design/src/008-runtime.md#6e6975c64b8feb56]")

// docs/design/src/008-runtime.md#a89698a84179c77a — Chapter 008: Complete execution oracle.
test.todo("Chapter 008: Complete execution oracle: compare the entire canonical Exit and finalizer trace rather than only success values [docs/design/src/008-runtime.md#a89698a84179c77a]")
