# Published declaration identity

Run `node scripts/api-identity.mjs --before <dir|package> --after <dir|package>`
from the checkout, adding `--json` for machine-readable output. Install the
pinned stock TypeScript compiler API with
`(cd docs/tools && bun install --frozen-lockfile)` first. The checker reads
both inputs without writing to them.

The command reports three lists: exported-name differences, type differences
with the generated probe's `tsc` diagnostic, and doc-comment differences.
Exit status `0` means all three are empty; `1` means a difference or an
invalid declaration input; `2` means the checker could not run.

Package inputs use `package.json`'s `exports` subpaths and `types` conditions.
Separate import and require type conditions are checked separately. Private
files do not become entry points. A bare directory without publishing metadata
compares each declaration module, suitable for sidecars and their TypeScript
twins. An unresolved public declaration or dependency fails the check.

Types are compared by a generated TypeScript program using the strict
conditional-function identity helper in both directions, with `typeof` for
values. Classes include their instance and static sides, namespaces include
type-only members, and generic aliases retain their constraints and defaults.
Corresponding nominal declarations in the two snapshots share virtual identity
keys, so unchanged private classes, enums and `unique symbol` keys compare as
one API despite their different snapshot paths. Their member types, visibility
and enum values remain part of the generated type checks. JSDoc is read through the TypeScript API, normalizing whitespace and retaining
tags. Formatting, quotes, import order, equivalent module specifiers and
member order do not fail the check when TypeScript sees the same API.
Formatter tests may continue to compare bytes to test their formatting.

The reusable synchronous API is
`compareApiIdentity(ts, beforeDir, afterDir, options)` from
`scripts/api-identity.mjs`. It returns `identical`, `nameDifferences`,
`typeDifferences` and `docDifferences`. Callers with an existing published
surface snapshot can supply `beforeEntrypoints` and `afterEntrypoints`,
maps from subpath/condition names to declaration paths relative to each tree.
`compilerOptions` carries the package's stock TypeScript resolution settings.
`loadTypeScript()` loads the pinned compiler API; `formatResult(result)`
prints the three lists.

Run `smthrs test //:api-identity-test`, or
`node --test scripts/api-identity.test.mjs`, for the regression corpus and
the property that harmless rewrites pass while a semantic mutation fails.
