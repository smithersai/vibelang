# forkpatch — carrying the TypeScript extension and grammar deltas

`compiler/forkpatch` carries changes to files owned by the pinned TypeScript
fork. The Go build overlay can add whole Go files, but only an ordered patch
series can modify the upstream parser, AST, binder, checker, printer, generated
sources, and tests.

The existing grammar delta is declarations in conditionals,
`if (const x = f(); cond)`. A separate generalized resolver extension makes
registered content-mapper suffixes participate in implicit module lookup.
The patch series contains five patches:

```text
compiler/forkpatch/
  forkpatch.mjs
  series.json
  summaries.json
  patches/
    0200-content-mapper-extension-resolution.patch handwritten
    0300-if-conditional-declaration-grammar.patch  handwritten (+89 / -9)
    0800-regenerate-ast.patch                      generated   (+32 / -20)
    0900-vibelang-grammar-tests.patch              fork-owned (+199)
    0950-content-mapper-resolution-tests.patch     fork-owned
  forkpatch.test.mjs
```

`0200` consults the existing registered-extension list after TypeScript and
declaration candidates, before JavaScript fallback. It preserves registration
order, explicit-TypeScript lookup and Node ESM's explicit-extension rule; it
contains no `.vibe` special case and changes no parser or AST. `0950` tests it
with unrelated registered suffixes, output aliases, precedence and directory
indices.

`0300` contains the `.vibe` dialect gate and the handwritten parser, AST,
binder, checker, and printer work. `0800` is derived exclusively from that
handwritten grammar patch. `0900` pins the survivor's parser/printer shape,
scope, narrowing, checker reachability, unused-local ownership, and dialect
gate. Patch order is lexical and is also apply order.

## Integrity contract

`series.json` pins:

- the upstream revision;
- the ordered patch files and their SHA-256 digests;
- the pre-image digest of every touched upstream file;
- the post-image digest of every touched or created file;
- the generated-file list and fork-created-file list.

The driver classifies a checkout as `pristine`, `applied`, or `mixed`.
Every mutating command first checks the revision, materialized sparse-checkout
paths, file digests, and `git apply --check`. A mixed or dirty checkout is a
hard failure.

```bash
node scripts/prepare-typescript-fork.mjs --cache /tmp/fork --full-tsc
node compiler/forkpatch/forkpatch.mjs apply   --checkout /tmp/fork/<revision>
node compiler/forkpatch/forkpatch.mjs status  --checkout /tmp/fork/<revision>
node compiler/forkpatch/forkpatch.mjs unapply --checkout /tmp/fork/<revision>
```

`status`, `apply`, and `unapply` are offline and require only Git.
`unapply` reverse-applies in reverse order, deletes files created by the
series, and requires the result to be byte-identical to the pinned revision.

## Regenerating 0800

The generated patch must never be edited to imitate a grammar change. Starting
from a pristine checkout:

1. Apply and stage `0300`.
2. Run the pinned AST generator:
   ```bash
   node --experimental-strip-types --no-warnings ./tools/scripts/tsc/generate.ts
   ```
3. Run the independent Kind stringer and formatter:
   ```bash
   go tool golang.org/x/tools/cmd/stringer \
     -type=Kind -output=kind_stringer_generated.go ./tsc/internal/ast
   dprint fmt tsc/internal/ast/kind_stringer_generated.go
   ```
4. Capture only the unstaged generated diff as
   `0800-regenerate-ast.patch`.
5. Stage it, add the fork-owned survivor tests, and capture those as `0900`.
6. Update `summaries.json`, then record from a genuinely pristine checkout:
   ```bash
   node compiler/forkpatch/forkpatch.mjs record --checkout <checkout>
   ```

The current upstream generator requires Node 22.18 or newer, `tinyexec@1.3.0`,
and the repository-pinned `dprint@0.56.1` with its locked npm plugins.
`kind_stringer_generated.go` is not produced by
`generate.ts`; omitting the stringer step fails the Go build.

Verify that the derived patch is exact:

```bash
node compiler/forkpatch/forkpatch.mjs verify \
  --checkout <applied-checkout> --regenerate
```

## Review and test checklist

- `series.json` lists `0200`, `0300`, `0800`, `0900`, and `0950` in that order.
- Handwritten patches do not touch generated files.
- `verify --regenerate` produces no diff.
- `status` reports `state: applied` and `divergentFromApplied: 0`.
- `unapply` returns a clean, byte-identical upstream tree.
- Reapplying returns the exact post-image.
- The fork-owned checker and printer tests pass.
- The complete upstream `tsc` test suite has the same package and subtest
  inventory as a pristine checkout.

Mechanism tests can exercise a real checkout when one is supplied:

```bash
VIBELANG_FORKPATCH_TEST_CHECKOUT=<checkout> \
  node --test compiler/forkpatch/forkpatch.test.mjs
```

A future grammar proposal must be a separate, specification-authorized change.
It gets a new handwritten patch before `0800`, followed by a full regeneration,
re-record, round-trip check, and upstream-parity run.
