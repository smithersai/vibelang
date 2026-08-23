# C3 foundation report: fork-owned `smithersc`

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Vendoring recommendation

Do not expand the pinned `tsc/` tree as the previously planned squashed Git
subtree. At revision `c087644e82dc3d48cf87e4c5519eeaaea9daf35c` it contains:

- 65,532 tracked files;
- 205,979,146 logical bytes;
- 392 MiB allocated on this filesystem;
- 60,190 files and 155,576,229 bytes under `tsc/testdata` alone.

Before this work the Smithers repository had 1,003 tracked files and 35,822,782
tracked bytes. A literal subtree would therefore make the tracked file count
about 66 times larger and tracked content about 6.8 times larger. It would also
make repository-wide ripgrep, editor indexing, Git status, checkout, and backup
work traverse tens of thousands of compiler test files.

The implemented alternative is an exact-revision source capsule at
`vendor/typescript`:

- `typescript.bundle` is a 34,257,412-byte Git bundle with exact `HEAD`
  `c087644e82dc3d48cf87e4c5519eeaaea9daf35c` and complete bundled history;
- the capsule includes a file Go proxy for all 21 modules selected by the
  pinned `tsc/go.mod` graph;
- TypeScript's license is visible as `LICENSE.typescript`;
- the verified payload is 51,869,204 bytes in 86 payload files;
- the complete vendor directory is 51,882,122 bytes in 88 files.

This retains a real clean/editable checkout at the exact commit without making
the Smithers worktree carry 65,532 expanded files. The default prepared sparse
checkout contains 757 `tsc` files; `--full-tsc` remains available when upstream
test data is needed.

The initial `npm pack --dry-run` assessment was 516 entries and 7,816,985
unpacked bytes. The final dry run is 517 entries and 7,823,620 unpacked bytes,
with zero `vendor/` entries and zero cached compiler binaries. The positive
`package.json` `files` allowlist excludes the capsule. Root, POC, and docs
TypeScript configs use explicit includes, and Bun tests are scoped below `poc`.

## Fork-owned injection mechanism

The reviewable source of truth is mirrored under `cmd/smithersc/forksrc`:

```text
cmd/smithersc/forksrc/cmd/smithersc/main.go.txt
cmd/smithersc/forksrc/internal/smithers/marker.go.txt
```

The build gate verifies an exact, completely clean checkout, temporarily copies
those sources to `tsc/cmd/smithersc/main.go` and
`tsc/internal/smithers/marker.go`, builds inside the fork module, removes the
injected files, and verifies that the checkout is clean again.

Multi-file Go overlays were evaluated first. An overlay can replace or add a
file in an already discoverable package, but it cannot introduce a new package
directory: attempts to add `cmd/smithersc` or `internal/smithers` failed with `no Go
files`. Controlled working-checkout population was selected because it survives
clean rebuilds, keeps Smithers code reviewable in this repository, preserves
normal Go `internal` visibility, and needs no network in CI.

The refusal gates were exercised explicitly. A checkout containing an untracked
`dirty-probe` was rejected with exit 1 and its dirty status, and the Smithers
repository checkout was rejected with exit 1 because its `HEAD` did not equal
the pinned TypeScript revision.

## Binary and fork-internal linkage proof

The built command identifies itself as:

```text
smithers-extension=0.1.0-foundation.1
typescript-fork=c087644e82dc3d48cf87e4c5519eeaaea9daf35c
typescript-core=7.1.0-dev
fork-internal=github.com/microsoft/TypeScript/tsc/internal/core.Version
```

`go version -m` reports the command path as
`github.com/microsoft/TypeScript/tsc/cmd/smithersc` in module
`github.com/microsoft/TypeScript/tsc`, built by Go 1.26.0 with `CGO_ENABLED=0`
and `-trimpath=true`. `go tool nm` shows both:

```text
github.com/microsoft/TypeScript/tsc/internal/core.version
github.com/microsoft/TypeScript/tsc/internal/smithers.Marker
```

The marker therefore is not an external wrapper or cosmetic string: fork-owned
`internal/smithers` runs and calls the real TypeScript compiler
`internal/core.Version` function.

## Reproducibility evidence

`npm run smithersc:verify-reproducible` performed two isolated builds. Each started
from a newly materialized exact checkout and a fresh module cache whose only
proxy was `vendor/typescript/go-proxy`. Automatic Go toolchain downloads were
disabled; the build requires an already installed Go 1.26.0. Both builds used
`CGO_ENABLED=0`, `-trimpath`, `-buildvcs=false`, and an empty build ID.

Both SHA-256 digests were identical:

```text
f87a7934322208d20c804831735a4c68622ed3dc2171cd586553cf579fb6bc9c
f87a7934322208d20c804831735a4c68622ed3dc2171cd586553cf579fb6bc9c
```

This is byte reproducibility for the pinned sources, Go 1.26.0, and the same
target (`darwin/arm64`). Cross-platform or cross-toolchain identical bytes are
not claimed.

## Verification and honest limitations

The following completed successfully:

- `go build ./...`;
- `go vet ./...`;
- `SMITHERS_TYPESCRIPT_FORK=/private/tmp/smithers-ts-fork-cache/c087644e82dc3d48cf87e4c5519eeaaea9daf35c go test ./compiler ./cmd/smithersc-go -count=1`;
- all 35 currently listed Go tests across those two packages (the requested
  baseline described 29; parallel work has added tests);
- `node --check` for all three vendoring/build `.mjs` scripts;
- capsule verification and the two-build reproducibility gate;
- a final npm pack dry run with no vendored source or cached binary.

This settles fork source availability and the buildable extension seam, not the
language implementation. The foundation `smithersc` is currently an identity
marker; it does not yet compile Smithers. The generated binary is local and is
not signed, attested, published, or distributed.

SOURCE SETTLED
