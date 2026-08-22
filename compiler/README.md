# Go compiler bridge POC

The executable POC sends `.vibe` source through the real parser, binder,
checker, content-mapper span machinery, and emitter in the exact pinned Go
TypeScript compiler. It does not vendor or copy TypeScript internals into this
module. Multi-file root sets with relative `.vibe` imports are first-class,
and an external frontend can supply pre-lowered TypeScript per `.vibe` file
whose source maps the bridge composes back to the authored text.

## Running the executable proof

An exact checkout can be verified without network access:

```sh
node scripts/prepare-typescript-fork.mjs --source /path/to/smithersai-TypeScript
VIBELANG_TYPESCRIPT_FORK=/path/to/smithersai-TypeScript \
  go test ./compiler ./cmd/vibec-go -count=1
```

If no checkout is available, an explicit sparse fetch caches only the fork's
`tsc` tree at the manifest revision:

```sh
node scripts/prepare-typescript-fork.mjs --fetch --cache /path/to/cache
```

Without `--fetch`, that command never attempts the network. Building the Go
bridge can still require Go 1.26 or module downloads if the local Go caches do
not already contain them; those failures return `ErrForkUnavailable` rather
than selecting another compiler.

Library callers opt in explicitly:

```go
backend, err := compiler.NewPinnedFork(ctx, compiler.ForkConfig{
    CheckoutDirectory: checkout,
    CacheDirectory: cache,
})
result, err := backend.Compile(ctx, compiler.CompileRequest{
    RootNames: []string{"main.vibe", "util.vibe"},
    Files: []compiler.SourceFile{
        {Path: "main.vibe", Kind: compiler.FileKindVibe,
            Text: "import { seven } from \"./util.vibe\"\nexport const answer: number = seven;\n"},
        {Path: "util.vibe", Kind: compiler.FileKindVibe,
            Text: "export const seven: number = 7;\n"},
    },
})
```

`NewPinnedFork` verifies the checkout's exact Git revision, requires a clean
`tsc` tree, checks the nested Go module identity, and handshakes with the built
binary. It uses `go build -overlay` to replace the upstream `cmd/tsc` entry
point at build time, so it neither patches the checkout nor imports Go
`internal` packages across their visibility boundary. The generated binary is
cached by revision and bridge-source digest.

The same backend is directly invocable through the real Go compiler command:

```sh
go build -o /tmp/vibec-go ./cmd/vibec-go
/tmp/vibec-go \
  --fork-checkout /path/to/smithersai-TypeScript \
  --fork-cache /path/to/compiler-cache \
  --timeout 5m \
  main.vibe util.vibe
```

Compile attempts write one `CompileResult` JSON object to stdout, with empty
diagnostic/artifact collections encoded as arrays. A successful emit exits
zero; a compiler, infrastructure, or timeout error or skipped emit exits one;
the dependency-free scaffold without `--fork-checkout` retains exit two; flag
or missing-root usage errors exit 64 without JSON. `--help`, `--version`, and
`--api-version` are metadata output. Fork-backend selection is explicit through
`--fork-checkout`, and there is no JavaScript fallback. Cache and Go-tool flags
are optional; without them the API uses the user cache and resolves `go` (and
always `git`) through `PATH`. A caller-supplied cache is rejected if it overlaps
the checkout. Flags precede root names because this POC uses Go's standard flag
parser. The deadline is carried through preparation and compiler subprocesses;
in-process backends must cooperate with context cancellation, and it cannot
preempt an uninterruptible local filesystem read.
Operational failures also receive a `VIBE_GO_BACKEND` or `VIBE_GO_TIMEOUT`
diagnostic in the JSON result and are repeated on stderr. SIGINT/SIGTERM retain
the platform's default abrupt command behavior in this POC, so they do not
promise a final JSON envelope.

Instead of positional disk roots, `--request request.json` submits one
`CompileRequest` JSON value with in-memory files, options, and the lowering
mode — the vehicle an external frontend uses to drive the pinned backend.
Unknown fields, trailing JSON, or an unreadable file are usage errors (exit
64) before any backend is prepared.

## Multi-file projects

Requests may carry several `.vibe` and `.ts` roots with relative POSIX paths
(subdirectories included). Relative imports between them resolve in both the
checked and the emit Programs — `.vibe` files through the content-mapper
extension registration, and in the emit pass through virtual `<name>.vibe.ts`
file naming. Every project file must be listed in the request; the bridge does
not read imports from disk. Per-file artifacts are deterministic:

- `x.vibe` → `x.js`, `x.js.map`, and with `declaration` on `x.d.vibe.ts`
- `x.ts` → `x.js`, `x.js.map`, and with `declaration` on `x.d.ts`

Diagnostics attribute to the file that produced them with authored spans.
Artifact-name collisions (for example `x.vibe` next to `x.ts`) are rejected
fail-closed rather than silently overwritten.

## Externally lowered input

`CompileRequest.Lowering: "external"` (API `LoweringExternal`) switches to the
mode where an external frontend — the JS POC frontend is the producer — has
already lowered every `.vibe` file. Each `FileKindVibe` source then carries
both its authored text and a `LoweredSource`: the generated TypeScript plus a
version-3 source map from the authored file to that TypeScript. The bridge
checks the lowered TypeScript through one fork Program, emits declarations and
runtime JavaScript from it, and composes the fork's emitted maps with the
supplied authored maps so every artifact maps to the authored `.vibe`.

The supplied map is validated exactly (see `LoweredSource` in `api.go`):
strict field set, version 3, sources naming exactly the authored file,
`sourcesContent` (when present) equal to the authored text, decodable VLQ
mappings, in-range indices, and in-bounds positions — on both sides of the
process boundary. Position semantics are delta-adjusted runs: a lowered
position maps through the greatest mapping at or before it on the same line,
advancing the authored column one-for-one within the run. Lowered spans with
no authored origin stay unmapped in composed maps, and diagnostics inside them
attach to the authored file without a span. Composed maps carry no `names`
entries.

## `.vibe` import rewriting

In runtime JavaScript output, a relative specifier ending in `.vibe` that
names a project `.vibe` input is rewritten to the emitted `./x.js` name. The
emitted file is parsed with the fork's own parser, so only real import,
re-export, and dynamic-import specifiers rewrite; composed source maps account
for the column shifts. Declarations deliberately keep the authored
`./x.vibe` specifier next to their `x.d.vibe.ts` naming, which is exactly the
pair TypeScript's `allowArbitraryExtensions` resolution expects.

## What the integration tests prove

All through the process protocol:

- A valid `.vibe` input is transformed by an upstream `contentmapper.Project`,
  checked, and emitted as `main.js` plus a source map whose source and
  embedded content are the authored `main.vibe`; declarations emit as
  `main.d.vibe.ts`.
- An invalid `.vibe` input produces upstream `TS2322` with its file and exact
  identifier span mapped back to the authored file; `noEmitOnError`
  suppresses all artifacts. This holds for multi-file projects (the error
  attributes to the root that contains it) and for externally lowered input
  (the span maps through the supplied non-identity map).
- Multi-file identity projects emit per-file artifacts, rewrite runtime
  `.vibe` imports, and keep exact authored positions in composed maps.
- An externally lowered file with a real non-identity region (`action` →
  `function`) and an inserted helper line round-trips authored positions
  through the composed runtime map, while the helper line's mappings stay
  source-less.

There are two upstream `Program` instances in identity mode by design.
TypeScript content mappers intentionally own parsing/checking and declaration
emit, while their runtime JavaScript output is delegated to the external
mapper or build tool. The bridge therefore checks the mapped `.vibe` Program,
then feeds the lowered (for identity, verbatim) TypeScript into a second
upstream Program for runtime emit and composes its source maps back to the
authored `.vibe`. Externally lowered mode uses a single Program: checking and
emit both happen on the lowered TypeScript, and the bridge owns the mapping
back to authored positions. Identity lowering is expressed as a synthesized
per-line identity map, so both modes share one emit pipeline.

## Deliberate POC limits

- Identity mode still accepts only the TypeScript-shaped subset of VibeLang;
  real Vibe syntax lowering lives in the external frontend, which must supply
  `LoweringExternal` requests.
- Composition trusts the producer's map inside a run: authored columns advance
  one-for-one within a mapping run (clamped to the authored line end), which
  is exact for verbatim runs and approximate inside replaced tokens.
- The in-memory project has a small compiler-option allowlist and does not yet
  parse `tsconfig`, discover projects, or resolve packages.
- Inputs use relative POSIX-style logical paths. Project roots, path
  canonicalization, and case behavior need a real host.
- The exact checkout is verified, but the local binary cache is not signed or
  independently digest-attested. It is not a production supply-chain boundary.
- Cold-cache builders isolate temporary files and atomically install a binary;
  interrupted build directories are not yet garbage-collected.
- `compiler.New()` remains the dependency-free M0 scaffold. `cmd/vibec-go`
  selects the executable pinned seam only with `--fork-checkout`; production
  wiring must still choose how signed, pinned binaries are distributed.

These limits are intentionally fail-closed: unsupported options, missing
files, dirty or mismatched checkouts, malformed protocol data, malformed
supplied source maps, emit-name collisions, and unavailable toolchains return
structured errors instead of silently falling back to the JavaScript compiler.
