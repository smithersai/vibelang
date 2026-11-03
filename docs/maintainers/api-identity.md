# Published declaration identity

Run `node scripts/api-identity.mjs --before <dir|package> --after <dir|package>`
from the checkout, adding `--json` for machine-readable output. Install the
pinned stock TypeScript compiler API with
`(cd docs/tools && bun install --frozen-lockfile)` first. The checker reads
both inputs without writing to them.

The command reports three lists: exported-name differences, type differences
with the generated probe's `tsc` diagnostic, and doc-comment differences.
Exit status `0` means the comparison completed and all three are empty;
`1` means an API difference; `2` means the comparison could not complete.
Environment diagnostics are reported separately and never count as API
differences. Unrelated diagnostics outside the compared trees do not fail the
comparison. Invalid owned declarations, unresolved exported types and errors
in probe setup make the comparison unavailable, with exit status `2`.

Package inputs use `package.json`'s `exports` subpaths and `types` conditions,
with `publishConfig` overrides applied. Exact subpaths override wildcard
patterns; matching patterns use the longest prefix and then the longest trailer.
`null` exclusions prevent private declarations from becoming entry points,
including under conditional wildcard exports. Ordered `exports` arrays select
the first resolvable target for each import, require and custom-condition path;
unreachable fallbacks are not extra entry points. Conditional objects also follow TypeScript's property order: an earlier matching `default`, `import` or `require` target can shadow a later `types` target. Discovery uses the same configuration and sidecar projection as the probes, so a published `.vibe` target can resolve through inherited `vibe.sidecarDir`. Unselected wildcard alternatives do not create a literal `./*` entry when TypeScript has selected the concrete declaration subpaths. Discovery retains an unavailable result if an alternative exposes additional source-only names or another selected surface it cannot represent. A `*` in a literal root target is not a subpath pattern. Source and runtime wildcard targets
map to their emitted declarations; CSS and WebAssembly exports have no declaration
surface. JSON exports retain their `resolveJsonModule` types.
Separate import and require type conditions are checked separately. Explicit `resolution-mode` attributes on type imports are retained in both the probe resolver and the dependency-equivalence proof; two uses of one specifier may select different package conditions. Private
files do not become entry points. A bare directory without publishing metadata
compares each declaration module, suitable for sidecars and their TypeScript
twins. Resolution uses each file's nearest `vibe.config.json` or
`tsconfig.json`, including inherited options and `vibe.sidecarDir`.
Moved sidecars are read at their logical beside-source paths without writing
to either input tree. Imports in a projected sidecar resolve from the physical
mirror file, matching the compiler-emitted specifiers and stock TypeScript.
An existing beside-source declaration takes precedence over a stale mirror. An unresolved public declaration or exported dependency
makes the comparison unavailable.

Types are compared by a generated TypeScript program using the strict
conditional-function identity helper in both directions, with `typeof` for
values. Classes include their instance and static sides, namespaces include
type-only members, and generic aliases retain their constraints and defaults. A namespace re-export that shares its name with a generic type alias resolves its members through the original module, preserving both meanings. Variance annotations remain on the original exported types; generated function bridges omit the class/interface-only `in` and `out` modifiers.
Generic aliases of global library types are instantiated through their published names in the probe. The checker never appends exports to a global script such as `lib.es5.d.ts`, which would remove its declarations from the global environment.
Corresponding nominal declarations in the two snapshots share virtual identity
keys, so unchanged private classes, enums and `unique symbol` keys compare as
one API despite their different snapshot paths. Private getters, setters and
methods retain their inferred types when declaration emit elides annotations;
a getter/setter pair contributes one visibility marker on its instance or static
side. Leading `/// <reference path="..." />` and `/// <reference lib="..." />`
directives stay ahead of nominal imports, so referenced ambient declarations
and standard-library types remain in the comparison.
Adding, removing or renaming a private member still changes nominal
identity. Their member types, visibility and enum values remain part of the
generated type checks. Identical deferred
`infer` and mapped types share a virtual module only after proving their complete
resolved dependency closures equivalent, including cycles and `import = require(...)` edges. The proof ignores declaration import/member order and equivalent type-import spelling; overload order and distinct external nominal origins remain significant. Only the module argument of an `import()` type is a dependency edge; literal
generic arguments keep their type meaning, even when they resemble module paths.
This preserves identity for copied generic functions such as `makeEventGroup`.
Imports of ambient modules such as `node:stream` follow the declaration sources
that TypeScript selected, including their dependencies. Their module names stay
in the proof because different ambient modules can share one declaration file.
A missing module remains unresolved and cannot establish equivalent closures.
A changed dependency
invalidates that proof. Separate installations with the same package name and
version remain separate until proved equivalent. Peer-qualified pnpm store slots
retain their installation context in ambient keys and dependency origins.
Several peer variants of one package can coexist in a self-comparison without
being merged or reported as one ambiguous ambient origin. Dependency pair candidates
are seeded independently of entry syntax, so reordering entry imports preserves
unchanged external `unique symbol` types without hiding dependency changes. JSDoc is read through the TypeScript API, normalizing whitespace and retaining
tags. Inline `{@link ...}`, `{@linkcode ...}` and `{@linkplain ...}` comments
retain their targets, labels and rendering kinds when a private target resolves
in only one snapshot. Link formatting is normalized through TypeScript display
parts, including the boundary between a resolved target and its label.
Formatting, quotes, import order, equivalent module specifiers and
member order do not fail the check when TypeScript sees the same API.
Formatter tests may continue to compare bytes to test their formatting.

Ambient scripts, ambient module exports and `declare global` contributions stay
in the comparison. Each original snapshot is diagnosed independently before the
probe gives its globals and modules separate names. Default and named exports,
generic constraints, namespace types, documentation and ambient declarations
referenced by a published entry point remain observable. Corresponding nominal
classes, enums and `unique symbol` keys retain their shared virtual identities.
Changed global types and comments are compared through their isolated exports.
Ambient contributions are attributed by each isolated snapshot's actual source
closure. Being nested alone does not add one input's ambient declarations to the other.
Nominal origins use the most specific input root, preserving corresponding
private classes and real private-member differences in nested snapshots.
Global overloads retain each snapshot's declaration order, so changed inferred
results remain differences; reversing independent global imports stays identical.

Equal complete environments may share declarations after their syntax,
comments, source load order and every resolved dependency edge agree. This keeps
intrinsic array types in their original environment. External module
augmentations still require equivalent isolated ambient closures and comments.
An unproved external augmentation makes the comparison unavailable with exit
status `2`; it cannot silently pass or count as an API difference.

The reusable synchronous API is
`compareApiIdentity(ts, beforeDir, afterDir, options)` from
`scripts/api-identity.mjs`. It returns `identical`, `nameDifferences`,
`typeDifferences`, `docDifferences`, `environmentDiagnostics` and
`comparisonComplete`. `identical` is true only after a complete comparison.
Each environment record has a `blocking` flag. Callers with an existing published
surface snapshot can supply `beforeEntrypoints` and `afterEntrypoints`,
maps from subpath/condition names to declaration paths relative to each tree.
`compilerOptions` carries the package's stock TypeScript resolution settings.
The virtual probe stays inside an explicit `rootDir`, or the configuration
directory when `composite` supplies the default root. All original project
options and genuine outside-root source diagnostics remain in force.
The checker chooses an unused virtual filename without writing to the input.
External library diagnostics are retained as environment records. A missing
type used by a compared export blocks the comparison, including when reached
through an external dependency; unrelated library defects do not block it.
An explicit `skipLibCheck` cannot turn invalid owned declarations into a
successful comparison. Type differences include `mutuallyAssignable`, measured by a second
two-way assignability probe. Strict differences always fail, even when this
additional result is `true`.
`loadTypeScript()` loads the pinned compiler API; `formatResult(result)`
prints the three lists.

Run `smthrs test //:api-identity-test`, or
`node --test scripts/api-identity*.test.mjs`, for the regression corpus and
the property that harmless rewrites pass while a semantic mutation fails.

Migration snapshots can also supply `beforeResolutions` and
`afterResolutions`: arrays of `[declarationFile, moduleSpecifier, targetFile]`
recorded while the original package metadata was available. The checker then
resolves those edges inside each frozen declaration tree, including package
aliases, instead of reading changing source files in the working package.

The standalone migrate flow includes generated copies of the checker under
`.smithers/flows/migrate/lib/`. Edit the canonical `scripts/` sources, then run
`node scripts/sync-api-identity.mjs --write`. Both `docs:check` and
`//:api-identity-test` check their freshness so a staged flow keeps the same
implementation without depending on files outside its stage.

Published JSON assets, including wildcard targets, stay in the comparison. They
use stock TypeScript's `resolveJsonModule` types and value widening: changing
a number to another number preserves its type, while changing it to a string
does not. The checker reads the inherited project setting, enables JSON for
declaration-only snapshots without configuration, and accepts an explicit
`compilerOptions.resolveJsonModule` override. Invalid JSON is an unavailable
comparison, reported through `environmentDiagnostics`, without type differences.

Comparison exceptions, including a stack overflow, return an invalid result:
`comparisonComplete: false` and `identical: false`, with a blocking environment
diagnostic. The `failure` record identifies the stage, elapsed milliseconds and
process memory use. The CLI prints the same result with `--json` and exits `2`.
A failed comparison supplies no type-difference verdict.

The CLI runs its comparison in a child with a `2 GiB` V8 heap limit. A fatal
allocation failure, a signal or an empty successful exit is an invalid receipt,
printed as JSON with `--json` and exit `2`. The receipt records the child's
signal, exit status and diagnostic byte count. Imported callers can use
`compareApiIdentityInWorker(ts, before, after, options)` for the same isolation.

Large surfaces use fresh TypeScript checkers with at most `8` type probes per batch.
Input diagnostics are collected once; batches check their generated probes.
Resolution and unchanged source parsing are reused. The synchronous API accepts
`probeBatchSize` as a positive safe integer for comparison controls.
Export documentation and erroneous-type walks use explicit worklists, so deeply
nested exported objects do not consume the JavaScript call stack. Proven equal
module closures reuse documentation only when their attached comments also agree.
Use `--profile` to record stages, elapsed time, batch offsets and memory use.

Published entry points are processed in groups of at most `8`, so earlier input
programs can be collected before the next group starts. `entryBatchSize` accepts
a positive safe integer for batch-invariance controls. All name, type, comment
and environment records are combined; one incomplete group makes the whole
comparison unavailable, even if every other group is identical.

Preparation passes virtual declaration text and serialized diagnostic/comparison
records to a separate probe phase. Its input `Program` and `TypeChecker` can
be collected before probe checkers allocate their own type relations.
This also applies to a single entry point with many generic instantiations.

Input diagnostics also use fresh groups of eight source files (the internal
`diagnosticBatchSize` option controls this for qualification). Every group
keeps the complete program roots, compiler options and global environment.
All source diagnostics remain in the receipt, including unrelated dependency
errors; only plain records survive a group. Profiling records
`diagnosticOffset`, `diagnosticCount` and `totalDiagnosticFiles` so a stalled
validation stage can be located without logging declaration contents.

An invalid entry group stops the comparison immediately. Its blocking
diagnostics remain available even if a later group would exhaust resources.
Such receipts have `comparisonComplete: false`: their lists cover attempted
groups only and cannot establish API identity. An ordinary API mismatch remains
a complete comparison and continues through the remaining names, types and
comments.

## Declarations absent on both sides

The checker reads emitted declaration trees, so it cannot see why a
declaration is missing. A caller whose emit failed for some files passes
`absentDeclarations`: `{ before: { "<path>.d.ts": [diagnostic] }, after: { ... } }`,
with paths relative to each snapshot and each diagnostic recorded as
`{ code, file, line, column }` from that side's declaration emit, such as
`TS7056` or `TS2883`.

| Listed declaration | Result |
| --- | --- |
| Missing on both sides, same nonempty set of codes and source locations | Compares equal. As an entry point, it has no program root and no result. |
| Missing on both sides, different diagnostics or evidence for one side only | Never equal. As an entry point, it is unavailable on its own (`export: "*"`). |
| Present on either side | A blocking error for the whole group: a one-sided absence never compares equal. |

`result.absentDeclarations` records each listed declaration with `equal` and
its reason. References into a missing declaration fail alike on both sides:
`TS2307` at the import, or `TS2305`, `TS2694` and related codes for a name a
module would re-export from it through `export *`. Those diagnostics stay in
`environmentDiagnostics` with `blocking: false` and `absentDeclaration` only
when each file's failed references (code, target module and name) are the same
in both snapshots. Otherwise the group stays unavailable, so a candidate that
drops `export * from "./missing"` cannot pass.

An export whose declarations reach a missing declaration, through an import
binding that resolves to nothing, an unresolved qualified name, an import type
or an owned local declaration, has no probe. It is reported as a blocking
environment record with `scope: "export"`, its entry point, its export name,
`absentDeclarations` and the reason. Its type cannot be compared: a candidate
that changes `{ a: Platform; b: string }` to `{ a: Platform; b: number }` is
unavailable, not identical. Every other export is still compared, and an
export-scoped record does not stop later entry groups. Such a receipt has
`comparisonComplete: false` and `identical: false`, and keeps the type
differences of the exports it did compare. A blocking record without
`scope: "export"` still makes its whole group unavailable and clears the
receipt's type differences.

The checker does not model a missing module's exports. Their own API belongs
to the package that failed to emit them; their names are not compared, even
when their source differs between the snapshots. The t3code corpus pair
`scripts/api-identity-corpus/t3code-absent-on-both-sides.json` keeps the mobile
(`TS2883`) and server/contracts (`TS7056`) shapes.

Project `noUnusedLocals` and `noUnusedParameters` checks apply to the original
input programs. They are disabled only for the synthetic probe program, whose
private helper aliases and imports are not part of the package. Real unused
input diagnostics remain blocking; ordinary export type differences remain
visible under either setting.

The comparison always forces `noCheck: false`, alongside its strict type
relation settings. A project's emission shortcut cannot turn unchecked
identity assertions into a proof or suppress an invalid exported input type.

Migration snapshots retain their original publication manifest, declaration
aliases and logical output paths in `public-surface.json` (`snapshotVersion: 3`).
The API comparison reconstructs a temporary package from stored declarations;
source/runtime aliases forward to those declarations, including default and
`export =` modules. Publication subpaths and conditions retain their names.
The migration adapter uses the shared supervised worker and retains its resource limits.
The opt-in `includeComparedFiles` receipt records TypeScript’s actual input closure
for private-addition and unproven-module attribution, including file shadowing.
Legacy metadata is refreshed from the saved setup commit. Missing evidence or
an unavailable type probe is an environment failure. Earlier sidecars are
compared in a complete dependency tree; missing outputs remain explicit receipts,
and an unavailable probe cannot establish a new setup baseline. Formatting receipts in
`excusedSpecifiers` describe spelling changes without deciding API identity.

Go declaration fuzz oracles pass complete emitted module trees to the same
checker. Relative aliases and dependencies resolve within each snapshot;
formatting, member order and equivalent import spelling do not fail a
semantic declaration oracle. Dedicated formatting tests retain byte checks.

If a generated assertion reaches `TS2589`, the checker resolves its actual
operands through the same TypeScript checker. When both are the exact same
non-error `Type` object, reflexivity establishes identity independently of
the redundant assertion. Generic bridge operands are checked in full, so
erased generic bodies cannot hide changed constraints. Input diagnostics,
error taint, export names and documentation remain checked. Profiling records
each recovered assertion as `probe-reflexive-type`; every other depth error
remains invalid.

Generic type bridges are reused only for the same declaration in an already
proven equivalent complete module closure. Their key includes the canonical
module and full namespace path, so equal leaf names cannot merge different
generic constraints. Reusing the original bridge also lets exact TypeScript
type identity prove reflexive recursive generic comparisons. Input errors
and documentation remain checked independently.

The Go counterpart oracles use the same API rule for bare declaration trees and published packages. Changed export documentation is a difference; whitespace-only JSDoc changes are not. An unpublished declaration outside a package's `types` entry does not change that package's API.

A complete resolved module-closure proof can establish that both bindings name
the same canonical module export. Those exports need no generated type
assertion or generic bridge. Original input diagnostics and error taint remain
checked, and namespace traversal still compares every name, meaning and doc
comment. Other bindings retain strict bidirectional TypeScript probes.
Snapshot-specific ambient references keep their independent comparisons.
Profiling reports `export-comparison-plan` with `sharedExportProofs` and
`structuralProbes` to distinguish validation work from comparison work.
## Codemod fuzz contract probes

The separate Go codemod fuzz oracle checks callable contracts in emitted
declarations, including private callables referenced by exported types. In
external-module declaration copies, it gives named callables fresh exported
ambient constants typed with `typeof` solely for the assignability probe. These
constants preserve implicit ambient exports; adding an export list would make
other ambient declarations private. It retains the original declaration
files, keeps default exports on their native path, avoids alias collisions,
and leaves global scripts in their original scope. An unchanged private
callable must compare equal to itself; a changed private signature must still
fail assignability.


