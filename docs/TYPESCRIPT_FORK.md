# Pinned TypeScript fork

> [!IMPORTANT]
> **Specification drift — read `docs/DECISIONS.md` first.**
> This document reports what the implementation does. As of 2026-08-23 the
> specification was substantially reduced and the code has not caught up, so
> parts of this page describe features the language no longer defines: the
> expression-form control-flow grammar, `defer`/`errdefer`, labeled value
> breaks, `Optional<T>`, `.unwrap()` (now postfix `!`), the TypeScript non-null
> assertion, and the near-native/Wasm targets with their `TypeScript`
> requirement, feature classification, and portability pin. Where this document
> and the specification disagree, the specification wins.

Smithers has two compiler implementations in this repository:

- the TypeScript analysis/lowering instrument under `poc/src/language`, which
  remains the default for the root `smithers` CLI; and
- a real Go implementation that runs inside the exact pinned
  `smithersai/TypeScript` fork and is selected explicitly with `--backend go`.

The Go path is not a wrapper around the TypeScript instrument. It parses and
checks `.sm` with the fork, makes lowering decisions from fork symbols and
types, constructs replacement nodes with the fork AST factory, prints with the
fork printer, and maps diagnostics and artifacts back to authored `.sm` spans.

> **Source-checkout note:** npm ships this provenance document, but it does not
> ship the repository-only preparation scripts, source capsule, Go bridge,
> forkpatch tooling, or compiler binary. The commands below are maintainer and
> reviewer operations for a source checkout.

## Why the fork is required

The Go TypeScript compiler is a nested module under `tsc/`, and its parser,
checker, AST, printer, emitter, and language-service packages live under Go
`internal` paths. Smithers code outside that parent module cannot import them.
The repository therefore uses three narrow mechanisms:

| Mechanism | Purpose |
| --- | --- |
| `compiler/forkpatch` | Digest-gated changes to fork-owned parser, AST, binder, checker, printer, and tests. |
| `go build -overlay` from `compiler/forkbridge` | Adds the Smithers bridge implementation to an existing fork package without copying internals into the root module. |
| Controlled checkout population from `cmd/smithersc/forksrc` | Builds the separate fork-owned foundation command and marker package. |

The root module does not copy TypeScript internals or use a `replace` directive
to bypass Go's visibility boundary.

## Exact-revision source capsule

The production ledger originally selected a squashed subtree at
`vendor/typescript`. Measuring the pinned revision showed that a literal import
would add 65,532 files and 205,979,146 logical bytes (392 MiB allocated on the
measurement filesystem); `tsc/testdata` alone accounts for 60,190 files and
155,576,229 bytes. The pre-import Smithers repository had 1,003 tracked files
and 35,822,782 tracked bytes.

The implemented repository format is therefore an exact-revision source
capsule rather than an expanded subtree. `vendor/typescript/typescript.bundle`
is a 34,257,412-byte Git bundle whose `HEAD` is the 40-character revision in
`typescript-fork.json`. The capsule also carries TypeScript's visible license
and a file-based proxy for the 21 Go modules selected by the pinned `tsc/go.mod`
graph. It materializes a clean, editable checkout without a submodule or
network access.

```sh
node scripts/prepare-typescript-fork.mjs --cache /path/to/cache
```

The default sparse profile materializes 757 `tsc` files. Use `--full-tsc` only
when the upstream test corpus is needed. `--source /path/to/checkout` verifies
an existing checkout; `--fetch` is an explicit network fallback when the
repository-only capsule is unavailable. Normal preparation never silently
fetches.

The source capsule is not an npm distribution payload. The package allowlist
excludes `vendor/`, the preparation scripts, the Go bridge, and cached compiler
binaries.

## Reviewable, reversible fork patches

All modifications to fork-owned files are carried as an ordered series under
`compiler/forkpatch`. `series.json` pins the exact upstream revision, patch
order, patch-file SHA-256 values, and pre/post-image digests. The tool rejects
a wrong revision, an altered patch, a dirty or mixed checkout, a missing or
extra patch, and any post-image divergence.

```sh
node compiler/forkpatch/forkpatch.mjs status  --checkout /path/to/checkout
node compiler/forkpatch/forkpatch.mjs apply   --checkout /path/to/checkout
node compiler/forkpatch/forkpatch.mjs verify  --checkout /path/to/checkout
node compiler/forkpatch/forkpatch.mjs unapply --checkout /path/to/checkout
```

Application runs `git apply --check` before each ordered patch and rolls back
earlier patches if a later patch fails. `unapply` has been measured to restore
the pinned checkout to a byte-identical pristine tree with an empty Git status.
Applying the series independently to multiple fresh checkouts also produces
byte-identical post-images.

The series contains the real Smithers grammar and its fork-owned tests. All
nine documented surface-grammar forms parse, bind, type-check, and reach the Go
lowerer in the applied tree. `.sm` nevertheless remains a content-mapper
extension registered with the fork, not a built-in TypeScript source kind. The
project has deliberately not crossed that compatibility boundary.

### Upstream health gate

On August 22, 2026, against pinned revision
`c087644e82dc3d48cf87e4c5519eeaaea9daf35c`, both a pristine checkout and the
complete applied series passed the same 62/62 Go packages and 130,743 upstream
testrunner subtests. The package list and outcomes were identical apart from
timings. Those are upstream-health measurements for that exact revision and
tree states, not a Smithers conformance score.

The patch series is reviewable in a source checkout, but it is neither vendored
into the npm distribution nor signed. A digest proves the bytes match this
repository's manifest; it is not publisher identity, release attestation, or a
supply-chain signature.

## The Go Smithers implementation

`CompileRequest.Lowering: "internal"` selects the Go implementation. The bridge
injects compiler-owned prelude and virtual-module declarations into one checked
fork Program, then lowers with fork AST nodes. It does not perform source-text
replacement.

The implemented semantic core includes:

- `Result<A, E>` success/error lifting from ordinary `return` and `throw`;
- `.unwrap()` early propagation with statement-order checks and authored
  diagnostics;
- `Optional<A>` lifting, absence propagation, and outside-in
  `Result<Optional<A>, E>` handling;
- async `Promise<Result<A, E>>` checking and lowering;
- nominal error matching resolved by constructor binding identity;
- compiler diagnostics for must-consume, unsafe propagation, and unsupported
  placements;
- all nine Smithers surface-grammar forms, including value-producing control
  flow and cleanup forms; and
- both compiler-owned intrinsics: `smithers:comptime` and `smithers:flows`.

The lowering runs before the fork emits ordinary JavaScript, declarations, and
source maps. Compiler-generated wrappers, temporaries, imports, and Plan data
are left unmapped; rewritten authored nodes retain authored source ranges.
Relative `.sm` runtime imports are rewritten to emitted `.js` names, while
declarations keep `.sm` specifiers beside `.d.sm.ts` artifacts.

### `smithers:comptime` in Go

The Go comptime pass recognizes direct, aliased, and namespace imports by
resolved declaration identity. Its bounded evaluator supports canonical data,
project-local constants and pure helpers, branches and loops, interpreter-owned
array/object mutation, a deterministic standard-library allowlist, hard step /
allocation / call-depth / string budgets, `comptime.target` branch erasure, and
value-derived literal type aliases. Retained runtime functions cannot capture
phase-only operations, and any refusal suppresses all substitutions and emit
for the request.

Tracked `embed(...)` is recognized but refused because the Go request protocol
does not yet carry compiler-owned asset bytes. Schema reification, loader
registration, and the persistent content-addressed comptime cache remain on the
TypeScript-instrument side. The Go backend fails closed rather than reading the
ambient filesystem or substituting a runtime placeholder.

### `smithers:flows` in Go

The durable pass recognizes `durable`, `Action`, and Flow helpers by resolved
identity and lowers a useful checked subset to a static, serializable,
digest-pinned Plan descriptor. Direct Actions, projections, `.unwrap()`
propagation edges, conditional expressions, timers, typed signals, and explicit
`sequential(...)` control edges are supported. The pass walks checked syntax
and constructs Plan literals; it never invokes the Flow function or an Action
implementation.

Fan-out, child Flows, general statement control flow, loops, broadcast, queues,
and unsupported persistence shapes currently produce explicit `SMITHERS41xx`
diagnostics in the Go backend. The TypeScript durable compiler has a broader
bounded subset. Exact emitted-byte parity is not claimed; the Go-emitted Plan
has been validated by the TypeScript `PlanArtifact` validator with matching
canonical digest recomputation.

## Product CLI selection

The root CLI exposes the Go implementation on three commands:

```text
smithers check   <inputs...> --backend go
smithers compile <inputs...> --backend go
smithers run     <input>     --backend go
```

Omitting `--backend`, or writing `--backend js`, selects the TypeScript
instrument. The Go route never falls back to it. The CLI requires an
exact-revision checkout whose complete patch series is already applied with no
post-image divergence, sends one in-memory protocol-v3 request with internal
lowering selected, and adapts authored UTF-16 diagnostic spans into the same
one-based report shape as the default path. `run --backend go` executes the
emitted entry under Node in a temporary ESM project.

Preparation failures are structured and actionable: missing checkout, wrong
revision, pristine/unpatched state, mixed or divergent state, build failure,
timeout, and protocol mismatch each fail nonzero. No failure changes backend.
See `docs/src/pages/reference/cli.mdx` for the exact codes and remedies.

The conformance corpus is expanding while backend-parity work continues. It is
a contract, not a census, so this page does not freeze a moving pass total. Use
`conformance/COVERAGE.md` as the live obligation-to-case matrix and rerun the
backend harness against the tree being reviewed.

## Direct bridge protocol

The same backend is directly invocable from a source checkout:

```sh
go build -o /tmp/smithersc-go ./cmd/smithersc-go
/tmp/smithersc-go \
  --fork-checkout /path/to/checkout \
  --fork-cache /path/to/compiler-cache \
  --timeout 5m \
  main.sm
```

Compile attempts return one `CompileResult` JSON object. The command also
accepts `--request request.json` for one full in-memory protocol request.
Internal lowering runs the Go implementation above. External lowering remains
available when another frontend supplies generated TypeScript and a strict
version-3 source map per `.sm` file; the bridge validates and composes that map
instead of inventing authored positions.

Multi-file requests may contain `.sm` and `.ts` roots with relative POSIX paths
and subdirectories. Every source must be supplied explicitly; the bridge does
not discover imports from ambient disk. Artifact-name collisions and malformed
maps fail closed.

## The separate fork-owned foundation command

`cmd/smithersc/forksrc` also contains the source for a small fork-owned
`cmd/smithersc` identity command and `internal/smithers` marker. The controlled
build temporarily populates those new package paths, builds, removes them, and
verifies the checkout again. That foundation command proves legal access to
fork internals and byte-reproducible local builds; it is distinct from the
`cmd/smithersc-go` bridge and does not itself compile Smithers programs.

```sh
npm run typescript:fork:verify
npm run smithersc:build
npm run smithersc:verify-reproducible
```

Its cached binary is local only. It is not signed, attested, published, or
distributed.

## Tooling and remaining boundaries

The working `smithers format` and `smithers lsp` commands currently use the
TypeScript instrument rather than the Go backend. The formatter delegates to
the TypeScript language-service formatter and permits whitespace changes only.
The language server speaks stdio JSON-RPC and implements diagnostics,
failure/requirement-row hover, definition, and whole-document formatting within
a bounded relative-`.sm` project closure.

The fork work does not imply a native/LLVM backend or a general Wasm backend.
The current Wasm path is a bounded architectural proof. It also does not turn
process-level compiler/loader sandboxes into container or VM isolation, or add
multi-machine coordination to the durable runtime.

## Updating the pin

Update fork-owned compiler changes in reviewable patches against the exact
revision, then regenerate and verify the series rather than editing capsule
payloads. Updating the pinned revision requires a clean complete checkout, a
new source capsule, license verification, forkpatch re-recording, pristine and
applied upstream health runs, the Smithers test suites, and package-inventory
checks. A release must separately decide how to distribute and sign compiler
artifacts; the current repository workflow does neither.
