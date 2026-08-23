# C19 — the Go compiler is reachable from `smithers`

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

Date: 2026-08-22

## Result

The product CLI now has an explicit backend selector on the three compiler
commands:

```text
smithers check   <inputs...> --backend js|go
smithers compile <inputs...> --backend js|go
smithers run     <input>     --backend js|go
```

`js` is the default, both when the option is omitted and when it is written
explicitly. The existing TypeScript analysis/lowering path remains the shipping
path. `go` is opt-in and never falls back to `js`.

For `.sm`, the Go route discovers the same bounded relative source graph, sends
one in-memory protocol-v3 request with `lowering: "internal"` to
`cmd/smithersc-go --request`, decodes its `CompileResult`, and stages the returned
artifacts. `check` requests `noEmit`; `compile` writes the fork's `.js`, map,
declaration, and compiler-prelude artifacts; `run` puts them in a temporary ESM
project and executes the emitted entry under Node.

The report is adapted to the existing `{ ok, files }` CLI shape. Every Go
diagnostic span is converted from the protocol's authored UTF-16 offset to the
same absolute file and one-based line/column fields the JS backend reports. The
Go protocol does not carry JS-instrument row/comptime/asset metadata, so `rows`
is honestly empty and the optional metadata blocks are absent rather than
manufactured.

With any explicit structured format, `run` captures the executed program's
stdout and stderr as `output` and `errorOutput`. This was applied to both
backends: `--format json` is one parseable JSON value even when the program
prints output. The ordinary unstructured path still inherits the child's
streams exactly as before.

## Fail-closed preparation

The CLI preflights the checkout before building anything by running the same
offline forkpatch status gate used to prepare the conformance backend. This is
deliberately stricter than the Go library's ability to advance a pristine
checkout: the product requirement says an unpatched checkout is an error, so
the CLI requires `state: "applied"` and `divergentFromApplied: 0`.

| Code | Detection | Exact remedy carried in the structured message |
| --- | --- | --- |
| `SMITHERS_GO_CHECKOUT_MISSING` | Configured checkout or all revision-named cache candidates are absent | `node scripts/prepare-typescript-fork.mjs --fetch --cache ...`, then `node compiler/forkpatch/forkpatch.mjs apply --checkout ...`, then the exact environment setting |
| `SMITHERS_GO_CHECKOUT_REVISION` | Forkpatch reports a `HEAD` other than `typescript-fork.json.revision` | prepare and apply a fresh revision-named cache, then point `SMITHERS_TYPESCRIPT_FORK` to it |
| `SMITHERS_GO_CHECKOUT_UNPATCHED` | Forkpatch state is `pristine` | `node compiler/forkpatch/forkpatch.mjs apply --checkout '<exact checkout>'` |
| `SMITHERS_GO_CHECKOUT_DIVERGENT` | State is mixed/partially patched or any applied post-image diverges | do not patch over it; prepare and apply a fresh cache with the printed commands |
| `SMITHERS_GO_CHECKOUT_INVALID` | Path is not a usable fork checkout or the verifier cannot validate it | run the exact status command, or the printed fresh-checkout commands |
| `SMITHERS_GO_BUILD` | Building `cmd/smithersc-go` or preparing/building the nested pinned bridge fails | `go build ./cmd/smithersc-go`, or the printed `SMITHERS_TYPESCRIPT_FORK=... go test ./compiler ./cmd/smithersc-go -count=1` reproduction |
| `SMITHERS_GO_TIMEOUT` | Bridge preparation/execution crosses its five-minute deadline | the printed pinned-fork Go test reproduction |
| `SMITHERS_GO_PROTOCOL` | Usage exit, empty/malformed output, an invalid `CompileResult`, or an impossible process exit | `npm run build` to rebuild producer and consumer together |
| `SMITHERS_GO_INSTALLATION` | The root manifest or forkpatch verifier is absent/invalid | `npm run build` from a complete Smithers source checkout |

All failures exit 2 through the CLI's structured error mechanism. Child stdout
and stderr are captured, so JSON output remains uncontaminated on failures too.
No branch in the Go route calls `compileSmithersFiles` or the JS language
instrument.

## Identical-results evidence

`test/cli-go-backend.test.mjs` writes its fixture only under `mkdtemp`. The
fixture exercises both required semantics:

- a plain number return is lifted into the success variant;
- throwing `InvalidScore` is lifted into the failure variant;
- `score(value).unwrap()` either extracts the success or propagates that exact
  failure from `doubled`.

The test runs the actual `smithers run` command once with `--backend js` and once
with `--backend go`. Both emitted programs execute under Node and both return
the exact same structured report. Their captured program output is exactly:

```text
ok:6
error:negative
```

The test deep-compares the complete JS and Go run reports, then runs the same
fixture with no backend option and deep-compares that result to explicit
`--backend js`. This proves both execution parity for the fixture and that the
default remains JS.

A second two-backend fixture returns a string from
`Result<number, BadValue>`. Both checks fail nonzero through the same top-level
report shape, and both carry an authored diagnostic at line 3 with an authored
column and the canonical `.sm` path. JSON purity is asserted by parsing the
entire stdout value and requiring empty CLI stderr.

## Failure-mode tests

- Missing checkout: sets `SMITHERS_TYPESCRIPT_FORK` to a path proven absent,
  gets exit 2 and exact code `SMITHERS_GO_CHECKOUT_MISSING`, and asserts both the
  prepare and apply commands are present. This case always runs.
- Unpatched checkout: makes a sparse, shared, detached clone of the pinned
  checkout under `mkdtemp`, materializes only the forkpatch pre-images, proves
  forkpatch state `pristine`, then gets exit 2, exact code
  `SMITHERS_GO_CHECKOUT_UNPATCHED`, and exact equality with the one apply-command
  remedy. The real checkout and repository are not modified.
- Tests that need the real fork use a Node test skip with the message
  `Go backend checkout unavailable; prepare and patch it to run the experimental backend integration case`.

## Verification

All requested gates were run serially:

```text
npm run build
  PASS

node --test test/*.test.mjs
  101 tests, 101 pass, 0 fail, 0 skipped
  baseline 97 + 4 C19 tests
  included live JS conformance: 92/92
  included live Go conformance: 92/92 match, 0 unsupported, 0 divergent
  included Go interop: 6/6

node --test test/cli-go-backend.test.mjs
  fork present: 4 pass, 0 fail, 0 skipped

SMITHERS_TYPESCRIPT_FORK=/private/tmp/smithers-c19-suite-absent \
  node --test test/cli-go-backend.test.mjs
  1 pass, 0 fail, 3 skipped with the explicit checkout-unavailable message

npm --prefix docs run build
  PASS; 75 static files generated

node compiler/forkpatch/forkpatch.mjs status --checkout \
  /private/tmp/smithers-ts-fork-cache/c087644e82dc3d48cf87e4c5519eeaaea9daf35c
  applied, 10 patches, divergentFromApplied: 0
```

## Files

- `src/cli.ts` — selector routing, Go result adaptation, authored positions,
  artifact staging, and structured child-process capture.
- `src/go-backend.ts` — checkout discovery/preflight, build, `--request`
  invocation, protocol validation, and actionable failure taxonomy.
- `test/cli-go-backend.test.mjs` — execution parity, JSON purity, authored
  positions, absent checkout, pristine checkout, and clean skips.
- `docs/src/pages/reference/cli.mdx` — selector, default, experimental scope,
  artifacts, failure modes, remedies, and evidence boundary.
- `poc/C19-REPORT.md` — this report.

Nothing under `compiler/`, `conformance/`, `poc/src/`, `vendor/`, or `cmd/` was
changed by C19. Nothing was committed.

SOURCE SETTLED
