# Published declaration identity

Run `node scripts/api-identity.mjs --before <dir|package> --after <dir|package>`
from the checkout, adding `--json` for machine-readable output. Install the
pinned stock TypeScript compiler API with
`(cd docs/tools && bun install --frozen-lockfile)` first. The checker reads
both inputs without writing to them.

Exports named with keywords, such as `await`, are compared through local type-only import aliases. This also applies to namespace re-exports; a type change still produces a normal type difference.

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
Wildcard-condition fixtures select `lib.es5.d.ts` in native validation
and API comparison, and reject unrelated browser libraries. Native consumers
retain selected declaration types and missing-library errors. All twenty-four
generated resolution cases, module modes, source-only branches, exclusions
and selected-type mutations remain required.

Export-fallback fixtures select `lib.es5.d.ts` in native validation and API
comparison, and reject unrelated browser libraries. Native consumers retain
the selected fallback's type and missing-library errors. Ordered resolution,
custom conditions, unreachable and selected mutations, and all twenty-four
generated discovery cases remain required.

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
Peer-context fixtures select `lib.es5.d.ts` in native validation and API
comparison, and reject unrelated browser libraries. Actual peer-qualified
resolution, distinct nominal types, copied and self comparisons, changed-peer
negatives and twelve generated samples remain required.

Generic aliases of global library types are instantiated through their published names in the probe. The checker never appends exports to a global script such as `lib.es5.d.ts`, which would remove its declarations from the global environment.
Corresponding nominal declarations in the two snapshots share virtual identity
keys, so unchanged private classes, enums and `unique symbol` keys compare as
one API despite their different snapshot paths. An exported `unique symbol`
also keeps its identity when it moves to a private module and is re-exported
under the same public path, including an aliased local name. Distinct exported
symbols stay distinct; splitting or merging their aliases remains a type
difference. The keyed member types and authored documentation still have to
match. Private getters, setters and
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
tags. Namespace re-export aliases follow the target declaration for prose,
tags and authored block counts, retaining documentation when a declaration
moves behind a private re-export. Changed or missing authored comments still
fail. VIP-27 permits one difference in twin-to-emitted order: adding the generated
`@throws {never}` on a callable without an authored throw contract. Each
overload may gain its own tag. Authored throw tags, prose and every other
JSDoc tag remain observable; a changed or removed authored tag, duplicate
generated tags, a tag description or a tag on non-callable data fails.
Merged self-namespace fixtures select `lib.es5.d.ts` in native validation
and API comparison, and reject unrelated browser libraries. Native module
options, self comparisons, type, value, name and documentation mutations,
and four generated samples remain required.

Callable parameter and return signatures keep their own documentation in the comparison, including inline function types. The compiler’s migration-fixture Go test uses this same gate while retaining its unannotated stock-twin goldens.
This implements Will’s 2026-11-04 answer: “Yes this is normal that it doesn't
exactly match”. Inline `{@link ...}`, `{@linkcode ...}` and `{@linkplain ...}` comments
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

Semantic declaration oracles use one bounded Node worker per test phase or fuzz target. Within each pinned
worker, an optional `dependencyDiagnosticsCache` retains at most 16 diagnostic
receipts, keyed by the full ordered dependency text, module formats, resolved
edges and compiler options. Owned declarations, option and global diagnostics,
and every name, type and documentation probe still run for every input.
Owned scripts, global or module augmentations, namespace exports and dependency
imports back into either snapshot bypass reuse. Changed dependencies or
resolutions cannot reuse an earlier receipt, including an earlier error.
The fuzz worker also uses TypeScript’s document registry for dependency declaration syntax trees. It retains at most 1,024 documents and 32 MiB of declaration text per worker, keys versions by complete text and compiler settings, and preserves the actual module format. A changed dependency clears the registry before acquiring its new version. Owned and virtual declarations remain fresh; no checker or program survives a comparison. Cold-versus-warm controls cover dependency edits, documentation, module format and augmentation isolation.

`FuzzDeclarationIdentity` compares emitted bytes first and runs this worker only on trees that differ. Identical bytes declare the same names, types and JSDoc, and about nine seeds in ten emit identical trees. The stock baseline runs `tsc --singleThreaded` with garbage collection off below 1 GiB, because each compile is short and every process is charged to the target's CPU budget.

The ordinary CLI and migration calls keep the default gate behavior.
Workers are replaced after 128 completed requests; crashes and cancellations
fail the input without retrying it. Worker cleanup precedes CPU-budget
accounting so child CPU remains included. Unit-test workers stop before a fuzz budget window opens. Each scope reports worker probes, failures, dependency-cache hits and child CPU without source payloads.

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

Generic global alias fixtures select `lib.es5.d.ts` for native validation
and API comparison, and reject unrelated browser libraries. They retain
strict input diagnostics, unchanged alias identity, changed-alias differences
and all four generated layouts across the supported ES5 generic aliases.

The ambient overload-order fixtures select `lib.es5.d.ts` in native validation
and API comparison, and reject unrelated browser libraries. The isolated
overload results, changed-export comparison and four generated samples remain
required.

JSON discovery fixtures select `lib.es5.d.ts` and guard against loading unrelated
browser libraries. They retain real wildcard entry points, scalar roots,
invalid JSON and inherited settings, with explicit overrides, export mutations
and controls for missing declaration libraries.

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
Use `--profile` to record stages, elapsed time, batch offsets and memory use. The bounded-heap scale tests enable these records in their child processes and retain them when a probe fails, alongside its process error, signal, exit status, elapsed time and configured budgets. Successful probes still require a complete, identical receipt.

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

The checker does not model a missing module's exports. Without a saved source,
their own API belongs to the package that failed to emit them; their names are
not compared, even when their source differs between the snapshots. The t3code corpus pair
`scripts/api-identity-corpus/t3code-absent-on-both-sides.json` keeps the mobile
(`TS2883`) and server/contracts (`TS7056`) shapes.

### Comparing an absent module from its source

`TS7056` means the emitter refused to write a type, not that the type is wrong.
So `recordDeclarationSurface` saves the source of each absent module under
`.migrate-absent-sources/` and lists it in `apiMetadata.absentSources`. A later
record without emit diagnostics keeps the saved source, and fills it in from the
tree for a snapshot that lacks it.

When both snapshots saved a module's source, the projection places that source
at its package path, so the importers' `TS2307` is gone and the checker reads
the module's real types without serializing them. The export is compared like
any other:

| Case | Result |
| --- | --- |
| A type changed inside the module | A type difference on the export that reaches it. |
| A name added to or removed from the module's entry point | A name difference. |
| A class of the module | Keeps its nominal identity across the snapshots. |
| An error in the module's body | Blocking, as for any input file. |
| Source saved on one side only | Neither side is projected; the rules above apply. |

In a package without `exports`, where every module is an entry point, the saved
module is an entry point too. In a package with `exports`, it counts through the
entry points that reach it, as a private module does.

`result.absentDeclarations` marks such a record with `comparedFromSource: true`.
Its `equal` field still reports the emit diagnostics, but it decides nothing:
the source comparison is stronger than equal reasons.

A snapshot frozen before this rule has no saved source, so its exports stay
unavailable until it is recorded again. `.vibe` modules save no source, because
their sidecar is exempt from `TS7056`.

## Generic aliases that use `infer`

`tsc` never calls two `infer` declarations identical. An unchanged
`type Inner<R> = R extends Box<infer A> ? A : never` therefore fails strict
identity when its file is not proved equal, and so does every generic export
that mentions `Inner<T>`. Mutual assignability cannot settle it, because a branch
changed to `any` stays assignable both ways.

Nominal alignment handles a top-level generic alias with `infer` when both sides
have it at the same path with the same type parameters. Each side states the
alias in a form without `infer`:

```ts
// R extends Box<infer A> ? A : never
<R>() => (<A>() => R extends Box<A> ? A : never)
```

A signature's own type parameters compare by position, so the strict probe of
these forms is the proof, reported as a type difference on the alias. The after
side's alias then forwards to the before side's, so instantiations and generic
exports over it see one alias. An alias whose type parameters differ keeps the
ordinary strict probe. `infer` written directly in an exported function's
signature is not covered and fails strict identity.

## Error types in an export's closure

An error type compares as `any`, so a strict identity probe passes vacuously
on it. Every compared export is walked for error types, whatever else the
program reports: one export's verdict never depends on diagnostics elsewhere
in the batch. A hit is a blocking record, "Compared export depends on an
unresolved or erroneous type".

The walk stops at a closed declaration outside both snapshots, such as a
package under a `moduleRoots` directory. That file is one physical declaration
on both sides, so an error inside it cannot tell them apart. This covers a
`// @ts-ignore`d optional peer in Vite's `UserConfig`, and a `TS7016` in a
dependency reached by another entry point. The boundary has three limits:

| Case | Result |
| --- | --- |
| Instantiated shared generic, such as `Box<Owned>` | Walked: its arguments belong to a side. |
| Shared interface with an owned module augmentation | Walked: one of its declarations belongs to a side. |
| Sides reach different shared declarations, or the same ones in a different order | Walked from the first difference: an error there can hide the change. |

An export that is one symbol on both sides, re-exported from a shared file, is
not walked. A package under a snapshot's own `node_modules` belongs to that
side and is walked. Prefer this failure to a false pass: reordering union
members around a shared declaration that contains an error fails the export.

The corpus pair `scripts/api-identity-corpus/t3code-unrelated-diagnostic.json`
keeps the t3code desktop shape.

A `.vibe` module's declaration is exempt from `TS7056`, because stock checkers
read its sidecar in place of its source, so its conversion compiles clean and
writes the type that `tsc` refuses to serialize. That declaration exists on one
side, and the source locations differ, so the module never compares equal. A
module whose original stops at `TS7056` stays TypeScript until the original
gets an explicit annotation: `client-runtime` `rpc/http` and `rpc/protocol`,
and `contracts` `rpc`, `environmentHttp` and `guestStream`, are the corpus
witnesses.

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
Logical paths may include `..` segments for sibling packages and scripts. The
projection mirrors package ancestors inside one isolated temporary directory,
so those declarations and their relative imports remain comparable. A path
outside that temporary directory is rejected. Mirrored `node_modules` links
remain read-only resolution inputs; stored declarations and aliases cannot
write through them. Type and documentation changes through sibling imports
still fail the comparison.
The migration adapter uses the shared supervised worker and retains its resource limits.

Provenance fixtures select `lib.es5.d.ts` in native validation and API
comparison, and reject unrelated browser libraries. Each snapshot independently
retains its selected dependency's native type and missing-library errors.
Private and shadowed-file mutations stay excluded, while selected-type
mutations remain visible across entry-point batches, including four generated
samples.

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




The dedicated target's cache inputs are declared in `api-inputs.ts` and
covered by real SDK key and replay fixtures. Unrelated compiler Go edits,
acceptance cases, user prose and generated site pages reuse its successful
result. Checker code, corpus, specification chapters, package sources,
staged copies, root JSON configurations and install declarations still invalidate it. See
[the build graph](build.md) before adding another repository input to an API
test.

The generated-tag exception also preserves authored JSDoc block counts: repeated prose blocks remain a difference even when TypeScript coalesces identical documentation text.
Within a comparison, the optional diagnostic path reuses the exact program supplied for the first original or normalized diagnostic group; later groups remain fresh. The fuzz worker materializes ambient documentation on demand for the same closure proof. Shared physical modules need no such proof; distinct closures still request their full documentation. Programs and checkers remain local to one comparison.



Error-taint checks reuse completed error-free type closures across exported
roots. Only a complete walk with no shared-declaration frontier or generic
instantiation can establish reusable intermediate results. Cycles still inspect
their whole reachable graph; incomplete or erroneous walks retain their
original root-specific result. Shared frontiers keep their declaration order,
and each generic instantiation retains its argument checks.
The `export-comparison-plan` profiling record reports `errorWalkTypes`,
`errorWalkCacheHits` and `closedErrorTypes` so repeated traversal can be
distinguished from input diagnostics and structural probes.

The global-augmentation migration fixture selects `lib.es5.d.ts` in native
validation and API comparison, and rejects unrelated browser libraries. It
retains native diagnostics, self and copied comparisons, and the changed-global
negative for the pinned compiler and the optional `API_IDENTITY_EXTRA_TS`
compiler.

Set `API_IDENTITY_EXTRA_TS` to a directory that resolves the requested
`typescript` package to check the global-augmentation fixture with an
additional compiler API. The fixture loads that package directly and reports
an `API_IDENTITY_EXTRA_TS` error if it cannot load or does not expose
`createProgram`. Run `node --test scripts/api-identity-extra-typescript.test.mjs`
for the compiler-selection controls.
