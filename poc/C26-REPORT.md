# C26 — compose comptime into the conformance JS reference

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Outcome

The finding was real. `conformance/runner/js-lower.mjs` previously handed
authored `.sm` sources directly to `compileProject`, while the canonical CLI
first calls `compileComptimeIntrinsics`. Consequently, every corpus case with a
`smithers:comptime` import reached the emitted-TypeScript check with an
unresolved compiler-owned module and observed `TS2307` instead of comptime
semantics.

The JS reference now composes the frontend in this order:

1. Lexically discover a `smithers:comptime` or `smithers:schema` module edge.
2. For a project with such an edge, call `compileComptimeIntrinsics` over the
   complete authored Smithers source set with a `ComptimeCompiler`.
3. Feed every `loweredFiles[file].code` to `compileProject` under the same
   logical file name.
4. Run the existing stock emitted-TypeScript check and, for output cases,
   execute the emitted module through the unchanged harness.

A project with no compiler-owned module edge takes the identity path directly
to `compileProject`. This is the required inert behavior for an unused
compiler-owned pass. Calling the standalone pass unconditionally exposed an
important collateral issue during development: its bounded recovery parser
reported `VCT1000` against Smithers syntax owned by later stages in 14 unrelated
cases. The lexical module-edge boundary avoids reclassifying unrelated syntax
without filtering any project that can actually use comptime. Once an edge is
present, the comptime pass still receives the whole project, preserving
cross-file evaluation and checker identity.

The compiler construction mirrors the CLI seam:

```ts
new ComptimeCompiler({
  root: request.rootDir,
  cacheDirectory: request.comptimeCacheDirectory,
  target: "node-es2022",
  options: { frontend: "smithers-conformance-js@1" },
})
```

`schemaRuntimeImport` is passed explicitly as the repository's
`poc/src/build/schema-runtime.ts`, just as an internal CLI caller redirects the
package seam to a resolvable implementation.

## Cache hermeticity

`runJsCase` already creates one unique staging tree with
`mkdtemp(join(tmpdir(), "smithers-conformance-js-"))`. The request now assigns
`join(directory, ".smithers-comptime-cache")` as the comptime cache directory.
It is therefore:

- unique to one case observation;
- beneath a freshly created OS temporary directory, never the repository;
- unavailable to other cases and later harness runs; and
- removed by the existing `finally` cleanup together with the staging tree.

There is no shared warm cache and no repo-relative cache state.

## Diagnostics and authored positions

A failed comptime result is returned through the normal successful driver
protocol as a `diagnostics` observation. Each `VCT` diagnostic carries its
authored `file`, one-based `line`, and one-based `column` as `fileName`, `line`,
and `column`; `emitChecked` is false because frontend errors short-circuit the
emitted-TypeScript stage. It is never converted into `{ ok: false }`, a process
error, or an `unmeasured` result.

After successful comptime lowering:

- Smithers language diagnostics are mapped through that file's comptime source
  map before the driver returns them.
- Each `compileProject` map (emitted TypeScript to comptime-lowered source) is
  composed with the comptime map (comptime-lowered source to authored source).
- The existing emitted-TypeScript diagnostic mapper therefore continues to
  report authored positions through the now-composed map.
- Missing mappings remain explicit (`mapped: false`) rather than receiving an
  invented authored coordinate.

## Diagnostic code-family decision

The corpus now accepts `VCTnnnn` as a first-class diagnostic family alongside
`SMITHERSnnnn` and `TSnnnn`. The four negative comptime expectations name the
reference's actual codes: `VCT1004`, `VCT1005`, and `VCT1012`.

The Go comptime port deliberately exposed the same `VCT10xx` rules as
`SMITHERS19xx`, preserving the last two digits. The judge now canonicalizes
exactly `SMITHERS19xx` to `VCT10xx` for expectation matching and backend
agreement. Thus `SMITHERS1904`/`VCT1004`, `SMITHERS1905`/`VCT1005`, and
`SMITHERS1912`/`VCT1012` express one contract. No other family is normalized,
and the machine-readable observation retains the backend's raw code.

This decision makes the reference-native family nameable while preserving the
Go bridge's public vocabulary and exact comparison. The contract and mapping
are documented in `conformance/README.md`.

## Comptime xfails

Seven of the eight JS plumbing xfails were retired and now pass:

- `a-comptime-value-that-is-not-canonical-data-is-rejected`
- `comptime-binding-used-in-type-position`
- `comptime-function-is-interpreted-during-compilation`
- `comptime-target-selects-one-branch`
- `comptime-value-is-evaluated-during-compilation`
- `randomness-is-unreachable-from-inside-a-comptime-loop`
- `the-wall-clock-is-unreachable-from-comptime`

`an-unbounded-comptime-loop-exhausts-its-step-budget` remains a JS xfail for a
real semantic-position difference discovered only after plumbing was fixed.
The reference reports `VCT1012` at the repeatedly evaluated right-hand `n` on
authored `6:9`; the corpus contract and Go backend anchor the exhausted budget
at its loop owner on `5:3`. Its xfail reason now states that behavior rather
than citing the removed `TS2307` plumbing gap.

The ninth comptime case, `an-unrelated-local-comptime-stays-an-ordinary-function`,
was already pass and remains pass. With no compiler-owned module edge, the
comptime frontend has no authority and the local function remains ordinary.

Final `16-comptime` status: JS 8 pass + 1 xfail; Go 9 pass; 8/9 expectations
match both backends, and 8/9 raw semantic observations agree after the explicit
code-family alias (the budget position is the one disagreement).

## Full before/after

Both measurements used the same 176-case corpus and the pinned checkout at
`/private/tmp/c21-typescript-fork-cache/c087644e82dc3d48cf87e4c5519eeaaea9daf35c`
through the runner's supported `SMITHERS_TYPESCRIPT_FORK` environment variable.
Automatic discovery did not find that checkout on the first baseline attempt,
so the reported two-backend baseline is the rerun with the explicit verified
path.

| backend | before | after |
| --- | --- | --- |
| JS reference | 161/176 pass, 0 xpass, 15 xfail, 0 unsupported, 0 divergent, 0 unmeasured | 168/176 pass, 0 xpass, 8 xfail, 0 unsupported, 0 divergent, 0 unmeasured |
| Go fork | 136/176 pass, 0 xpass, 5 xfail, 18 unsupported, 17 divergent, 0 unmeasured | 146/176 pass, 1 xpass, 5 xfail, 17 unsupported, 7 divergent, 0 unmeasured |
| backend agreement | 126/176 identical observations | 144/176 identical observations |

### Every final status movement

JS movements caused by this lane, all `xfail -> pass`:

- `16-comptime/a-comptime-value-that-is-not-canonical-data-is-rejected`
- `16-comptime/comptime-binding-used-in-type-position`
- `16-comptime/comptime-function-is-interpreted-during-compilation`
- `16-comptime/comptime-target-selects-one-branch`
- `16-comptime/comptime-value-is-evaluated-during-compilation`
- `16-comptime/randomness-is-unreachable-from-inside-a-comptime-loop`
- `16-comptime/the-wall-clock-is-unreachable-from-comptime`

The following Go movements occurred concurrently in live compiler/corpus lanes;
this lane did not edit `compiler/**` or any listed corpus area. They are included
because the brief requires every before/after movement in the shared tree:

- `fail -> pass`: `04-nominal-errors/duplicate-error-class-name-is-rejected`
- `fail -> pass`: `08-promise-chaining/unowned-async-callback-is-rejected`
- `fail -> pass`: `09-foreign-calls/callback-escaping-into-foreign-code-is-rejected`
- `fail -> pass`: `09-foreign-calls/foreign-constructor-needs-throws-never`
- `fail -> pass`: `12-labeled-block-values/plain-break-out-of-a-value-block-is-rejected`
- `fail -> pass`: `13-loop-values/cross-construct-value-break-is-rejected`
- `fail -> pass`: `18-typescript-requirement/class-static-block-is-rejected`
- `fail -> pass`: `18-typescript-requirement/type-only-import-adds-no-requirement`
- `fail -> pass`: `20-host-globals/clock-access-needs-a-capability`
- `fail -> pass`: `20-host-globals/random-access-needs-a-capability`
- `unsupported -> pass`: `20-host-globals/host-globals-are-unavailable`
- `pass -> xpass`: `08-promise-chaining/promise-catch-is-rejected` (a concurrent
  expectation edit added a Go xfail even though the current Go observation
  matches, so the harness correctly calls for retiring that marker)

No JS case outside `16-comptime` moved in the final before/after. The seven
newly matching comptime observations plus the eleven concurrent Go semantic
improvements account for backend agreement moving from 126 to 144. The
`promise-catch` xpass is a verdict-marker change; its raw observation was already
in agreement.

## Verification

```text
SMITHERS_TYPESCRIPT_FORK=<pinned> node conformance/runner/run.mjs --backend both --jobs 1
    exit 0
    JS reference: 168/176 pass, 8 xfail, 0 divergent, 0 unmeasured
    Go fork:      146/176 pass, 1 xpass, 5 xfail, 17 unsupported,
                  7 divergent, 0 unmeasured
    Agreement:    144/176 identical observations
    Harness integrity violations: 0

SMITHERS_TYPESCRIPT_FORK=<pinned> node --test test/conformance.test.mjs
    6 tests passed, 0 failed, exit 0
    JS interop: 6/6
    Go interop: 6/6

node --check conformance/runner/js-lower.mjs
node --check conformance/runner/backend-js.mjs
node --check conformance/runner/corpus.mjs
node --check conformance/runner/judge.mjs
jq validation of every conformance/corpus/16-comptime/*.expected.json
git diff --check -- conformance/runner conformance/corpus/16-comptime conformance/README.md
    all clean
```

No integrity stage was weakened, no crash was absorbed into `unsupported`, no
unmeasured observation occurred, no live-lane file was repaired or suppressed,
and nothing was committed.

SOURCE SETTLED
