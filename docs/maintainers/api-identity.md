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
unreachable fallbacks are not extra entry points. Conditional objects also follow TypeScript's property order: an earlier matching `default`, `import` or `require` target can shadow a later `types` target. Discovery uses the same configuration and sidecar projection as the probes, so a published `.vibe` target can resolve through inherited `vibe.sidecarDir`. Source and runtime wildcard targets
map to their emitted declarations; JSON and asset exports have no type surface.
Separate import and require type conditions are checked separately. Explicit `resolution-mode` attributes on type imports are retained in both the probe resolver and the dependency-equivalence proof; two uses of one specifier may select different package conditions. Private
files do not become entry points. A bare directory without publishing metadata
compares each declaration module, suitable for sidecars and their TypeScript
twins. Resolution uses each file's nearest `vibe.config.json` or
`tsconfig.json`, including inherited options and `vibe.sidecarDir`.
Moved sidecars are read at their logical beside-source paths without writing
to either input tree. An unresolved public declaration or exported dependency
makes the comparison unavailable.

Types are compared by a generated TypeScript program using the strict
conditional-function identity helper in both directions, with `typeof` for
values. Classes include their instance and static sides, namespaces include
type-only members, and generic aliases retain their constraints and defaults. Variance annotations remain on the original exported types; generated function bridges omit the class/interface-only `in` and `out` modifiers.
Corresponding nominal declarations in the two snapshots share virtual identity
keys, so unchanged private classes, enums and `unique symbol` keys compare as
one API despite their different snapshot paths. Private getters, setters and
methods retain their inferred types when declaration emit elides annotations;
a getter/setter pair contributes one visibility marker on its instance or static
side. Adding, removing or renaming a private member still changes nominal
identity. Their member types, visibility and enum values remain part of the
generated type checks. Identical deferred
`infer` and mapped types share a virtual module only after proving their complete
resolved dependency closures equivalent, including cycles and `import = require(...)` edges. The proof ignores declaration import/member order and equivalent type-import spelling; overload order and distinct external nominal origins remain significant. A changed dependency
invalidates that proof. Separate installations with the same package name and
version remain separate until proved equivalent. Dependency pair candidates
are seeded independently of entry syntax, so reordering entry imports preserves
unchanged external `unique symbol` types without hiding dependency changes. JSDoc is read through the TypeScript API, normalizing whitespace and retaining
tags. Formatting, quotes, import order, equivalent module specifiers and
member order do not fail the check when TypeScript sees the same API.
Formatter tests may continue to compare bytes to test their formatting.

Global declarations and module augmentations can merge when both input trees
enter one TypeScript program. Before probing, the checker reads each tree in
isolation and proves the ambient declaration dependency closures equivalent,
including normalized JSDoc from their dependencies and the isolated ambient source load order. An unproved ambient change
makes the comparison unavailable with exit status `2`; it is never accepted as
identical or counted as a type difference. Unchanged ambient declarations and
doc-comment whitespace remain comparable. This conservative guard does not yet
classify changed global environments by export; a reordered ambient closure can remain unavailable even when its order is irrelevant to a particular export.


The reusable synchronous API is
`compareApiIdentity(ts, beforeDir, afterDir, options)` from
`scripts/api-identity.mjs`. It returns `identical`, `nameDifferences`,
`typeDifferences`, `docDifferences`, `environmentDiagnostics` and
`comparisonComplete`. `identical` is true only after a complete comparison.
Each environment record has a `blocking` flag. Callers with an existing published
surface snapshot can supply `beforeEntrypoints` and `afterEntrypoints`,
maps from subpath/condition names to declaration paths relative to each tree.
`compilerOptions` carries the package's stock TypeScript resolution settings.
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
