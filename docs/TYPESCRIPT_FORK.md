# Vendored TypeScript fork

VibeLang's compiler base is the `smithersai/TypeScript` fork. The production
plan is to vendor a pinned snapshot at `vendor/typescript` with a squashed Git
subtree, keeping compiler source in every VibeLang checkout without a submodule
or implicit network dependency. That subtree has not yet been imported.

The fork repository now exists and `typescript-fork.json` pins its exact
40-character revision. The full subtree is not present in this working tree;
the executable bridge POC uses a sparse external checkout of only `tsc`.

> **Source-checkout note:** npm ships this provenance document, but it does not
> ship the repository-only preparation scripts, Go bridge, or future vendored
> subtree. Commands below are maintainer operations for a source checkout.

## Why the fork is required

The TypeScript Go compiler is a nested module under `tsc/`, and its useful
compiler packages are under `tsc/internal`. Go only permits packages within the
parent `tsc` module path to import those packages. VibeLang's parser, checker,
lowering, emitter, and language-service integration must consequently be
implemented behind a narrow extension interface inside the fork.

The production layout remains:

```text
vendor/typescript/             pinned smithersai/TypeScript source
  tsc/                         upstream Go module
    cmd/vibec/                 VibeLang compiler entry point (planned)
    internal/vibelang/         narrow fork-owned extension seam (planned)
compiler/                      stable root transport/API contracts
cmd/vibec-go/                  current dependency-free transport scaffold
```

The root module must not copy TypeScript internals or use `replace` directives
to bypass that boundary. It will invoke the fork-built compiler through the
process protocol represented by `compiler` until the fork exposes a more
suitable stable boundary.

## Executable bridge POC

`compiler.NewPinnedFork` now proves that boundary against the exact manifest
revision. It verifies a clean `tsc` tree and uses Go's build overlay support to
compile a small alternate `cmd/tsc` entry point from `compiler/forkbridge`.
The overlay is materialized only in a cache directory; no tracked or untracked
files are written into the TypeScript checkout.

The bridge runs `.vibe` through the fork's real content-mapper, Program,
diagnostic, and emitter code. Upstream intentionally suppresses runtime
JavaScript output for content-mapped source because the external mapper/build
tool owns it. The POC honors that boundary and then owns the mapping back to
authored positions itself: it composes the emitting Program's source maps with a
per-file authored-to-lowered map, so every artifact maps to authored `.vibe`
positions. In identity mode that map is a synthesized per-line identity map; in
external mode the frontend supplies a real one. Lowered spans with no authored
origin stay unmapped rather than being attributed to a guessed position, and
composed maps deliberately carry no `names` entries. Relative `./x.vibe`
specifiers in emitted runtime JavaScript are rewritten to `./x.js` (declarations
keep `./x.vibe` beside their `x.d.vibe.ts` naming). See `compiler/README.md` for
the exact proof and its limits.

Multi-file root sets are supported through both the Go API and the CLI: several
`.vibe` and `.ts` roots with relative POSIX paths, including subdirectories,
whose relative imports resolve in the checked and the emitting Program. Every
project file must be listed in the request; the bridge does not read imports
from disk, and artifact-name collisions are rejected fail-closed.

### Externally lowered input

The transport is `compiler.APIVersion` 2. `CompileRequest.Lowering: "external"`
switches the bridge to the mode where an external frontend — the JavaScript POC
frontend is the intended producer — has already lowered every `.vibe` file. Each
`.vibe` source then carries its authored text plus a `LoweredSource`: the
generated TypeScript and a version-3 source map from the authored file to it.
That supplied map is validated exactly on both sides of the process boundary
(strict field set, version 3, sources naming exactly the authored file,
`sourcesContent` matching the authored text when present, decodable VLQ
mappings, in-range indices, in-bounds positions); a violation is a structured
lowering diagnostic, never a silent fallback. Diagnostics map back to authored
`.vibe` spans through the supplied map.

`vibec-go --request request.json` submits one full `CompileRequest` JSON value
(in-memory files, options, lowering mode) instead of positional disk roots — the
producer contract for that external frontend. Unknown fields, trailing JSON, or
an unreadable file are usage errors (exit 64) before any backend is prepared.

None of this changes the vendoring status: the bridge still builds from a sparse
external checkout through a build overlay, and the cached binary is not signed
or independently attested. It is a development POC, not a vendored subtree and
not a production supply-chain boundary.

Use an existing checkout without network access:

```sh
node scripts/prepare-typescript-fork.mjs --source /path/to/checkout
```

Or explicitly request a sparse, revision-addressed fetch:

```sh
node scripts/prepare-typescript-fork.mjs --fetch --cache /path/to/cache
```

The helper never fetches unless `--fetch` is present, and both the helper and
Go constructor reject stale, dirty `tsc`, or differently pinned sources. This cache
path is a development POC, not a replacement for the reviewed production fork
and release-binary provenance described below.

After preparing a checkout, the backend is also available through the actual
Go compiler command rather than only a Go API or test:

```sh
go build -o /tmp/vibec-go ./cmd/vibec-go
/tmp/vibec-go \
  --fork-checkout /path/to/checkout \
  --fork-cache /path/to/compiler-cache \
  main.vibe
```

Compile attempts return structured diagnostics/artifacts as one `CompileResult`
JSON object on stdout. Successful emit exits zero; compile, infrastructure, or
timeout failure exits one; the unselected scaffold exits two; usage errors exit
64 without JSON. These codes apply to the built binary; `go run` itself masks
nonzero child codes as exit one and adds its own stderr. Flags must precede root
names, and the cache must not overlap the checkout. Selection is explicit and
fail-closed; it never falls back to the JavaScript compatibility compiler.

## Initial import

1. Confirm the commit in `typescript-fork.json` resolves in the fork.
2. Commit all current VibeLang work; subtree operations require a clean tree.
3. Run `npm run typescript:fork:status`.
4. Run `npm run typescript:vendor`.

The last command imports the pinned source and creates a subtree commit. It
refuses to replace a partial `vendor/typescript` directory.

## Updating the fork

Make compiler changes in `smithersai/TypeScript`, keeping the fork's delta
small and reviewable. Merge or rebase the upstream changes there, run the
fork's test suites, and obtain the full 40-character fork commit. Then:

1. Change `revision` in `typescript-fork.json` and commit that lock update.
2. Run `npm run typescript:vendor` from the clean worktree.
3. Run `npm run typescript:fork:verify` and the VibeLang test suites.

Do not patch `vendor/typescript` directly in this repository. Land a patch in
the fork first, then refresh the subtree so fork and vendored history cannot
drift.

## Packaging and licenses

The vendored source remains repository-only; it is not copied wholesale into
the npm tarball. Release packages should eventually contain compiler binaries
built from the pinned revision plus the existing JavaScript compatibility API.
The fork must preserve TypeScript's upstream license and notices inside its
vendored tree.
