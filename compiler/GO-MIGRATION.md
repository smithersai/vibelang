# One Go compiler: implementation migration

**Go compiler refresh (snapshot 93, full release green):** the pin,
offline capsule and patch manifest now name
`bf7f49d6f5ad3254d03ed83dd07ab510ae4e582a`, measured from Microsoft's TypeScript
main at `2026-09-09T00:01:28Z`. The one new commit separates VS Code extension
releases; it changes upstream release tooling, not compiler sources, Go
dependencies or generator inputs. No release/publish workflow was executed.
Pristine and patched compiler health selections pass. All eight generated files
reproduce exactly, all five patch contents and 24/27 pre-/post-images are
unchanged, and reversal leaves a clean checkout before successful reapplication.
The rebuilt API 53 native compiler passes the package build. The failed first
vendor attempt during worktree checkout, missing generator-tool attempt and
temporary generator-symlink build refusal are preserved as failed runs; the
subsequent clean attempts pass. The final refreshed-pin selections pass 120 Node,
187 SDK/build and 84 native tests/subtests, with no failures or skips. The native
executable is Go TypeScript `7.1.0-dev`, API 53, SHA-256
`4452cdfbd2f602f28aa3498a622f7f43fff6091bc0bf831b8de02a9de30aaaf5`.
Snapshot 93 qualifies this refresh and API 53 bundler delivery with a complete
frozen serial release. The earlier snapshot 92 fails the Node
gate with 498 passes and one brand failure in a newly added historical-directory
reference. The redundant reference is corrected without changing the brand rule;
all frozen inputs matched before that correction. Later suites did not run in
snapshot 92; its failed record remains.

Snapshot 93 passes 499 Node, 5,279 Bun and 4,691 Go tests/subtests, with the one
existing credentialed live-model skip. The unchanged corpus/differential
baselines, reproducible 578-file/25-export package, fresh installed Node/Bun
consumers and 87-file docs build pass. All 2,323 live inputs match before this
certificate-only update. Full evidence and artifact digests are in the latest
release checkpoint of the interoperability record.

Upstream main advances to `fe5d056f0cb291a8552081f8407abe0455b5be8f` during
the run, measured at `2026-09-09T00:49:22Z`. Its nine changed files are TypeScript
API helpers and benchmarks this implementation does not use. A complete changed-
path inventory and zero-difference compiler/input check confirm that the Go
compiler tree, generation inputs and dependencies are unchanged. The qualified
pin remains `bf7f49d6`; it is not represented as the latest repository commit.
No second TypeScript compiler-API implementation is introduced.

**API 53, bundler delivery (full release green):** the
CLI's project pipeline is shared with a new `vibelang/unplugin` factory. All
language parsing/checking/lowering remains in Go. The native analysis/generated
checker protocols optionally return bounded file and negative-directory/membership
inventories; explicit overlays and pinned libraries are not disk dependencies.
Successful directory-existence checks do not turn into recursive ancestor
watches. Host observers retain failed asset/comptime reads so missing-input
creation can recover a refused build.

All nine host factories have build-and-execute coverage. The latest focused
Node selection passes 120/120, including 58 pipeline/plugin/actual-host tests,
Vite package-declaration refusal/recovery, imported-row invalidation, and missing
asset/embed/declaration creation. The SDK/build/native selection passes 187/187,
including the tightened UTF8 path budget; the native selection passes all 84
tests/subtests. The first clean package check exposed optional host types
leaking through unplugin's declarations; opaque, host-compatible public handles
fix that, and a fresh strict Node/Bun installed-package check passes. Third-party
Farm/Bun declaration errors remain excluded only from the all-host assignability
fixture, not from VibeLang's strict installed-consumer gate.

New runtime dependency: unplugin 3.3.0. Host implementations are pinned dev-only
test dependencies. Node's floor is 22.12.0 and Bun's adapter/CI floor is 1.2.22.
This is Node/Bun delivery, not browser runtime or durable Plan-host completion.
Farm 1.7.11 library mode omits final maps even in an ordinary-JavaScript control;
normal Node mode retains them. Failed intermediate watch runs are preserved:
webpack resolution recursion, Farm's dropped load map, recursive over-watching,
and Vite URL/negative-probe transport were repaired and rerun, not waived.
Two additional negative tests first reproduce esbuild silently accepting
unbundled output. The adapter now requires `bundle: true`, since rewritten
authored module IDs must be resolved by the host; both refusal tests pass.
The CLI remains the supported unbundled-output path.
Snapshot 93 certifies this complete new input set. Snapshot 91 below certifies
its older API 52 inputs, not these new changes. Production durable-host packaging
still needs the owner decision; the reviewed runtime packages remain unavailable
at `2026-09-09T00:31:44Z`. The end-to-end alpha-0 goal is not complete.

**Snapshot 91 (previous pin, historical qualification):**
the pin was `10404f71a8675a010ca6431698c8d7ee80bbcd39`, measured
from Microsoft's current TypeScript repository on September 8. The two newer
commits add upstream TS1558 for readonly ambient import attributes and extend
upstream's separate API batching helper. The Go compiler owns the new grammar
check; this project does not use that TypeScript API helper. The verified
offline capsule, Go constant and patch manifest agree. All five patches, 24
pre-images, 27 post-images and 22 Go dependencies remain unchanged except for
revision identity. Pristine and patched health selections and upstream's new
baseline test pass; all eight generated files reproduce exactly and patch
reversal leaves a clean checkout. The native rebuild and snapshot 91's complete
serial release pass.

Both native delivery profiles now pin the actual new diagnostic. This exposed
a separate implementation defect: the VibeLang adapter listed `skipLibCheck`
as permitted but rejected an explicit boolean at compilation. The Go adapter
now honors both values while preserving its existing `true` default. All
eighteen focused tests/subtests pass, covering both profiles, invalid ambient
attributes, valid controls, declaration-checking defaults and malformed option
values. The rebuilt native executable is Go TypeScript `7.1.0-dev`, API 52,
SHA-256 `59f96841c16c6ef7f4b73bcd175ac86e687cd2e81886769c10bb73faf7f5ce8f`.
The focused installed Node/Bun package check passes with 568 files and 24
exports. The subsequent frozen full release independently passes. Upstream still
matches this pin after that run at `2026-09-08T22:24:10Z`.
The final 175-test native SDK/configuration group, pinned Plan/value comparisons
and nine documented-program checks also pass before the source freeze.

Snapshot 91 passes `release:verify`: 441 Node, 5,225 Bun and 4,665 Go
tests/subtests; the unchanged corpus/differential baselines; reproducible
packaging; installed Node/Bun consumers; and the 85-file docs build. The one
credentialed live-model skip remains explicit. All 2,311 live inputs match the
tested snapshot before this certificate-only update. Snapshot 90 remains a
failed release, and the earlier uninstrumented sandbox exit remains unclassified.
This qualifies the latest-Go compiler and transport work, not alpha-0 completion.
Production durable-host packaging, rounds, history and remaining defaults are
still open. The reviewed runtime packages still return 404 at `22:23:44Z`.

Compiler preparation now uses an OS-held file lock in a separate `v2` cache
layout. A killed owner no longer leaves an ownership directory behind, cancelled
requests cannot acquire a free lock, and a repeated release cannot remove a
successor's lock. Existing caches and legacy lock evidence are preserved.
The focused eighteen-test/subtest group passes under the race detector, including
actual cold-cache preparation, two independent lock-owner process lifecycles and
96 contended acquisitions. Windows/amd64 and Linux/arm64 cross-compilation passes;
those are compile checks, not runtime tests on those systems. This adds no Go
module or runtime dependency and changes no source-language semantics or ABI.
Five further repeated race-detector runs pass. The package rebuild passes and
produces the same native executable SHA-256 as snapshot 89. Upstream matched
that earlier pin at `2026-09-08T20:30:50Z`.
Snapshot 90 then passes 417 Node, 5,225 Bun and 4,647 Go tests/subtests, but its
full release fails in the installed Node consumer: a synchronous native Plan
request times out while Go waits for stdin. All 2,308 inputs still match the
snapshot. Focused package retries include both failure and success; none turns
that failed release green. A reduced mixed Deno/native workload reproduces the
stall, and live process samples show the Go stdin reader and Node's synchronous
process wait. Deferring the call one turn does not fix it.

The SDK now supplies finite read-only file-backed stdin, with private staging,
pre-spawn unlink on non-Windows hosts and descriptor/path cleanup. Fifteen
transport checks pass, including exact Unicode bytes, large output, a real
timeout/kill and failure cleanup. The raw transport and two actual-SDK traced
controls each pass 500 sandbox executions and 5,000 native calls on Node 22.12.
An earlier SDK stress run failed with a sandbox exit without a terminal message,
not a native timeout; its uninstrumented exit cause remains unclassified. It is
not erased by the passing controls.

A separate deterministic regression proves the runner truncated protocol frames
when Deno performed partial writes. It now drains each queued frame completely
and refuses invalid progress without spinning. The combined 24-check Node group
and the 171-test focused native Bun group pass. Full release qualification now
passes in snapshot 91. These transport fixes change no native ABI, parser, dependency
or Node support floor. The independent upstream pin update is recorded above.
Snapshot 89 remains the successful certificate preceding the failed snapshot 90.

The earlier September 8 native pin update named upstream
`d0ac85d8eab09e06376390c9352d07c8a8c00aa8` in the source manifest, Go constant,
patch series and verified offline capsule. The single upstream commit changes
validation tasks and repository guidance only. All five patch contents, all
pre/post images and all 22 vendored Go dependencies are unchanged. Selected
pristine and patched compiler/project/language-service health suites pass; all
eight generated files reproduce exactly, and patch reversal leaves a clean
upstream checkout. The new native package builds and the 141 data, 39 source-Plan,
six ordered-value and nineteen control comparisons pass. The shipped architecture
guide now identifies the Go-only compiler, actual offline capsule and current
static-Plan contract without claiming that the durable host is finished. All four
real external SQL Control/scheduler/journal scenarios, including both
SIGKILL/fresh-process variants, pass without repeating committed work. Snapshot 89
passes the complete serial release: 417 Node, 5,225 Bun and 4,631 Go tests/subtests,
unchanged corpus/differential baselines, installed Node/Bun consumers,
reproducibility and the 85-file docs build. All 2,302 live inputs match the tested
snapshot. The post-run check still matches upstream `main` at
`2026-09-08T19:58:50Z`; the nine documented programs pass separately on the new pin.
Only the three implementation-status records change after this full run.

API 52 derives guarded input/const facts from the fully checked retained-body
Go program, where propagation preserves nullable Action successes. Both native
Programs must agree on the exact source reference and its declaration; only
bounded inert descriptors cross into graph extraction. Null comparisons on
records no longer incorrectly require object identity. This changes no parser,
compiler dependency, runtime dependency or durable scheduler. The focused
313-test SDK group, 59 CLI tests, native checks, 39 upstream-verified source Plans
and installed Node/Bun consumers pass. A probe against snapshot 87 confirms the
previous checker accepted a nullable return but gave its null arm a `never`
contract, rejecting null at runtime; that regression now passes. Snapshot 88
passes the complete serial release with 417 Node, 5,225 Bun and 4,631 Go
tests/subtests, the unchanged corpus/differential baselines, installed consumers,
reproducibility and docs. All 2,302 live inputs match after completion. The
post-run upstream measurement finds a newer revision, `d0ac85d8eab09e06376390c9352d07c8a8c00aa8`;
snapshot 88 certifies the recorded `1f70213d4922b434345f639b441681e470c7cfc1`
pin, not that subsequent upstream change. Snapshot 89 above subsequently
qualifies the updated pin without changing these regression tests.

API 51 adds scoped `if` statements, early returns and checked input narrowing
to the native static source graph. The graph preserves both alternatives,
selected-only field access, explicit ordering and independently ready common
work. No JavaScript compiler API, runtime dependency or scheduler was added.
Focused native, 270 SDK, 57 CLI, 38 upstream source-Plan, installed Node/Bun and
nine documented-program checks pass, as do the external control and real
crash/restart regressions. Snapshot 87 passes the complete serial release with
415 Node, 5,182 Bun and 4,603 Go tests/subtests, the unchanged corpus/differential
baselines, installed consumers, reproducibility and docs. All 2,300 live inputs
match it after completion. Snapshots 85/86 remain recorded as failed; the naming
record and stale unsupported-if assertion were corrected, not masked. The
Go-only compiler remains pinned to upstream `main` at the post-run measurement.

API 50 extends the Go-only compiler with short-circuit Action work through the
existing conditional Plan protocol. `&&`, `||` and `??` preserve operand values,
selected-only execution and left-side Action identity. Mixed scalar/Result
bindings retain must-use checking. Snapshot 84 passes the complete serial
release, including CLI issuance, signed restoration and selected-provider
execution in installed Node/Bun consumers. All 2,298 live inputs match it after
completion. No corpus expectation, dependency baseline or exclusion changed.

API 49 introduced complete conditional source graphs in Go and their
authenticated local demand/worker adapter. Both alternatives are published;
only the selected one runs. The 280-test focused group, nineteen actual-interpreter
comparisons and complete serial release in snapshot 83 pass. Installed Node/Bun
consumers restore signed branch Plans and execute only selected providers.
This introduces no JavaScript compiler API,
runtime dependency or substitute durable scheduler. Packaged branch hosting,
rounds and the remaining runtime/default migration are still owed.

API 38 subsequently adds native keyed Plan data compilation/verification/append;
API 39 connects a checked straight-line source profile to that graph boundary.
API 40 adds the ordered-value data interpreter and storage/projection codec.
API 41 adds source-only provider value-boundary checking and compiled keyed worker
bundles. API 42 adds explicit declaration-source module closures; API 43 adds
static keyed fan-out. API 44 adds native source child-Flow graph composition;
API 45 checks complete Flow bodies before graph erasure and preserves their
combinator failure rows. API 46 composes source child Flows inside static fan-out.
API 47 adds checked enclosing Flow values to those static templates; its full
serial release, upstream and installed-package checks pass.
API 48 adds Go-derived pure computations, projected producer Ref validation and
explicit computation-defect worker exits. Installed providers and the actual
upstream SQL Control/scheduler/journal pass independent execution and real
kill/restart variants with those computations, without invoking committed work
again. No source callback evaluator or compiler-library dependency was added.
The default `vibe plan` command now delivers that native graph from source,
exact input and explicit provider claims; historical Manifest inspection is
explicit `manifest-compat`. Installed Node/Bun consumers prove CLI issuance,
signed-artifact restoration and real worker execution, with fabricated provider
claims refused. All 44 new CLI controls pass; no runtime dependency was added.
Current durable documentation examples also use that default Plan command and
independent native graph verification, with the withdrawn body model retained as
explicit history. The documentation gate's failed-JSON false-success path is
closed and covered by 29 new regression tests; neither compiler nor runtime
implementation changes in this follow-up.
The latest complete serial release checkpoint is
snapshot 89 (API 52): 417 Node, 5,225 Bun and 4,631 Go tests/subtests pass,
together with corpus, installed Node/Bun consumers,
reproducibility and docs. The same explicit expected failures and credentialed
live-model skip remain. See the [Plan interoperability record](SMITHERS-INTEROP.md) <!-- brand-gate: allow external library name -->
for its 141 upstream data comparisons, thirty-nine source-produced Plan comparisons,
release evidence, authenticated-worker integration and the still-unfinished
production scheduler host. The Go-only migration checkpoint below remains
the historical completion record for that separate migration.

Snapshot 89's final audit matches all 2,302 live inputs, with no additions,
deletions or mode/content changes. Its native executable is verified against
the recorded digest and pin. The reviewed runtime packages still return 404
at `2026-09-08T19:55:46Z`; their production packaging remains an unanswered
owner choice, not an implicit dependency addition or a completed durable host.

Snapshot 87's final audit matches all 2,300 live inputs with no additions,
deletions or mode/content changes. Upstream `main` still reports the pinned
`1f70213d4922b434345f639b441681e470c7cfc1` at `2026-09-08T18:17:03Z`.
Native compiler version is `7.1.0-dev`; the development-only npm TypeScript
`7.0.2` entry point is a Go executable launcher, not the withdrawn 5.9 compiler
API. Only the three implementation-status records change after this full run.

The subsequent static signed-source deployment and full invocation-approval
target APIs also use the same Go compiler. The complete serial release passes,
including signing regressions and installed Node/Bun consumers. A canonical-byte
decoder correction is covered; snapshot 68 was stopped to make that correction
and is not counted as a green run.
An isolated SQL Control composition now executes the authenticated node worker
through the actual reviewed scheduler and SQLite journal, including independent
work and a real SIGKILL/fresh-process resume. The Node/Bun worker API is public;
the production scheduler host and its packaging are still unfinished. The
worker and computation extension have a full serial release certificate in
snapshot 80; all 2,286 live inputs matched the tested snapshot before three
implementation-status documentation-only updates.
The CLI delivery checkpoint in snapshot 81 subsequently audited all 2,287 live
inputs with no content/mode changes or added files before its own certificate.
Snapshot 82 likewise matches all 2,290 inputs after its complete release. The
four subsequent warning-format corrections have a fresh 85-file docs build,
50 focused passing tests and rendered content/callout checks; no product or
dependency bytes changed after that release. The interop certificate records
this documentation-only follow-up separately.
Runtime packaging requires an explicit owner choice; it does not reopen the compiler migration.

API 42 extends keyed source compilation and signed restoration to explicit
multi-module declaration sources, all parsed/checked/resolved by native Go.
Imported nominal contracts and dependency-byte identity are covered by focused
native/SDK tests, installed Node/Bun consumers and the upstream Plan comparison
(now seven source-produced Plans). Its full serial release passes in snapshot
70, with every live input matching before the documentation record. No JavaScript compiler-library
fallback or new runtime dependency was introduced.

## Complete Go-only release checkpoint — September 7, API 37

Snapshot 60 completed `npm run release:verify` with exit zero, from
21:14:17 through 21:32:32 UTC. Its 2,235-input manifest SHA-256 is
`d957b0b85efaa544f8603a24015c2655f373b54419d55a83ab8ac66776fb1ae9`;
the frozen source is `/tmp/vibelang-alpha0-release.7302FX`.

- Node: 325 passed, no failures/skips/todos (186.15s).
- Bun: 4,345 passed, no failures/todos, one explicitly credentialed live-model
  skip; 29,280 assertions across 221 files (444.60s).
- Go: 4,116 tests/subtests passed, no failures/skips (compiler package 370.107s).
- All 554 corpus cases and interop gates pass with their declared expected
  failures. The CLI differential retains exactly the existing 20 reviewed
  differences: no product-only acceptance, two product refusals and eighteen
  diagnostic differences. Its baseline is unchanged.
- Two clean package builds produce identical archives; installed Node/Bun
  runtime, CLI and declaration consumers pass. The package contains 537 files,
  507 generated files and 24 exports. Archive SHA-256:
  `00418e043c90fded6bda917bc00505b44900859a3481cd33eecea22f2b0e8cf1`;
  inventory SHA-256:
  `519a88bb96121edfa2e9da6ef48af3599ff0ba7c71793f42dda73df670578ddb`.
- Documentation builds 81 files; its existing bundle-size advisory remains.
  The separately executed diagnostic-reference `--check` also passes.

The eleven fewer Bun cases than snapshot 59 are exactly the generated
runtime-boundary cases for the eleven retired `unstable/*` exports, not removed
language tests or added skips. New Node controls refuse those export paths.
The native source pin was rechecked against upstream main after the run and is
still `1f70213d4922b434345f639b441681e470c7cfc1` (`7.1.0-dev`).

Evidence is in
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-60.json`, <!-- brand-gate: allow -->
`snapshot-release-60.log` and its `.result.json` in the same directory.
This certifies the compiler migration, not the separate durable-model change or
the entire alpha-0 goal. The [durable interoperability worklist](SMITHERS-INTEROP.md) <!-- brand-gate: allow external library name -->
records the next contract; cleanup-completion precedence still needs a decision.
The worklist and this measurement entry were written after snapshot capture.

## Delivery follow-up and earlier measurements

Final delivery follow-up (API 37) is implemented and verified above.
The audit found eleven stock
TypeScript 7 `unstable/*` re-exports, including a JavaScript scanner, plus
`vibec` selecting the dependency's 7.0.2 executable rather than our 7.1.0-dev
pin. The re-exports are retired, public source tooling uses the existing native
queries, and the compatibility launcher now targets the authenticated native
executable. Its explicit `--typescript` entry calls upstream's CommandLine,
LSP/API dispatch, system and signal handling without a JS flag translator.
TypeScript is moved from product dependencies to the
development-only build toolchain; installed declaration checks use `vibec`.
The removed 22-line facade source is recoverable from
`/tmp/smithers-alpha0-verification.Wa6A93/retired-unpinned-typescript7-facades.tar.gz`. <!-- brand-gate: allow -->

The v37 build, POC typecheck and compatibility typecheck pass. The first full
four-file delivery group measured 100/101 passes, no skips (65.55s): the new
dependency-free CLI fixture omitted the rootDir which upstream requires when
changing output layout. Better harness reporting exposed TS5011; the fixture
now asserts that refusal before supplying an explicit rootDir. The unchanged
35-test isolated-package group then passes completely, no skips (22.82s),
including real native CLI emit of Unicode/space-bearing paths, declarations,
maps, wrong-type/no-output and wrong-mode/unknown-flag controls. The production
dependency inspection is empty for both `typescript` and `typescript-js`; the
lockfile records TypeScript only as the native development build tool.

The focused installed-package phase now passes: two clean builds produce the
same archive (537 files, 507 generated files, 24 exports), and installed Node
and Bun consumers pass. The first run exposed a stale declaration spelling
assertion: Go correctly publishes `ResultType as __vsResultType`, not the old
unbound `Result`. The replacement also checks the generated declarations through
the installed native CLI, with exact success/error types, the literal asset
type, and negative controls. Archive SHA-256:
`00418e043c90fded6bda917bc00505b44900859a3481cd33eecea22f2b0e8cf1`;
inventory SHA-256:
`519a88bb96121edfa2e9da6ef48af3599ff0ba7c71793f42dda73df670578ddb`.
This focused phase does not certify the complete implementation suites; the
normal release entry still runs every prepack gate before packaging.

Snapshot 59 (`/tmp/vibelang-alpha0-release.m9fIeV`, 2,243 inputs, SHA-256
`faa58a65d7bb35819cb2ef8c59f3a6eef5a2983ee90f9cc8890b391b83521bfd`)
ran the complete serial prepack gates: Node 322/322, no skips; Bun 4,356/4,356,
one credential-only skip (439.65s); Go 4,105/4,106, no skips (366.565s).
The full release stopped there, before packaging or docs. The lone Go failure
reproduced independently: the authored span was still 70/6, but retaining full
native diagnostic chains defeated the old single-line Result-message translator.
The translator now recognizes the headline separately and removes only redundant
wrapper/payload comparisons, retaining nested property explanations and unrelated
chains. Its unchanged authored-position assertion, new nested payload controls,
and the relocated-native-CLI group all pass (7.076s). No diagnostic or acceptance
rule was suppressed. Snapshot 59 does not include the v37 delivery follow-up.

The post-integration product differential exits zero: all 554 CLI cases measured,
exactly the existing 20 reviewed differences, no newly accepted invalid program
(two product refusals and 18 diagnostic differences). The baseline is unchanged.
The strengthened native publication relocation regression passes (3.076s),
including an unchanged ordinary string containing the old module spelling.

The first complete post-integration Bun run measured 4,352 passes, four failures,
and the single explicitly credentialed live-model skip (29,249 assertions,
221 files, 429.40s). All four were stdlib-port test drift: two counted the removed
JS panic helper rather than native `throw new Panic`, one executed code despite
language refusal, and one pinned old JS diagnostic cascades for excluded Match.
The replacement assertions preserve branded panic imports, exact authored panic
counts, the current authored refusal positions, and no executable code or source
maps for rejected projects. Duration remains excluded with both 1303 and 1508;
its 13 direct TypeScript behavior tests do not certify the `.vibe` port. Match
remains excluded with two module-trust errors and the Function refusal. The
focused stdlib rerun passes 33 tests, 700 assertions (7.09s). No production rule
was loosened or refusal converted to acceptance. The source-free CLI publication
regressions also pass both tests (4.09s), including execution after deleting the
original library. The final frozen release rerun still follows these repairs.

The native delivery integration now passes the complete 554-case behavioral
gate: SDK 553 pass/one xfail; standalone 540 pass/14 xfails; both interop sets
6/6; no unexpected failure, XPASS, unsupported, unmeasured or fail-open marker.
This follows a genuinely red first measurement, repairs to generated asset
forwarders and foreign lifted-value provenance, and reviewed retirement of
eleven stale markers. The corpus sources are unchanged. Full source diagnostics
remain visible, including native diagnostic chains and durable early-refusal
cascades. The focused SDK group passes 33 tests (139 assertions); the native
foreign/implicit-invocation group passes (6.158s). See conformance/COVERAGE.md for
the failure and retirement evidence. The final release gate remains pending.

The first complete Node integration run measured 321 passes/one failure, no
skips (183.10s). It exposed a source-free publication bug: ordinary imports
relocated correctly, but the compiler-generated requirement table still named
the library's old path. Its import type is synthesized after the authored-edge
walk. Both now share the same explicit native output-address relation; ordinary
strings are not rewritten. The focused native SDK declaration group passes
(4.759s); broader reruns follow the package rebuild. The historical review probe
also now consumes native diagnostic strings, removing its formatter-only import
of the retired compiler library without changing its authored reproducers.

Latest checkpoint, 2026-09-07: the remaining durable JavaScript compiler-library
implementation has been retired. `source-compiler.ts` is a thin native-query
host; `effect-manifest.ts` contains serializable interfaces/data projections;
`schema-compiler.ts` is removed. The conformance SDK host uses the Go syntax
inventory instead of the 5.9 preprocessor. Root and POC manifests and lockfiles
no longer depend on `typescript-js`, and the package managers removed that
installed alias. TypeScript 7 remains for its native toolchain and native SDK
bindings. This is a migration checkpoint, not a fresh alpha-0 release certificate.

API 36 now accepts explicit Action and child-Flow contract bindings. Go validates
codec envelopes/digests and nominal failure identities, synthesizes private
declarations, resolves real export symbols, and builds the Plan and independent
Manifest. Relative imports use both CompilerHost source-loading hooks, including
content-mapped source loading; the first regression exposed that the ordinary
hook alone never sees `.vibe` files. Imported Action versions are preserved in
nodes and manifests. Legacy weak schemas have an explicit non-structural cause,
which cannot swallow a real projection defect. Child Plan graphs remain data:
the native query validates the envelopes/contracts it binds, and the host and
runtime validate the complete graph before artifact loading or execution.

Focused binding tests passed six cases, 105 assertions (2.27s), including a real
SQLite close/reopen after child adoption without repeating either committed
Action. The isolated Go overlay passed eleven internal invariants (7.098s).
The first complete post-retirement durable run measured 604 passes and seven
failures (93.49s). Those exposed an off-by-one child-depth count, a type-only
Action being misclassified as a child, a loop projection diagnostic-order
regression, and old assertions expecting an underivable Action to fall through
to Manifest derivation. Fixes preserve earlier rejection and output-first
projection diagnostics. A focused rerun measured 95 passes and one mis-pinned
Action diagnostic assertion, subsequently corrected. The complete post-fix
durable rerun passes **612 tests, zero failures, 4,311 assertions across 56
files (100.41s)**. Native SDK typechecking passes with the 5.9 package absent.
The new subprocess test passes with compiler-library imports prohibited across
public Plan, Manifest and imported-child APIs. The full Go gate passes **4,087
tests/subtests, zero failures and zero skips** (compiler package 359.370s).
The first Node gate after retirement measured 291 passes and 26 failures. The
refusal path demanded source maps for code which the native compiler had
correctly refused to emit, masking authored diagnostics. That host assumption
is fixed, and a missing map remains fatal on accepted code. Runtime output
addresses now include native-resolver-discovered foreign files and JS aliases;
otherwise the CLI imported original `.ts` files after staging their `.mjs`
outputs. Native SDK analysis checks language roots without imposing its ambient
environment on foreign implementations, while retaining their types, syntax
refusals and trust checks. Native resolution now handles foreign TSX/JSX. Printer
notifications also cover template heads/middles/tails for exact UTF-16 maps.

Focused verification passes 28 native SDK tests (121 assertions, 4.97s), the
native SDK/analysis Go group (11.409s), and all 67 CLI/external-pipeline Node
tests with zero skips (54.33s). The harness now records real native checking
separately from checking the emitted SDK program; accepted/executed cases still
require the latter. The diagnostic census includes shared Go sources and finds
constructed codes across package-file boundaries. Full corpus, package and
release gates remain to be remeasured; the earlier full Go count predates these
SDK integration changes.

The retired three-file implementation is recoverable from
`/tmp/smithers-alpha0-verification.Wa6A93/retired-js-durable-compiler-source-backup.tar.gz`. <!-- brand-gate: allow -->
The history below records earlier checkpoints, not the current dependency state.

The private invariant coverage now executes against the real native checker
and lowerer in an isolated Go-test overlay. Nine tests cover compile-wide
nominal collision refusal under the historical bad mint, repeat-claim and
production controls, all shared qualifier vectors (including names the wire
cannot stage), capability classification, effect-site collision refusal,
durable codec classification, and compiler-module identity. The test overlay
introduces no production protocol hook and does not edit the pinned checkout.
Its nested execution test disables vet because Go vet cannot chdir into an
overlay-only package directory; the parent Go gate is unchanged.

Measurements: the first invocation was unmeasured because its checkout variable
was absent; the second exposed the overlay vet limitation and a test's incorrect
33-character declaration width (the exact declaration is 34). After correcting
those test-harness issues, all nine native invariants passed (5.304s), followed
by all 33 migrated public-observation tests (186 assertions, 3.94s). Full suites
after removal are recorded below when measured. The removed five source files
and collision-test harness were preserved first in
`/tmp/smithers-alpha0-verification.Wa6A93/retired-js-compiler-source-backup.tar.gz`. <!-- brand-gate: allow -->

The first full language run after removal passed 1,890 tests and exposed three
LSP failures: comptime's real source maps include an extension and dependency
sources, while the new body compiler accepted only plain single-source maps.
The native body map reader now validates the bounded multi-source form, pins
every source's text, maps request anchors only to the authored primary source,
and treats the comptime extension as opaque metadata, not authority. New hostile
map tests also caught and closed duplicate-field acceptance. The unchanged 29
LSP tests pass; the combined module/LSP/comptime-to-replay regression run passes
39 tests (228 assertions), including tracked-input identity preservation.

The full Go gate then ran 3,929 tests/subtests: 3,928 passed, none skipped, and
one inventory test still opened the deleted JavaScript compiler. That drift
guard now compares the Go Result surface with the actual SDK Result runtime,
alongside both embedded runtime classes; all three focused inventory tests
pass. The later full rerun below includes this repair.

The full post-repair language run is now green: 1,893 tests, zero failures,
10,221 assertions across 63 files (245.68s). This precedes the additional native
Plan input work below; it is not the final release certificate.

The Go Plan lowerer now derives queue and broadcast input contracts (format 3),
including repeated same-contract queue consumers, the shared unicast/broadcast
identity namespace, branch-contained waits and authored sequencing. The native
Manifest traversal derives their contracts independently from checked source.
The combined input fixture's Plan and Manifest digests exactly match the
pre-migration data, and the runtime's data-only Plan validator accepts them.
The focused native tests pass after correcting four new tests' unchecked array
accesses. A new native-compile → artifact-load → SQLite restart test consumes
two queue items in FIFO order, receives the broadcast, and reattaches without
re-consuming either input. The first test invocation mistakenly parsed the
wire's base64 content as JSON; fixing the harness yields 17 passing assertions.
The full durable suite now passes 602 tests, zero failures, 4,124 assertions
across 53 files (101.66s). Fan-out/loop/child binding migration and the remaining
three compiler-library consumers were still open at that checkpoint.

The native Plan lowerer now also supports bounded `loopWhile` and single- and
multi-step keyed `fanOut` templates. Shared checked template lowering handles
static projections, loop predicates and earlier fan-out step references; it
does not evaluate source. Round/step ceilings, callback capture restrictions,
strict optional/array projection checks, Action contract conflicts and native
parameter/input assignability checks run before template erasure. In particular,
explicit callback annotations cannot narrow the actual collection or loop
state to a different contract. The tests distinguish this from contextual
inference: two initially over-specific negative tests were corrected to give
the other callback an explicit compatible type, so they exercise their intended
guard. No compiler guard was relaxed.

The loop fixture and both fan-out encodings retain their pre-migration Plan,
Manifest and node digests. The focused fan-out group passes (17.475s), including
scalar arrays, empty/fixed tuples, unions of collections and the 16-step limit.
The three native Plan integration tests pass together (70 assertions, 2.78s):
SQLite restart preserves FIFO/broadcast consumption, resumes only uncommitted
loop rounds and fan-out steps, enforces the loop ceiling, preserves authored
output order and keyed child identities, and refuses duplicate fan-out keys
before dispatch. The full Go rerun is green: 4,050 tests/subtests, zero failures
or skips, all four packages passed (compiler package 349.510s). The native SDK
typecheck also passes. This measurement precedes API 36 below.

API 36 adds `compilePlanSource` / `CompilePlanSource`: standalone bounded Plan
construction or independent Manifest derivation, with explicit logical Flow
identity. It stages source privately, never evaluates it, returns data only,
and keeps an unrepresentable Plan distinct from a source refusal. The native
Plan-only declaration profile exposes Action success after `!`, while the real
nominal Result signature still owns contract derivation. Ordinary language
emission and its ownership/Result ABI are unchanged. This is not a general
checked-program proof. Imported Action/child-Flow bindings are not wired to this
API yet; the three old compiler-library consumers remain until that port lands.

The initial query tests exposed missing value-view checking at propagated
members, zero-width EOF diagnostics and byte/UTF-16 span mixing; those were
fixed rather than weakening the assertions. A new fixture also needed an
explicit Error payload field type, as required by the existing contract rule.
The query/native protocol group now passes (5.280s); the SDK protocol tests pass
three tests and 36 assertions. The Plan and Manifest bytes match ordinary Go
emission for all four input/loop/fan-out fixtures, and Manifest-only requests
return the same Manifest without constructing a Plan. The native runtime group
now tests both fan-out emission and direct query artifacts: four tests, 99
assertions, 2.92s, including SQLite restart between committed Action steps.
The SDK typecheck is green. The final full gates must follow the remaining
binding and host migration; the earlier full-run certificate is not current.

The query port also exposed a real ordinary-Go Plan erasure defect: a later
fan-out step could read an earlier step's string into a numeric Action input,
because the pre-lowering checker returned an error type and the erased body
never reached final checking. The new regression first reproduced acceptance
with no diagnostic. Templates now derive their actual serialized value
contract while checking projections, and a bounded wire-contract relation
proves compatibility with the receiving Action before erasure. Ordinary Plan
Action inputs use the same relation, including exact-codec field checks;
projection defects keep their existing output-first diagnostics. This is
serialized-contract validation, not a duplicate TypeScript type checker.
The tenth native internal invariant covers 31 compatibility cases plus the
depth ceiling. The combined durable/Plan/Manifest/protocol/invariant Go group
passes (49.871s). The full durable runtime rerun passes 605 tests, zero
failures, 4,206 assertions across 55 files (104.23s); native SDK typechecking
also passes. The remaining imported-binding/host migration is still open.

Upstream was checked again during this run: `microsoft/TypeScript` main is still
`1f70213d4922b434345f639b441681e470c7cfc1`. The retired `typescript-go` staging
repository has a different HEAD, whose README redirects development to the
original repository; it is not a newer compiler candidate for this fork.

User direction reaffirmed on 2026-09-06: compiler and tooling implementation
belongs on the current native Go TypeScript compiler. The `typescript-js`
5.9 compiler API is not an acceptable product implementation or fallback.
This supersedes the legacy JavaScript compiler-API compatibility facade, not
the language's TypeScript/JavaScript source and output compatibility.

## Required end state

- One pinned native compiler owns parsing, binding, checking, rows, ownership,
  comptime, schema derivation, durable body extraction, lowering, declarations,
  source maps, formatting and editor queries.
- Node/Bun entry points may marshal requests, provide explicit host inputs,
  commit artifacts and run JavaScript. They must not maintain another AST,
  checker, emitter or compiler-library implementation.
- No `typescript-js` dependency, direct import, re-export, compatibility alias
  or hidden fallback remains in our implementation, tooling or test drivers.
  Tests must exercise the Go implementation rather than certify the retired
  compiler. Historical review artifacts remain evidence, not product imports.
- Installed-package consumers receive the native compiler and its matching
  runtime/metadata protocol; a source checkout and local Go build must not be
  required merely to compile a program.
- The current conformance cases and reviewer regressions remain obligations.
  Two wrappers around the same Go compiler are not two independent backends or
  a differential oracle. Corpus labels and gate descriptions must say what
  they actually measure after migration.
- Missing native functionality is ported and tested before removing the
  corresponding old path. A default-backend flag change is not completion.

## Measured starting point

The public CLI defaults to `js`; `src/vibe.ts` and root compatibility aliases
expose TypeScript 5.9 compiler objects. Direct 5.9 uses also remain in project
resolution, the formatter/LSP, comptime/assets/schema, executable Flow
compilation and generated-agent compilation. The native compiler already
implements checking, rows, ownership, lowering, declaration contracts,
comptime and a bounded durable/manifest path. It does not yet replace every
public tool or the executable-body compiler.

The npm `typescript` package is already 7.0.2 and its `lib/tsc.js` is a launcher
for the native executable, not the old compiler. Renaming that launcher is
not a semantic migration. The separate `typescript-js` alias resolves 5.9.3.

The original source pin is `c087644e82dc3d48cf87e4c5519eeaaea9daf35c`, whose
native version is `7.1.0-dev`. Upstream's current stable tag is 7.0.2; going
back to that tag would also revert the post-release Go module/API integration
already used by our fork. The current Go source-line update candidate is
`1f70213d4922b434345f639b441681e470c7cfc1` (2026-09-04). All three existing
fork patches pass `git apply --check` on that candidate. That is not yet a
successful compiler build, regenerated-patch proof or upstream health gate.

## Implementation order

1. Refresh the exact native source pin, patch images, generated artifacts and
   offline source/dependency capsule. Build the bridge against the current Go
   APIs and verify the native regression suites without weakening assertions.
2. Complete a versioned Go request/result boundary for project facts and tool
   operations. Return serializable semantic results, not emulated 5.9
   `Program`, `TypeChecker` or AST objects.
3. Port executable Flow compilation and the remaining comptime/schema/loader
   operations. Preserve authored positions, capture-state identity, signed
   artifacts, durable contracts and real crash/restart behavior.
4. Route CLI, programmatic API, generated-agent compilation, formatter,
   language service, bundler and package verification through that boundary.
5. Remove the old implementation, compiler dependency and misleading API
   compatibility claims only as their tests have native replacements.
6. Run source/dependency absence checks, native unit tests, all corpus cases,
   installed-package consumers and the signed crash/restart acceptance path.

Status: **in progress**. Earlier full release snapshots are useful regression
baselines; none certifies this Go-only migration. The separate unresolved
cleanup-completion language decision is not decided by changing compilers.

## Current native-pin checkpoint

The pin and offline capsule now name `1f70213d4922b434345f639b441681e470c7cfc1`.
The capsule verifies 90 payload files and 22 Go dependency modules. The three
unchanged patches were re-recorded against the new pre/post images, and all
eight generated files reproduce exactly with upstream's current generator,
Node 22.18.0, Go 1.26.0 and dprint 0.56.1.

The first native build exposed upstream's new explicit import-attributes
argument. A narrow checker query now obtains that type from upstream's own
authored-location logic before resolving a module. This preserves attribute-
selected identity instead of passing nil everywhere. The updated bridge builds
and its native parse/check/emit/declaration/source-map test passes (23.470s).
Full native suites and migration of the remaining JavaScript compiler paths
are still required.

## Native generated-program checkpoint

Transport API v5 now has an explicit ordinary-TypeScript mode. It uses
upstream's validating compiler-option parser and the same native checker and
emitter; it refuses VibeLang kinds/extensions even through normalized paths.
An additive, file-scoped source policy uses the checked native AST to reject
host-selected module syntax and identifiers. This is not a security sandbox.
The TypeScript-only mode preserves ordinary upstream emit options and never
borrows VibeLang's mandatory-option normalization.

The generated-agent compiler no longer imports the 5.9 compiler library. Its
old class names are aliases of `NativeTypeScriptCompiler`, not fallbacks. Its
durable identity includes the actual native executable digest, API, source and
patch identities, host transport and selected policy. Generated code remains
ordinary JavaScript executed in the existing isolated runtime.

`compiler.PreparePinnedFork` and `cmd/vibec-prepare` expose the standalone
executable for build/package consumers. The package build copies it with a
digest-checked manifest; installed hosts do not invoke Go, read source checkouts
or download compilers. This first package asset is **build-host-platform only**;
multi-platform release distribution remains required. Explicit local native
overrides remain host-trusted and must match the API and source pin.

Focused measurements: all 34 native source-policy/project cases passed,
including the two normalized-extension refusals. The API-v5 host binding has
39 passing tests (including strict wire decoding, authored Unicode positions,
detached execution and changed-binary refusal). The existing agent examples
pass 86 tests with only the declared credentialed live-model skip. An isolated
Node consumer compiled, rejected invalid code and executed the result with no
dependencies, checkout, Go executable or PATH. Full native/release gates on
this checkpoint are still outstanding. Other 5.9 compiler paths remain.

## Native inspection and loader checkpoint

API v6 adds batched `SourceInspector.Inspect` / `NativeCompiler.inspect`.
Native parsing returns authored UTF-16 diagnostics and bounded module-syntax
facts, never compiler-library objects. It does not resolve imports or claim
that source has been type-checked. The request and result are separate from
compilation, with explicit script kinds and strict source-set validation.

Asset-output syntax validation and sandboxed loader/comptime-module parsing
now use inspection. TypeScript loader emission uses the native TypeScript
mode with upstream `noCheck`: this preserves the old erasure-only stage, not a
VibeLang checker bypass. Loader identities now pin the real native compiler
and transport. Import-type expressions retain their erased treatment in
loaders; the separately stricter agent policy still refuses them.

The package-verification driver also moved off 5.9: runtime-edge discovery is
one batched native inspection, and installed declaration consumers are checked
by TypeScript 7's native launcher. The formatter, language service, source
resolver, legacy public facade and other compiler stages remain to migrate.

Executed focused checks include 31 initial native inspection vectors plus a
Unicode checkpoint vector, and 76 loader/host-protocol tests. The large-input
100,001-import refusal exposed quadratic byte-to-UTF-16 conversion. Indexed
checkpoints preserve positions while reducing that test from 48.65s to 7.09s;
the test and its input budget were retained. Subsequent protocol tests and the
complete release gate still need their final run.

Snapshot 21 (2,091 inputs, `ccfb379128edf229a201787e3ae808c491d58c04e6ded98fe67cd1a2d3f01d4c`)
stopped after 265/266 Node tests: a local-clone fixture could not fetch an
unmaterialized object from the development partial checkout. The exact failed
test passes unchanged against a fresh checkout from the verified offline
capsule. This failed snapshot certifies neither the suites nor packaging; it
also predates inspection/loader migration. No expectation was relaxed.

Snapshot 22 (2,093 inputs, `94c110179383e7b6077161c76d4a869c9798f077dd0e7788a921356980ea7a14`)
passed the focused packaging diagnostic: 593 files, 545 generated files,
43 exports, installed Node and Bun consumers, and identical clean-build
tarballs including the native executable. Archive SHA-256:
`c422c571dcaade1e82f1b058aba3063a51dcd7dba0dee7548c02923c142a9b35`;
inventory SHA-256:
`181f8cc18bbf616def3214e890e49075e517537f61bf6c11dddedd15d903ba8c`.
This is packaging evidence, not a full-suite certificate. The final host and
inspection-protocol focused run passes 50 tests. The shared native host object
is additionally frozen to prevent mutation of its captured executable identity.

Snapshot 23 (2,093 inputs, `92d8014cdfd7aeb6d88c63df13f05c0de3c6ae23e2e63b5a185f6eb0acfd6e87`)
passed the complete serial `release:verify` gate against the fresh offline
checkout: Node 266/266 (133.882s), Go 2,250/2,250 with no skips, Bun 3,381
passing with only the credentialed live-model skip (23,841 assertions, 171 files,
535.11s), all 554 corpus cases against their declared baselines, the exact
20-entry product/oracle divergence record, package consumers and the 81-file
docs build. Package: 593 files, 545 generated files, 43 exports, Node and Bun
consumers. Archive SHA-256 `e2b89032b1d7ef84d6e2733a2b41846a757fcbf03d63e1c29e201775a30e6e83`;
inventory SHA-256 `4ec07ba453e067550e5b5f8a5b268dd536a2e3b2a3e71e157678ed8bd9d4ce17`.
This certifies the updated compiler pin and API-v6 migration checkpoint, **not
Go-only completion**. It predates the Unicode-boundary and formatter work below.

## Native source tools (in progress)

The native JSON boundary now rejects invalid UTF-8 and unpaired UTF-16 escapes
before Go's default decoder can silently replace them with U+FFFD. Go callers,
the standalone executable and the JavaScript binding share that fail-closed
contract. Valid scalar text, surrogate pairs and ASCII source escapes remain
valid; an escaped lone surrogate as a JavaScript string VALUE still compiles
and executes unchanged. Compiler-produced JSON is checked too. Module-specifier
facts containing an unpaired surrogate are refused rather than renamed.
Focused Unicode/host tests pass 76 cases; the shared Go wire tests also pass.

API v7 adds `SourceFormatter` and thin `NativeCompiler.format/tokenAt` bindings.
The 830-line 5.9 formatter/scanner implementation is replaced by Go code using
upstream's whitespace formatter. The native round-trip gate checks raw tokens
and comments, parsed structure and literal contents, mask identity, and line
breaks around conditional-declaration masks. Mask filler preserves both byte
offsets and UTF-16 width. Token kinds are symbolic native names, not emulated
5.9 enum numbers. The old formatter's 18 tests pass unchanged; native-only
regressions now pass too: 150 host/protocol/formatter/LSP tests (14.72s), the
native formatter/token suites including unchanged checked `.vibe` emission,
and the Go-host/standalone Unicode refusals. Additional option-projection and
non-finite-number wire regressions prevent a host option from substituting
source text or a numeric argument from becoming JSON null.

Snapshot 24 (2,099 inputs, `db455875ee4c1da4dc523f911ad051fde617eb997dbeaae11b107910421f8391`)
builds and passes 21 serial Node CLI/editor/installed-consumer tests (18.755s).
The isolated consumer now formats and looks up tokens with no dependencies,
Go executable, source checkout or PATH. The editor still uses the old semantic
frontend; only formatting and token lookup migrated in this step. Upstream
retains rather than inserts the gap before a multiline template literal, a
non-semantic layout difference from 5.9; authored literal bytes stay unchanged.
Snapshot 24 is focused evidence, not a full-release certificate, and predates
the final non-finite-number guard. The full gate on API v7 remains outstanding.

Snapshot 25 (2,099 inputs, `c70025c4f9f4ccebe268cd836628f89f57b3f182cc2cc4b9ac52059649e1c93c`)
stopped after 265/266 Node tests (133.749s). The diagnostic-availability table
still said Go had no `VIBE1900` formatter limit. The measured native census
correctly requires that row to say yes; the table and historical coverage note
were updated, with no test relaxation. This failed snapshot is not a release
certificate. The final focused host/protocol run passes 78 tests (1.206s).

The native comptime pass also now preserves a resolved lexical shadow of an
imported intrinsic. Previously its name-only fallback rejected ordinary calls
to local parameters/functions named `comptime`, contrary to the specification's
resolved-binding rule. The old test expecting that rejection was corrected to
execute the accepted program, and five additional alias, parameter, function,
mutable-local and namespace-shadow variants compile and return their authored
values (5.274s for the focused native run). No corpus expectation was changed.

Snapshot 26 (2,099 inputs, `4837034416e41dea1212327e69ff3f9cf38fcf080f82e112819ed16c6efb5b45`)
passed all 266 Node tests. Its first full-gate invocation had a mistakenly
restricted PATH without the installed Deno executable: Bun reported 3,346 passes,
92 failures and the declared credentialed skip (516.92s), including the missing-
runtime failures. The second invocation restored Deno but still omitted the
installed Rust toolchain from that PATH: Node again passed 266/266; Bun passed
3,435 with three Rust-discovery failures and the credentialed skip (543.92s).
Neither invocation reached the Go stage or certifies a release. Future runs
inherit the complete workspace toolchain; Node, Bun, Deno, Go, Rust and Zig were
individually located/version-checked before freezing the next checkpoint.
Snapshot 26 predates the native schema work below.

## Native schema derivation (in progress)

The Go comptime pass now recognizes the distinct `vibelang:schema` module by
checked declaration identity and lowers whole-argument `Schema.derive<T>()`
calls to bounded descriptors. The limits and descriptor grammar match the
existing validator; unsupported, recursive, symbolic and free-parameter types
fail closed. Go's binder uses a different internal symbol-name sentinel from
5.9, so authored `"__@x"` keys remain ordinary data. Field order is UTF-16 order.

The native executable embeds the existing JavaScript-target validator directly
from `poc/src/build/schema-runtime.ts`. A small runtime adapter supplies the
native prelude's branded Results and error codec; there is no duplicate
validator and no compiler-library dependency in the native path. The runtime
source and its Go embedding seam participate in binary and release identities.

Initial native descriptor/refusal/budget tests pass (70.280s); import aliases,
namespaces, escape/call-shape refusals and authored UTF-16 diagnostics pass too.
The propagation regression uncovered an existing native lowering bug: an
unreachable synthetic `Ok(undefined)` widened fully returning inferred
functions. Completion now consults upstream's control-flow reachability through
a narrow checker query. The schema validation/propagation regression passes
after that fix. The expanded native run passes 92 checks (115.154s), including
the existing delimiter/pending-panic regressions and four explicit/implicit
completion controls. Additional resource-node, nested-module, declaration and
source-map checks pass; the first nested declaration assertion incorrectly used
`.d.ts` instead of the product's `.d.vibe.ts` spelling and was corrected.
The final pre-packaging focused run passes 97 checks (24.857s). Sharing only
executable preparation within each table reduces overhead; each vector still
compiles in a fresh native process.

Both existing `24-schema` corpus cases measured XPASS on Go. Their markers were
retired without changing stdout or diagnostic positions, and a fresh two-driver
run passes 2/2 on each backend. The corpus remains 554 cases with 26 marked
cases (26 Go, one also JS) and 41 `messageContains` cases. The legacy JS comptime
frontend has **not** been removed. Installed-package and full-release checks on
this schema checkpoint remain outstanding.

Snapshots 27 and 28 built, but their focused installed-consumer checks failed;
neither ran the full release gate. Snapshot 27's new public function lacked its
required Result contract. Adding `ReturnType<typeof S.parse>` in snapshot 28
then exposed a genuine checker/emitter disagreement: rows recognized the native
Result type, while emission recognized only the annotation's direct symbol.
Emission now uses checked type identity, including awaited aliases. Variant
unions retain all success and failure types instead of only the first error.
Six native regressions cover conditional/indexed/ReturnType contracts, async
aliases, implicit undefined, union failures and ordinary Promise forwarding.
The combined native schema/completion/delimiter run passes 104 checks (26.383s).
The isolated package check and full serial release still need a fresh snapshot.

Snapshot 29 (2,103 inputs, `30c616ec01e7f015a934d00144153a275ff3f4109fc451d3f95774095f432bfc`)
builds and passes all seven focused Node schema/isolated-consumer checks
(4.041s). The native schema consumer compiles, executes success and validation
failure, and refuses `derive<any>` without a compiler library, dependency
installation, checkout or PATH. Its complete serial `release:verify` gate now
exits 0: Node 267/267 (134.780s), Bun 3,438 passing with only the credentialed
live-model skip (23,941 assertions, 172 files, 537.84s), Go 2,461/2,461 without
skips (compiler package 1,094.574s), and all 554 corpus expectations (JS 553 plus
one xfail; Go 528 matches plus 26 xfails). The exact 20-entry product/oracle
divergence record, installed consumers and 81-file docs build pass too.
Package: 593 files, 545 generated files, 43 exports; Node and Bun consumers.
Archive SHA-256 `17b6a1014711be47fbcf3220c5da8d792e285b0ccffb8f7a4095ba904c8ed584`;
inventory SHA-256 `c7dd32b4215a27189509b06f8ebdced709fc0220543d1f814897f1bed8cca465`.
This certifies the API-v7/schema migration checkpoint, **not Go-only completion**.
It predates the loader-registration and generated-asset-validation ports.

## Native loader registration (in progress)

API v8 adds `LoaderRegistrationAnalyzer` and the host's thin
`NativeCompiler.loaderRegistration` binding. The Go parser selects spelling-only
discovery candidates; the Go checker grants registration identity only against
the compiler-owned declaration. Its in-memory filesystem contains the supplied
source, the prelude and embedded upstream libraries, never ambient host files.
Extraction keeps authored module statements and mutations, replaces only the
registration export and removes the compiler-only import. The spelling remains
provisional; migration does not resolve the open registration API design.

`poc/src/build/loader-registration.ts` no longer imports TypeScript 5.9 or its
comptime frontend. It adds only the existing canonical content digests to native
facts. Loader execution remains in the existing hermetic sandbox. New fail-closed
regressions refuse shorthand/namespace escapes, type-only intrinsic imports and
ambient loader declarations without executable bodies.

The first native run exposed the upstream parser's absolute-path precondition
in discovery; parser-only queries now use a fixed virtual path while diagnostics
retain the caller's label. A new UTF-16 test's hand-counted column was corrected
from 40 to 41. The final native run passes 53 checks (6.052s); the focused host
and protocol run passes 58 tests (226 assertions, 6.53s), including the unchanged
sandbox execution, tracked-dependency and cache-invalidation tests. Installed
package and release verification of API v8 remain outstanding. Other legacy
compiler paths, including source-asset preprocessing, still need migration.
The broader host/protocol suite passes 134 tests (206 assertions, 2.25s).
Both the production emit project and the complete POC source/test project now
type-check under TypeScript 7. The latter initially exposed test-only assertion
generic mismatches and a heterogeneous JSON-vector inference mismatch; explicit
comparison/vector types fix those without changing runtime assertions or data.
All eight touched test files pass again (252 tests, 700 assertions, 28.27s).
The complete POC type check is now an explicit required `npm test` stage, so
test-source type errors cannot pass the runtime suite unnoticed.

Snapshot 30 (2,106 inputs, `6822f061703a34959ebbd0587b2b8fd8b99872907e05b21296e0c9efcb93601c`)
builds and passes eight serial Node schema/installed-consumer checks (5.410s).
The new isolated loader consumer recognizes and extracts a registration, rejects
a glob, preserves captured module mutation, and proves registration does not
execute a top-level throw. It has no compiler library, dependencies, checkout
or PATH. This checkpoint predates the added full-POC-typecheck gate stage and
has not run the complete release gate.

## Native generated asset validation (in progress)

API v9 adds `AssetOutputValidator` / `NativeCompiler.validateAssetOutput`. The
inert-data grammar for loader-produced modules now runs in Go; the host no
longer builds another AST to grant generated-source authority. Imports must
name declared generated dependency keys; the result returns sorted, unique
references only after the entire module passes. Calls, property evaluation,
prototype mutation, mutable/disposable declarations and nonliteral typed-array
allocation remain refused. Source bytes and evaluation order are not rewritten.

The existing 2 MiB source limit is checked before parsing. The native validator
also bounds dependency keys to 1,024 and expression nesting to 512. Initial
native tests pass 48 checks (5.150s), and the existing asset integration plus
new protocol tests pass 39 tests (283 assertions, 6.80s), including nested
tracked loader graphs and cache behavior. Full POC source/test type checking
passes. Source-asset request collection and resolution still use the old
frontend and are the remaining stages of this file's migration. API v9 has
not yet had installed-package or full-release verification.

The combined native asset/loader run passes 101 checks (9.375s). The seven-file
host/protocol integration run passes 204 tests (688 assertions, 10.29s).
Snapshot 31 (2,109 inputs, `9d3bcc787cfc6d7e5d2d904314cd7b614098c57c3b83ba817d03f347cdba9880`)
builds and passes all nine serial schema/isolated-consumer checks (6.035s).
Its new asset-output consumer validates declared generated dependencies and
refuses calls, prototype mutation and allocation without a compiler library,
dependencies, checkout or PATH. Full serial release verification is running on
that frozen snapshot; no release result is claimed yet.

Snapshot 31's full gate did not pass. Its Node run stalled at the formatter's
raw-stdout command. A macOS process sample found the main thread in forced
`process.exit` / platform shutdown waiting for a Maglev worker, with that
worker waiting for GC. The exact stuck test child was terminated; Node then
reported 269 passing and one failing test (270 total, 792.731s). Later gates
did not run. The CLI now suppresses the trailing framework envelope through
its stdout adapter and returns normally, instead of forcing exit from that
command. Formatter subprocess tests now have a 30-second timeout, and a new
negative control forbids `process.exit` during successful raw formatting.
This change and the newer asset-import port need a fresh release snapshot.

## Native asset-import discovery and resolution (in progress)

API v10 adds `AssetImportsAnalyzer` / `NativeCompiler.assetImports`. Authored
sources are parsed in Go, using the same attribute readers and asset-site
classification as the native checker. Facts carry exact UTF-16 offsets and
coordinates; no pre-parse recovery or reconstructed JavaScript AST is needed.
Grammar refusals retain their authored diagnostic codes and coordinates.
An empty import list now fails the runtime-binding rule, as an empty export
list already did; it no longer impersonates a value binding.

Optional native Bundler-mode resolution is rooted explicitly through `os.Root`.
It reads only bounded package metadata, checks code-file identities without
executing bodies, refuses symbolic aliases, and cannot resolve outside the
root. No root means no disk resolution. Resolution supports extension
substitution, directory indexes and package type entries. Host inode/hard-link
reconciliation and the existing tracked loader/cache pipeline remain in place.
The request bounds are 4,096 sources / 256 MiB total; package metadata reads
are bounded to 1 MiB each / 16 MiB total / 1,024 reads.

`source-assets.ts` no longer imports the 5.9 compiler or its grammar frontend.
The grammar regression driver now uses native syntax and checked diagnostics,
while preserving the existing corpus expectations. Initial integration passes
54 loader/asset tests (466 assertions, 11.23s); native discovery, resolution,
refusal, budget and existing import-selection tests pass 63 checks (9.275s).
The native grammar/protocol run passes 40 tests (130 assertions, 5.22s).
New JSX/lookalike coverage initially contained a malformed test regex because
its host string consumed the escapes; the fixture now uses `String.raw`.
Installed source-asset compilation and full-release verification are pending.
There are still 26 production/type-only direct compiler-library imports in
`src` and `poc/src`; this remains a migration checkpoint, not Go-only completion.

The final focused grammar/identity/protocol run passes 44 tests (167 assertions,
2.21s), and the full POC project type-checks. Snapshot 32 (2,113 inputs,
`173ac7c8db9313ebafe09e354d27bff75967124f2ce301c582eafded6dea2e19`)
builds and passes all 21 serial CLI-grammar, formatter, schema and isolated
consumer checks (23.586s). The installed asset consumer compiles JSON to a
typed module, emits and executes it through Go to obtain 42, verifies a cache
hit, rejects a code/asset alias after extension substitution, and pins an
authored diagnostic after a conditional declaration. It has no dependencies,
compiler library, checkout or PATH. Both raw formatter controls pass on the
same Node 22.4.1 runtime that stalled in snapshot 31. Full serial release
verification of snapshot 32 is running; no full-release result is claimed yet.

Snapshot 32's full run failed at Node: 270 passing / two failing tests, no
skips (137.272s). One was a real migration regression: two existing asset
corpus cases lost VIBE5201 alongside their VIBE5205. Preflight now preserves
the checked asset pass's complete selection cascade; no corpus expectation
was changed. The other was a 30-second formatter JSON subprocess timeout,
so the raw-output shutdown adjustment is not claimed to fix the runtime.

The available Node 22.12.0 runtime will be used for the next release run.
Node's [22.9.0 release note](https://nodejs.org/en/blog/release/v22.9.0#disable-v8-maglev)
confirms that Maglev was disabled by default after multiple correctness bugs.
This aligns with the sampled 22.4.1 shutdown deadlock; it is not proof of the
cause of the unsampled JSON timeout. Tests are not skipped or retried into
success, no runtime flags are being injected, and the failed runs remain
recorded. The package's Node major-version contract is unchanged; the install
guide now recommends maintained patch releases and records the observed
22.4.1 issue.

The complete `23-asset-imports` corpus area now passes on both drivers: 21/21,
identical observations, no markers or changed expectations. All ten packaged
formatter tests pass on Node 22.12.0 (9.025s). The complete POC project also
type-checks on that runtime. This is focused verification of the cascade and
runtime changes, not a full release result.

Snapshot 33 (2,113 inputs,
`424aeec677a27e61c81cc6164be1f01d4c0a4fd66ef44e7c649e3c0af6ec222e`)
builds and passes all 21 installed consumer/CLI checks on Node 22.12.0
(24.795s). Its full serial release gate is running against frozen inputs;
it predates the transpilation changes below.

## Native ordinary TypeScript transpilation (in progress)

API v11 exposes upstream Go `transpile.TranspileModule` through `Transpiler`
and the digest-checked `NativeCompiler.transpile` host binding. This is an
explicit syntax/emit operation for trusted host runtime sources and output
already checked/lowered by the language compiler, not a type checker or an
alternate path for language programs. `.vibe` and declaration inputs are
refused. Emission options have a closed allowlist and native validation;
project-resolution and checking options cannot be silently ignored. Inputs
are bounded and virtual, and a malformed file publishes no partial output.

The focused Go suite passes 49 subtests (4.491s), including actual execution
of ES modules, CommonJS, enums, namespaces, private fields, async code and JSX;
source maps, UTF-16 locations, missing dependencies, invalid options, source
sets and cancellation are covered. A type-invalid source is explicitly
accepted by this unchecked operation and refused by native checked compilation.
All 30 strict host protocol tests pass. Worker-pool module/runtime transpilation
now uses Go and its unchanged 11-test bundle suite passes (54 assertions,
11.67s), including nominal failures and signed-byte tampering. The full POC
project type-checks. Bundle import/registration analysis and checked closure
compilation still use the old frontend; the production direct-import count
therefore remains 26. The new isolated installed transpilation test has not
yet been run against a built package containing this API.

## Native worker-module analysis (in progress)

API v12 moves worker-bundle module-boundary checks and nominal-registration
discovery into Go. The native virtual binder resolves imported registration
symbols; parameter, block and catch bindings with the same spelling cannot
forge a registration. The analysis reads the actual emitted identities, does
not re-mint keys or issue implementation contracts, and rejects ambiguous
registrations across the whole closure. A refused closure returns no partial
registration facts. All runtime module edges must stay in the exact captured
closure or use the declared named compiler helpers. Dynamic/nonliteral edges,
external re-exports and helper re-exports remain refused. Unbound CommonJS
`require` now gets the same closure check; `import.meta` is refused before it
could reach a CommonJS factory. Local `require` shadows are not module edges.

The focused Go analysis suite passes 70 subtests (4.003s). The two new strict
protocol suites pass 53 tests. All 11 unchanged bundle tests pass with both
analysis and transpilation native (54 assertions, 11.95s), and the full POC
type-check passes. `pool-bundle.ts` no longer imports the JavaScript compiler;
25 production/type-only direct imports remain. Its checked implementation
closure still comes from the old frontend, so this is not a Go-only bundle
pipeline yet. The installed-package test for this analysis is authored but
not yet measured against a built package containing API v12.

Snapshot 34 (2,119 inputs,
`88558d56ac78639e6cfbddafa0a454868fea6571e40742eca69f2009cadc85cb`)
builds and passes all 23 serial installed consumer/CLI checks (27.714s).
The isolated transpilation consumer executes CommonJS private fields and ES
modules, checks embedded source-map text, and verifies syntax/.vibe/option
refusals. The isolated bundle-analysis consumer verifies lexical shadowing,
external import/re-export/require refusal and absence of partial facts. Both
run without dependencies, compiler libraries, source checkout or PATH.

## Native CLI and foreign-module erasure (in progress)

The CLI's final erasure of already-lowered language output and the resolved
foreign runtime graph now use native transpilation. Their diagnostic transport
no longer needs JavaScript `SourceFile` objects for this stage. Native parse
refusals publish no partial foreign JavaScript or maps, and authored locations
handle CR, LF, CRLF, U+2028 and U+2029 as TypeScript does. The foreign trust walk,
project checker and declaration pipeline still contain legacy compiler calls.

Snapshot 35 (2,119 inputs,
`49fa944121a457ee638e6cdc147bf3170527e6639e6e47cef3a263e55c22e2db`)
builds and passes 83 serial CLI, runtime-graph and isolated native-consumer
tests (99.613s). New controls execute all eight TS/JS/JSX module extensions,
inspect source-map source content/identity, and pin parse-error UTF-16 spans
under all five newline forms. Existing `.vibe` composed-map, durable CLI,
asset, foreign-closure and declaration tests remain unchanged and pass.
Snapshot 33's full release run is still running; neither 34 nor 35 has a full
release result yet. The source-only root type-check attempted before snapshot
35's build correctly reported stale `poc/dist` declarations (the old API had
no `transpile` method); the ordered clean snapshot build resolves that mismatch.

Snapshot 33's full release run **failed**, at the final product/oracle stage.
Node passed 272/272 (143.048s); Bun passed 3,526 with the single declared live
credential skip (24,075 assertions, 176 files, 546.55s); Go passed 2,619/2,619
without skips (compiler package 1,120.140s). The oracle found 22 differences,
two more than the recorded 20: the two invalid conditional-declaration cases
were refused as VCT1000 instead of VIBE1717. Product-accepts stayed zero.
Packaging and the documentation build did not run; this is not a green release.

The native preflight now shares the lowerer's conditional declaration shape
check, preserving VIBE1717 before the transitional comptime frontend can mask
it. No corpus or oracle-baseline entry was changed. The new cross-stage tests
also exposed two existing native defects: `var` encountered a binder assertion
before its authored-form diagnostic, and bare CR/U+2028/U+2029 made source-map
adoption fail because both Go line indexes split only on LF. Shape validation
now precedes the binder invariant; both indexes recognize all five TypeScript
newline forms and exclude terminators from line content. Added controls
compile, map and execute conditional declarations to 42 under every newline.
The ordinary-TypeScript and bundle APIs additionally refuse the internal
`.vibe.ts` dialect extension, including normalized/case variants, which must
not expose language-only syntax through unchecked erasure.

## Native implementation-function fingerprinting (in progress)

API v13 provides native canonical function spelling using the parser, factory,
transpiler and printer. It removes export/default modifiers structurally,
requires one actual function/arrow expression, never evaluates the function,
and emits no partial fingerprint on refusal. It locates its own function
binding even when native emission inserts helpers before it; the old helper
selected the first emitted variable instead. This remains only a source
fingerprint, not executable closure/capture or callback attestation.

The initial Go run passes 31 subtests (2.860s) plus 13 strict wire tests.
Implementation-contract fingerprinting now uses that operation; its module
edge discovery uses native inspection in the language dialect. Checked row
inference and failure-schema derivation in this file still use the legacy
frontend. The initial contract/bundle integration passes 23 unchanged tests
(23.14s); additional language-dialect and newline controls are being qualified.
The isolated installed fingerprint test has been added but is not yet measured
against a package containing API v13. Direct compiler-library imports remain 25.

### API v13 focused verification and serial gate

The final cross-stage runs passed 193 Go boundary/conditional checks (10.094s),
39 Go source-map/newline checks (2.325s), and 131 host integration tests (25.22s).
Snapshot 36's oracle matches the recorded 20 differences across 554 cases,
with zero product-accepts-what-corpus-refuses cases. Its focused Node run passed
83/84; the installed asset smoke itself spelled an invalid braceless conditional
declaration. That smoke now uses the required braces and explicitly asserts
VIBE1717/no generated output for the invalid form. No product rule, corpus
fixture or oracle baseline was relaxed.

Snapshot 37 (`/tmp/vibelang-alpha0-release.CyeN22`, input digest
`e42837bcb979d6a35df69f5d8e271e6f172ac6de1c9d47defe720247d798c27e`)
passes all 11 installed native compiler checks (6.055s), including API v13's
fingerprint operation with no JS compiler, Go toolchain, checkout or dependency
directory. Its full serial release gate is running on Node 22.12.0; this is not
a declaration of a green full gate for that snapshot.

## Native relative runtime graph (in progress)

API v14 exposes parser-owned literal edges, authored UTF-16 positions, leading
module trust and the native language checker's existing conservative module
initialization classifier. The runtime graph no longer parses, classifies or
resolves modules with `typescript-js`. The host retains bounded source reads,
snapshots, hard-link/output identities, asset issuance checks and graph assembly.
Native parse recovery diagnostics are explicit and are not a successful-parse
or type-check certificate; the mandatory consuming compiler owns those errors.

Optional resolution uses the Go compiler's Bundler resolver over an explicit,
read-only `os.Root`. Only package metadata can be read; source bytes are still
captured by the host. Exact runtime targets and declaration companions remain
distinct. Symbolic aliases, including attempted aliases hidden by fallback,
and ambiguous JS/TS targets fail closed. Resolver state is fresh per specifier
so a cached failed candidate cannot erase an alias refusal; package/metadata
budgets apply across the request. Without a root there are no filesystem reads.

The initial focused Go checks pass (5.637s), as do 45 strict protocol tests
(49 assertions). Installed-graph execution and the unchanged graph/CLI suites
are next. This removes one more direct production compiler-library import;
24 remain, principally in the old semantic/frontend and durable checker code.
There is still no claim that the product is Go-only.

The first graph/installed run is now 40/40 (10.208s); its one initial failure
was the new smoke test expecting rewritten source text inside an authored source
map. The corrected test requires the authored text. The native graph also
reuses scanner-owned leading JSDoc handling for comment-only modules, preserving
the host's previous marker semantics. API v14 inspection reports explicit
top-level statement membership, so CLI project discovery no longer parses with
5.9 or accidentally widens its search to nested syntax. Action binding-name
keyword checks now use the native scanner/token query.

The expanded Go run passes 134 checks (14.522s); protocol checks pass 100 tests
(104 assertions), and native/contract/bundle/source host integration passes
56 tests (305 assertions, 27.84s). The combined CLI/graph/installed run initially
passed 97/98. The remaining diagnostic preservation fix restores the distinction
between outside-root checker dependencies and runtime dependencies, before
resolution. The unchanged refusal/output-preservation test is being rerun.

### Packaged Go CLI transport

`src/go-backend.ts` now invokes the same identity-checked packaged executable
as the other native hosts. It no longer builds `cmd/vibec-go` or carries a
separate checkout lookup/preparation path. Installed compilation uses the
bundled executable; source-only workflows still use the shared native binding's
verified preparation path. All project bytes are supplied explicitly. The
command-line transport remains a real Go
compiler invocation; the default legacy language frontend is not yet removed.

Installed isolation compiles a Result-returning `.vibe` program, executes its
emitted module to 42, and rejects a type error with no artifacts, without Go,
a source checkout or JavaScript compiler dependencies. Runtime CLI tests no
longer skip for a missing source checkout. Source-build cache drift checks now
cover `poc/src/compiler/native.ts`, where source-only preparation lives.
The old checkout-required CLI assertions are replaced by proof that absent or
pristine build checkouts are unused and unmodified, and a missing explicit
native executable still fails closed. Native errors during discovery now retain
their infrastructure code and repair guidance instead of becoming generic
project errors. Full gate evidence is still from earlier frozen snapshots.

The outside-root diagnostic regression now passes its three focused CLI checks
(5.656s). `vibelang/compiler` exposes the Go-backed embedding API directly,
without loading the legacy root facade. Package/isolated-entry tests pass 23/23
(9.857s); the installed release consumer now also checks this subpath's types,
executes native output on Node and Bun, and verifies type-error refusal with no
artifacts. This adds a public native surface while the remaining old compiler
paths are ported; it is not a second implementation or a 5.9-object emulator.

## API v13 full release checkpoint / API v14 qualification

Snapshot 37 completed `release:verify` with exit 0 on Node 22.12.0:
Node 288/288 (145.891s), Bun 3,594 passing plus only the credentialed live-model
skip (24,150 assertions, 179 files, 552.62s), and Go 2,820/2,820 with no skips
(`compiler` 1132.359s). The conformance gate passed and the 554-case oracle
matches the 20-entry record exactly (0 product accepts, 2 product refusals,
18 diagnostic differences). Package consumers on Node/Bun, reproducible
clean-build archives and the 81-file docs build passed. Package inventory:
593 files, 545 generated, 43 exports. Archive SHA-256
`b76a2831789a4c2e34ca292153e673fadbe83c62957fd11c499a4f5e6ae24100`;
inventory SHA-256
`566eea9a16fcf8951d480425bccdd2e8eec79c35628431d41ca354bba0bd402b`.
This is the newest fully green checkpoint, not Go-only completion.

Snapshot 38 (`/tmp/vibelang-alpha0-release.x0iAtF`, 2,127 inputs, digest
`3650a5167d23d3be296195e0fb485510e4652950cf678e0024063da638caa16f`)
contains API v14, the runtime graph/CLI transport ports and the public compiler
entry. Its fresh focused Node run passes all 108 CLI, graph, installed and
export checks (101.621s). Its oracle and full serial release gate are next;
the API v13 full gate must not be presented as covering this newer snapshot.

Snapshot 38's standalone oracle now also matches all 20 recorded differences
exactly across 554 cases, with zero product-accepts-what-corpus-refuses cases.
Its full serial `release:verify` has started after snapshot 37 finished.

## Native JSON/config syntax (in progress)

API v15 extends inspection with the native JSON/config parser. It reports
duplicate property-key token spans, not re-encoded key values, so escaped
unpaired UTF-16 keys retain their authored bytes and identity. JSON recovery
never produces executable module facts. The host's strict `JSON.parse` remains
the data-format gate; native inspection is the subsequent duplicate-key check,
not a claim that JSONC and strict JSON are interchangeable.

CLI durable binding configuration no longer uses the 5.9 JSON parser or walks
its AST. Parent-object duplicates precede nested ones; equal cooked keys,
case-sensitive keys, separate objects and all newline forms retain their
existing treatment. The native request has a 100,000-property budget, and the
strict host decoder rejects missing, duplicate or out-of-source key spans.

Focused results: 25 Go checks (3.977s), 68 inspection/protocol tests (36ms),
successful build and POC type check, and 7 CLI/public-entry checks (11.295s).
The installed-isolation check includes escaped unpaired keys. These live changes
are newer than snapshot 38 and are not covered by its running full gate. The
production direct-import count remains 24; this removes another operation
inside a file whose legacy diagnostics still depend on the old frontend.

## Native durable-module rewrite analysis (in progress)

API v16 owns the bound call and private-helper rewrite ranges used by host-module
materialization. It uses the native program, compiler-owned Flow declaration
identity and authored UTF-16 positions. Renamed imports, namespace access,
overloads, shorthand exports, lexical shadows and const-list comma boundaries
are covered. Parse/bind refusals return no partial rewrite plan. Multiple or
nested candidates remain facts, not permission to rewrite an invalid entry.
Neither the query nor the host evaluates an initializer or an Action.

`poc/src/durable/module-compiler.ts` no longer imports or builds a 5.9 semantic
model. It assembles the checked descriptor and surviving source-map runs from
native ranges. The descriptor/body compiler itself still needs its own native
port, so this is not a complete durable-compiler replacement or language-check
certificate. The direct production import count is now 23.

The port reproduced and fixes another old rewrite defect: an exported function's
default parameter could refer to a helper that was removed from the host module.
The accepted module then threw `ReferenceError` when the export was invoked.
The native dependency closure includes complete function declarations, including
parameter defaults, rather than only their bodies. A native-emitted program
now prints `42 1,2,3`, proving the default and executable initializer order, and
three descriptor-materialization regressions preserve exported/shorthand aliases.
No durable-model or cleanup-completion decision is implied by that correction.

Focused checks pass: 111 Go inspection/JSON/durable-module checks (13.706s),
92 protocol tests (23ms), 17 descriptor/implicit-protocol integration tests
(151 assertions, 8.81s), and 7 CLI/installed-public-entry tests (11.308s).
The Go run initially exposed a malformed positive test written without the
conditional declaration's required `; condition`; the corrected positive and
braceless/var refusals all pass without a product-rule change. Build, POC type
check and brand gate pass. Installed isolation queries native durable bindings
with no compiler library, dependency directory, checkout or Go executable.
These changes still need their own frozen full release run.

## API v14 full release checkpoint / API v16 qualification

Snapshot 38 completed `release:verify` with exit 0: Node 293/293 (157.965s),
Bun 3,643 passing plus only the credentialed live-model skip (24,203 assertions,
180 files, 552.03s), and Go 2,921/2,921 with no skips (`compiler` 1143.693s).
The 554-case JS instrument has 553 passes/1 declared xfail; the Go baseline
has 528 matches with no unexpected divergence. Both have 6/6 interop controls.
The product/oracle record remains exactly 20 differences: 0 product accepts,
2 product refusals and 18 diagnostic differences. Node/Bun package consumers,
clean-build reproducibility and the 81-file docs build pass. Package: 598 files,
549 generated, 44 exports; archive SHA-256
`910c57271ec1b726584ea8d3995695e13043bf264a85ffadf47c996d89d70152`,
inventory SHA-256
`4e343697bfa554f2b0f6904c0017264801467fed42ec352de2adec4199951860`.
This is the latest fully green checkpoint, still not Go-only completion.

Snapshot 39 (`/tmp/vibelang-alpha0-release.HTpYiE`, 2,132 inputs, digest
`2a419bba86c89ef3d20044c3c73288ef15e71599c3c15a67fb9c95edda7a2d63`)
contains API v16 including JSON and durable-module migration. It builds and
passes all 113 focused Node CLI/graph/installed/export checks (99.756s).
Its full serial release run started after snapshot 38 finished. The API-v14
certificate does not cover this newer tree.

## Native declaration-schema helper (in progress)

API v17 replaces the 5.9 parser/walk in `poc/src/build/schema.ts` with native
syntax and lexical binding. This small declaration-to-validator-IR helper is
distinct from the checked `vibelang:schema` intrinsic. It retains its limited
grammar; it does not certify an entire program or substitute for the remaining
legacy checked schema/durable-contract passes. JavaScript only decodes bounded
schema data, freezes it and runs the existing validator. Direct production
compiler-library imports are now 22.

Property order remains authored order with ordinary JS integer-key enumeration.
The native result carries schema JSON as ASCII-escaped UTF-16 data, preserving
lone-surrogate keys/literals without weakening the scalar source/identity wire
contract. Duplicate fields, recursion, unsupported syntax, non-finite literals
and input/expansion/depth/output budgets fail without a partial schema. The host
decoder validates the data grammar before it reaches the public helper.

Native name resolution also prevents imported or generic names from being
misinterpreted as built-in `Array` or an unrelated outer declaration. Escaped
identifier references resolve to their actual binding. The initial run found
that upstream's editor-oriented symbol lookup returns a synthetic unknown for
the library-free Array fallback; using the explicit lexical type-name resolver
preserves the builtin while still refusing real shadows. The unchanged 37-test
build/schema suite passes (286 assertions, 4.77s).

Final focused results: 118 Go schema/durable-module checks (5.288s), 144
build/schema/protocol/module tests (523 assertions, 11.39s), and 24 installed
native/public-package tests (9.901s). Installed isolation derives and validates
hostile keys, checks field order and freezing, and distinguishes parse errors
without a JS compiler, dependencies, checkout or Go executable. One new Go test
initially expected an unresolved-name message for `undefined`; the native AST
correctly identifies its unsupported keyword, and the test now pins that precise
refusal. Build, POC type check and brand gate pass. API v17 still needs its own
frozen full release run; snapshot 39 continues to qualify API v16.

### API v17 qualification correction

Snapshot 40 (`/tmp/vibelang-alpha0-release.wj6sGI`, 2,136 inputs, digest
`cd8d9621b257b45e027f65a29daa56f9c2a0abed7522e69d9f29716ea4c335d2`)
builds and passes all 114 focused CLI/graph/installed/export checks (99.291s).
It nevertheless contains a TypeScript error in one newly added test: the generic
`parseWithSchema` result lacks an explicit type at a typed Bun `toBe` assertion.
The runtime tests pass, but the whole POC type check does not. The previous
paragraph's type-check claim was premature: a later successful command masked
that exit status. The live test now supplies the actual `"yes" | "no"` type.
Snapshot 40 is not a full-release certificate and will not be run as one with
this known error. The corrected test travels with the next frozen checkpoint.

## API v16 full release checkpoint

Snapshot 39 completed `release:verify` with exit 0: Node 298/298 (164.381s),
Bun 3,681 passing plus only the credentialed live-model skip (24,284 assertions,
182 files, 552.79s), and Go 2,998/2,998 with no skips (`compiler` 1143.233s).
The corpus remains JS 553/554 plus one declared xfail, Go 528/554 reference
matches with no unexpected divergence, and both interop controls 6/6. The
554-case oracle still matches the exact 20-entry record: zero product accepts,
two product refusals, eighteen diagnostic differences. Node/Bun installed
consumers, clean-build reproducibility and the 81-file docs build pass.
Package inventory: 598 files, 549 generated, 44 exports. Archive SHA-256
`4ed781437079d06078595ac878db06e803802964f01c21d96518b9f07ab032e9`;
inventory SHA-256
`26fb9bb98d1eb38b72bfc4c438541b8e76b5ff45f78c3ece5927a1eab8f88b45`.
This supersedes snapshot 38, but does not qualify the later schema/factory
ports and is not Go-only completion.

## Native executable-factory assembly (in progress)

API v18 replaces the final 5.9 transpile/parse/print stage in executable Flow
compilation. The native compiler erases already-lowered TypeScript and assembles
the strict JavaScript factory with an unambiguous entry binding and hygienic
runtime parameter. Unsupported imports, module metadata, module-context
await/yield/return, malformed syntax/bindings and budget overflows return no
partial output. This operation does not certify source semantics or schemas;
those earlier body-compiler phases still require their native port.

Two accepted-program defects were reproduced before the port: an authored
`__runtime` binding collided with the factory argument, and a default export
expression remained illegal `export` syntax inside the function. Native
assembly now preserves both binding hygiene and default-expression evaluation
order. Anonymous default classes retain their `default` name even when a static
initializer observes `this.name`. Named default declarations remain local
bindings. Factory bytes still participate in the existing digest/signature
chain; no authentication shortcut is introduced.

The focused native assembly vectors and eight strict protocol tests pass.
The connected public-body suite passes 25 tests/202 assertions (11.93s),
including six load-and-execute initialization/name regressions, suspension,
cleanup, replay and real process death after commit. Installed-isolation and
wider integration qualification are next. The direct production compiler-
library import count remains 22 because the earlier body checker is not yet
replaced; this is removal of an operation, not concealment of that dependency.

The broader body/deployment/implicit-call/timer/crash/protocol run now passes
96/96 tests (643 assertions, nine files, 20.76s). Installed native and package
checks pass 16/16 (9.224s), including runtime-factory execution without any
compiler library, dependencies, checkout or Go executable. Build, whole-POC
type check and brand gate pass. The release runtime/type consumers now name
the public factory request/result and execute its output; their complete
packed-artifact qualification belongs to the next frozen release run.

Snapshot 41 (`/tmp/vibelang-alpha0-release.JeapSR`, 2,139 inputs, digest
`164c29f329a78f950e3866fc1b1c6b14caec5b597c8a8666aae1921b90430054`)
contains API v18 and the corrected schema test type annotation. Its full
serial release gate is running after snapshot 39 completed; snapshot 40 is
not silently treated as green. Later live schema hardening is outside 41.

## Native persistence-schema hardening (in progress)

Preparing to reuse native contract derivation exposed three accepted-program
holes: class instances (including an empty class), accessor-bearing records,
and optional/rest tuples were emitted as ordinary durable data. Focused
reproducers had no Go diagnostics and emitted artifacts, while the legacy
body/contract path refused them. A codec for those lossy shapes is not a
correct substitute for their checked source types.

The existing native derivation now rejects those shapes, constructors,
symbol-keyed data, unsupported named generic/library records, empty field
names and non-scalar literal/field text. Native internal-symbol detection is
used instead of reserving authored strings beginning `__@`. Readonly arrays,
required tuples, optional fields, hostile ordinary keys and paired Unicode
remain data; positive tests validate the emitted artifact with the real runtime.
Depth, field, union and expansion bounds apply during traversal. An Action's
input/output/error derivation shares its node budget, including Error payload
fields, so splitting a large descriptor across fields does not reset the bound.

The first build caught an unavailable upstream convenience predicate for
method signatures; the bridge now uses the actual native AST kind. Subsequent
focused durable/UTF-16 checks pass 188/188 (54.572s), plus five complete-Action
budget checks (2.475s). These are native correctness fixes, not a replacement
of the remaining legacy checker or a new full-release certificate.

### API v18 full-gate failure: compiling crash-test child

Snapshot 41's release gate exited 1. Its Node stage passed 300/300 (160.150s),
but Bun recorded 3,732 passes, the credential-only skip and one failure
(24,369 assertions, 185 files, 560.69s). The vertical-slice SIGKILL test's
child deliberately inherits only PATH yet recompiles the Flow source. After
factory erasure moved to Go it correctly refused to compile without a native
compiler, before the intended commit/crash. The failure was not replay evidence.

The live fixture now explicitly hands both child processes the parent's
identity-checked native executable. It still inherits no checkout path or
unrelated environment, and every original commit/crash/non-reinvocation
assertion remains. The frozen tree remains a recorded failure. Go, package
consumer/reproducibility and docs stages were not reached; snapshot 39 is still
the latest complete green release checkpoint.

The corrected crash-test handoff passes all six vertical-slice tests (45
assertions, 4.28s), including the original real-SIGKILL and fresh-process
non-reinvocation assertions. No compiler fallback or inherited checkout
environment was added.

## Native standalone Action contracts (in progress)

API v19 ports `compileActionContract` to the native parser, binder and checker.
It checks one explicit declaration source against compiler-owned Action/Result
declarations and bundled standard libraries; neither relative nor absolute
imports can reach ambient host files. The bounded descriptor derivation is
shared with native durable lowering, including nominal Error identity,
canonical field/union order and the complete-Action budget. No source or Action
implementation executes. Go returns canonical contract data and authored UTF-16
diagnostics; the host validates the descriptor and renders its existing virtual
declaration. The old 5.9 standalone Program/host/parser and diagnostic walk are
removed. Earlier whole-project checker handoffs in the same module remain to
be ported, so the direct production import count is still 22, not zero.

The original 19-test schema/contract suite passes unchanged. Its first native
run showed an overly generic refusal message; the shared native builder now
names the actual unsupported type/authority. Traversal also counts expanded
string/key bytes before canonical hashing, closing the case where a small
source aliases one large literal repeatedly and only checks size after a huge
serialization allocation. A repeated half-MiB literal test refuses without
artifacts at the traversal byte budget.

A wider regression invalidated an attempted ASCII-only Error-name restriction:
the unchanged shared identity vectors explicitly require `Café` and `𝐁oom`.
The native restriction was removed, not the vectors. The actual inconsistency
was the runtime descriptor validator's old ASCII-only class-name predicate.
It now accepts ECMAScript Unicode identifiers, while separately checking the
escaped/bounded wire identity and continuing to reject whitespace, punctuation,
emoji, invalid starts and unpaired surrogates as class names. Four Unicode
regressions derive/validate native contracts, round-trip nominal payloads, load
compiled bodies and recover the authored Error class/code. The shared native
identity vectors pass again. This is a codec correctness fix, not a new syntax
or durable execution-model decision.

Focused results on this live tree: Go 256/256 durable/Action/factory/Unicode
checks (57.450s), 105 schema/body/implementation/crash/protocol tests (745
assertions, six files, 31.13s), successful build and whole-POC type check.
Installed isolation has also passed 17/17 checks (10.533s) with no compiler
library, dependency directory, checkout or Go executable. The public packed
runtime/type consumers now exercise Action contract compilation as well.
These changes still require a new frozen full release run after snapshot 41's
recorded failure.

### API v19 full-gate failure: diagnostic ownership inventory

Snapshot 42 (`/tmp/vibelang-alpha0-release.fmH1UW`, 2,144 inputs, digest
`b85bfd5182008e2decaf9a0526f1d4e41fea6cf98778fbde62f803d43806aae3`)
exited 1 at the Node stage: 300/301 tests passed (156.163s). The only failure
was the generated diagnostic reference's availability table. Moving standalone
Action derivation to Go moved the VIBE4200 report site and added native
VIBE4202/4203 report sites, but the table still described the previous sources.
The census assertion correctly caught that stale attribution. The reference
is regenerated from the corpus and the same source census; no expectation or
diagnostic is removed. Bun, Go and later release stages were not reached.
Snapshot 39 remains the latest complete green checkpoint.

Snapshot 43 (`/tmp/vibelang-alpha0-release.pVdphN`, 2,144 inputs, digest
`8b4a8dfc21120f8a80c33025e29cdf7a13d60791a33197b061a0fe5db1c5d34f`)
contains the regenerated reference; both diagnostic-inventory assertions pass.
Its complete serial release gate passed: Node 301/301 (157.721s), Go
3,172/3,172 with no skips (1,148.922s for the compiler package), Bun 3,775
passing with only the credentialed live-model skip (24,485 assertions,
187 files, 544.46s), all corpus baselines and the exact 20-entry divergence
record, installed Node/Bun consumers, reproducible archives and the 81-file
docs build. Package inventory: 598 files, 549 generated files, 44 exports.
Archive SHA-256 `1562d8d7371a06b8df3863b79838853192e0e56873238cb0080cfc8940f1bb79`;
inventory SHA-256 `54d9dc85c09910157367786ca2ee1d2129c3826b1b17ba8cbfe5e2748509a27b`.
This is the latest complete green checkpoint, not Go-only completion. Later
runtime-boundary and API-v20 changes are not part of that frozen input.

## Compiler-free durable validation and native Action API boundary

The standalone Action contract operation was native, but importing its mixed
module still eagerly loaded 5.9. `schema.ts` is now the Go transport plus data
re-exports. `schema-runtime.ts` owns unchanged codecs/descriptor validation;
the remaining 5.9 whole-project handoffs are explicitly in `schema-compiler.ts`.
Runtime artifact/authoring/worker/agent consumers use the data-only module.
Serializable implementation validation also moves to an inert leaf module;
the compiler's private issuance, retained-project and callback-pairing maps stay
private and unchanged. Integrity validation does not gain provenance authority.

Three isolated installed probes pass (1.361s): standalone contract compilation
and codec class identity; the real public `vibelang/agent` export compiling an
Action tool plus a generated program and executing it to 42; and data validation,
artifact loading and execution with no native binary, dependency directory or
legacy compiler modules. Attempting to compile without the binary fails closed.
An initial new assertion incorrectly expected a codec exception for negative
zero; the existing canonical-JSON boundary raises TypeError first. The probe now
pins that exact original error, without changing the validator.

Build and whole-POC type check pass. All 71 related schema, implementation-trust,
body-materialization, semantic-fact and agent-contract tests pass (611 assertions,
six files, 21.25s); 31 installed/public-export/diagnostic-inventory checks pass
(11.284s). The direct production/type-only 5.9 import count is still 22: this
removes a runtime dependency leak, not the remaining whole-project compiler.

## Native checked implementation facts (API v20)

`compileActionImplementationContract` now obtains its function span, transitive
capability/failure rows, Panic classification and nominal failure codec from
Go. The complete explicit source closure passes native checked lowering before
any facts are published, including unused supplied modules. Missing exports,
unresolved imports, type/row errors and non-derivable failure schemas publish
no proof. The request is bounded and compiler objects never cross the wire.
The host retains validation and its private contract/callback issuance maps;
this local pairing remains deliberately distinct from callback attestation.
All source records and the callback are captured once, so stateful host getters
cannot make checking and retained deployment evidence name different inputs.
An infallible structural Action now pins its actual `never` failure codec;
the legacy JSON-only descriptor remains the only empty row with a null digest.

Multi-file qualification exposed two existing native module gaps. The authored
resolver registered `.vibe` only for explicit suffixes, and the lowered Program
lost implicit edges even after authored resolution succeeded. Patch `0200`
generalizes the existing content-mapper extension list for implicit/`.js` alias
lookup; it contains no language-specific suffix and changes no parser or AST.
Patch `0950` adds 17 generic resolver vectors covering precedence, order,
directory indices and Node ESM's unchanged explicit-extension rule. The series
now has five patches; the eight generated AST files are unchanged. The exact
apply/unapply round trip and mechanism checks pass 19/19 without skips.

Lowering preserves the native checker's actual module targets as explicit
source edges before the existing output-name rewrite. Both imported types and
runtime re-exports retain their identity. Output rewrites use the native literal
printer for escaped names: Unicode paths previously escaped by the printer
were left pointing at `.vibe` files and could not run. New tests execute ordinary,
Unicode and quoted paths under Node and pin authored source-map positions;
ordinary strings with the same text remain unchanged.

Focused native query/module/source-map checks pass (12.832s); 90 Action/schema/
implementation/protocol tests pass (533 assertions, five files, 13.93s).
The build, whole-POC type check and brand gate pass. Installed/native/public-
export checks pass 32/32 (12.439s), including a checked multi-module Action
implementation in an isolated package with no dependencies, legacy compiler,
checkout or Go executable. Strict protocol coverage includes malformed facts,
bounded schemas, Unicode spans, wrong compiler identities and fail-closed
program errors; non-error diagnostics are not mistaken for failed checking.

The direct production/type-only 5.9 import count is now 21. The legacy whole-
program checker, executable-body extraction, CLI and compatibility facade still
need migration. These focused results do not supersede snapshot 43's complete
release certificate; the new patch series and API need a frozen full gate.

Snapshot 44 (`/tmp/vibelang-alpha0-release.sLqNjU`, 2,155 inputs, digest
`a396fe7a519cf394ac5895042944516776f709ba51ca145b24c007e9984009a5`)
freezes API v20, the runtime/schema split and five-patch series. Its release
gate exited 1: Node passed 305/305; Bun passed 3,820 with the credentialed skip
and one failed assertion (24,551 assertions, 189 files, 526.67s). The incomplete
failure-row program was correctly refused with `Result contract omits reachable
failures {Sub}`, but the new generic failure summary dropped the existing
`row checker` API context. That context is restored in the native summary;
the exact refusal and test remain unchanged. Go and later release stages were
not reached. Snapshot 43 remains the latest complete green release checkpoint;
the configuration port below is outside snapshot 44.

## Native configuration validation (API v21, in progress)

The host `validateVibeLangTsconfig` is now a thin call to Go's existing
configuration gate. Its 5.9 JSON AST/parser walk and compiler type import are
removed; the public tables are ordinary data and the table-agreement test stays.
The bounded native query reads no host path or inherited config. Both direct
compilation and the tooling query execute the same gate and produce the same
authored UTF-16 diagnostics. The host indexes line endings once for diagnostic
presentation, rather than repeatedly scanning large source prefixes.

Two native defects surfaced during the port: empty input sliced beyond EOF,
and recovered malformed JSON could pass if its recovered options looked valid.
Spans now clamp safely at EOF and native parse errors stop validation before
option checks. JSON comments and trailing commas remain accepted. No syntax
extension or inheritance-policy change was introduced.

The first build found an unused UTF-16 import after indexed conversion replaced
its only call; it was removed. A first host type check also caught a misspelled
binary-integrity helper; the new method now uses the existing digest check.
The corrected build and whole-POC type check pass. Native policy/query/parity
checks pass (8.283s), and 37 host/options/protocol tests pass (72 assertions,
5.68s). Installed tests pass 32/33 (13.040s): the sole failure is the diagnostic
inventory correctly detecting that VIBE6001/6002 no longer have JS report sites.
The reference must be regenerated from the corpus before this checkpoint can
be qualified. No test expectation was relaxed. Later focused and full gates
remain required; the direct production/type-only 5.9 import count is now 20.

The diagnostic page is regenerated from all corpus observations (73 observed,
56 unobserved codes), and both inventory assertions now pass. An escaped lone
surrogate in an unknown option name also now produces VIBE6003 at its authored
escape, rather than an invalid-UTF-8 response or silently repaired identity.
Native configuration/parity checks pass (10.148s). A first overlapping focused
run hit Bun's unchanged five-second setup timeout during source-compiler
preparation; the serial rerun passes all 52 configuration/protocol/worker-bundle
tests (3,145 assertions, four files, 6.31s). That includes the exact pool-bundle
failure-row assertion which stopped snapshot 44.

The final build, whole-POC type check and brand gate pass. All 33 installed/
public-export/diagnostic checks pass (13.186s), including native config checking
without dependencies, a checkout or Go executable, and every TypeScript newline
form after non-BMP text. The native compiler request, host wrapper and packaged
runtime/type consumers now expose configuration validation. The complete serial
release gate remains the next required measurement, not an inferred success.

The API v21 tree was frozen as snapshot 45:
`/tmp/vibelang-alpha0-release.TsrjHu` (2,158 source inputs, SHA-256
`0ade274f045d343fbfc4d609c321b5de610b1f55a0c2c389fc2114e297ac1504`).
Its serial `release:verify` run exits 0. Node passes 306/306 without skips
(201.525s); Go passes 3,221/3,221 without skips (compiler package 1,300.657s);
Bun passes 3,844 with one credential-dependent skip and no failures (27,592
assertions, 191 files, 524.22s). The 554-case product/oracle record matches its
20 declared divergences exactly: no product acceptance of a corpus refusal,
two product refusals and 18 diagnostic/position differences. Packaging verifies
610 files / 561 generated files / 44 exports, Node and Bun installed consumers,
and reproducibility. Archive SHA-256:
`54ad2fbd5673a69cbe7c360ff736eddb0d7fbd605a14849c3aad501763ce6deb`;
inventory SHA-256:
`b133258b8dfd778106f9365141e218e08f1ca32fd814b8ba56b2fc4d9998bbc6`.
Docs generate 81 files. Live API v22 work is separate and cannot inherit this
result. This first full five-patch-series checkpoint is not a Go-only release.

## Native generated-project checking (API v22, in progress)

`checkEmittedProject` / `checkEmittedTypeScript` now call the Go compiler through
the bounded `checkGeneratedProject` operation. The native host overlays explicit
absolute generated sources, including typed text at `.js` output paths. An
explicit `diskDependencies` choice controls dependency reads; no project config
is loaded, no source is executed, and filesystem writes are refused. Source,
dependency-read and response budgets fail closed. Upstream embedded libraries
remain compiler-owned. Mandatory options come from the existing native table.

Only roots and global diagnostics are returned; imported implementations supply
types without being charged the language's mandatory configuration. Exact bare
runtime overrides are resolved with upstream's resolver, then supplied through
its module mappings. A first adversarial test caught mappings taking an existing
`.js` path literally instead of its declaration sibling. Pre-resolving the
declared target fixes that without a suffix heuristic or source-text rewriting;
an unresolvable override cannot silently select a different installed package.

Diagnostics are plain data with prefixed codes, path strings, UTF-16 spans and
indexed zero-based positions. CLI, LSP and corpus presentation consumers use the
new shape. The old compiler-object module-resolver export is removed; its
remaining callback is private to the not-yet-ported declaration emitter. The
direct production/type-only 5.9 import count is 18. The legacy frontend, durable
compiler and declaration pipeline still exist; this is not a Go-only verdict.

The first native Go suite passes (4.287s), and the resolver correction passes
(4.158s). The 33 focused protocol/host/nominal/conditional tests pass with 123
assertions (4.80s). A wider first run passed 374/377 (92.36s): it exposed a real
lost nested diagnostic explanation plus two five-second loop-test timeouts
while the frozen full Go suite was running. The new operation now uses upstream
diagnostic-chain formatting, with the original expected explanation unchanged
and a native regression (Go suite 4.118s). The timeout cases require a serial
remeasurement before qualification, not relaxed assertions or inferred success.

Build, whole-POC type check and brand gate pass. Installed native/public-export
tests pass 32/32 (14.940s), including a generated two-file project and Unicode
diagnostics with no dependencies, legacy compiler, checkout, Go or PATH. The
diagnostic-inventory tests also pass. Remaining broad regressions, CLI/editor
source-map checks, corpus and full release measurements are still required.

The two loop timeouts reproduce with the full gate stopped (94/96 tests pass,
26.93s); they are not attributed only to concurrent load. They each ran dozens
of complete native-checking projects under one five-second test timeout. The
same global-object and all thirty ICU vectors now have individually named
cases, preserving every input, expected row and acceptance assertion, and
keeping the default timeout unchanged. The larger test-case census is a
decomposition of existing coverage, not newly covered semantics. A serial
qualification passes 175/175 tests (333 assertions, 25.36s), including the
unchanged full diagnostic-chain expectation. Six focused CLI/editor tests pass
(6.887s), covering literal-runtime seams, authored source maps, post-comptime
positions and live executable-Flow diagnostics. Type check and brand gate pass.
The complete corpus remeasurement is in progress. The corpus documentation now
states that its still-distinct language frontends share native generated-code
checking; this is not two independent compiler libraries.

The wider corrected run passes 477/477 tests across fourteen files (2,962
assertions, 88.65s). The first full corpus run has one unexpected diagnostic
comparison: the SDK's generated ResultValue missing-branch argument now reports
native `TS2741@11:31`, instead of 5.9's `TS2345@11:31`. Native checking of the
authored union Result still reports `TS2345@11:31`. Both reject the unchanged
program. The expectation now pins the actual generated native diagnostic and
missing-`error` message; a Go-only diagnostic marker records the distinct
signature representation. No source, required refusal, code alias or harness
comparison was weakened. Native and host unit tests additionally pin the exact
refusals and a complete-handler positive control (Go 3.551s; host 5/5 tests,
34 assertions, 705ms).

The full corrected corpus has 553 JS passes / one xfail and 527 Go matches /
27 xfails, no unexpected failures, XPASSes, unsupported or unmeasured cases,
and no fail-open markers. Raw observations agree on 528/554 cases. There are
still 554 cases, now 27 marked cases and 42 `messageContains` cases. The
product/oracle baseline has not been edited; its independent remeasurement and
a frozen full release gate remain required before this API checkpoint is
qualified. Logs are `native-generated-regressions-qualified.log`,
`native-generated-project-final.log`, `native-generated-final-match.log` and
`native-generated-corpus-qualified.json` in the verification scratch directory.

The independently measured shipped-CLI oracle exits 0: all 554 cases are
measured, and its existing twenty-entry divergence record matches exactly
(zero product-only accepts, two product refusals, eighteen diagnostic/position
differences). The baseline was not changed. The API v22 sources can now be
frozen for their own full release run; focused checks do not replace that gate.
Oracle log: `native-generated-oracle-qualified.log`.

Snapshot 46 (`/tmp/vibelang-alpha0-release.2PUZO2`, 2,163 inputs, SHA-256
`7578997dd9000768bf043bf07e1cf0797b0ce118c09475a961766f5c363772f2`)
freezes API v22. Its serial full release gate exits 1 in Node: 305/307 pass,
two fail, zero skips (194.305s). The hostile-process fixture no longer sees
Node ambient types, and the mixed foreign graph is incorrectly charged
`verbatimModuleSyntax` for its CommonJS projection. Bun, Go and packaging
stages were not reached. These are actual integration failures, not flaky
assertions. Snapshot 45 remains the latest complete release checkpoint.
Log: `snapshot-release-46.log`.

## Native declaration publication (API v23, in progress)

Declaration serialization, split-Result channel normalization, metadata
annotation/inspection and nested callable/accessor contract transfer now run
in Go. The host declaration API snapshots input data and returns text and
plain native diagnostics; the obsolete 273-line 5.9 callable-carrier file is
removed. There are sixteen remaining direct production/type-only 5.9 imports.
The legacy whole-language frontend and executable-body compiler remain, so
this is not a Go-only implementation yet. Native publication still identifies
its own runtime ABI; publishing SDK declarations does not authorize that
different runtime in the standalone language checker.

The declaration path reuses the native overlay, resolver, library and bounded
read cache. Native checked types carry callable rows and accessor placement
through stock declaration serialization. Unknown/contradictory envelopes fail
closed, ordinary foreign declarations acquire no compiler ownership, and old
v1 rows remain inspectable without granting a current calling convention.
Only compiler-owned split return channels normalize; authored correlated
unions, parameters and foreign same-spelled Result types remain unchanged.

The first build caught a missing UTF-16 import. The corrected native generated-
project group passes (4.286s), and sixty existing declaration/project/metadata/
source-free-consumer tests pass (309 assertions, 15.07s). New native tests
initially caught a malformed wrapper-depth test input (an extra closing token,
not a product relaxation); corrected native declaration/generated-project
groups pass (6.206s). Thirty-five new protocol/host checks pass (72 assertions,
1.258s). Whole-POC typing found two remaining numeric-diagnostic-category
assertions, now changed to the plain `error` data value.

Tracing snapshot 46 against the pinned upstream source found that automatic
ambient types now require the explicit `types: ["*"]` option. The generated
host now selects that native policy. Foreign source projections are marked
explicitly and checked with ordinary strict TypeScript configuration, using
a second native program over the same read snapshot; language roots still
receive every mandatory option. New negative controls pin both root checking
and foreign type errors. No diagnostic codes are filtered away.

The two formerly failing CLI cases then progress further: hostile-process
testing passes; the mixed-graph cold compile passes but its warm compile
reports TS5055 because old on-disk `.d.ts` artifacts replaced explicit generated
roots during native resolution. Sibling declaration outputs of supplied roots
are now shadowed only in the virtual input view; explicit declaration inputs
still win, external SDK declaration resolution is unchanged, and no file is
deleted. Warm output identity, changed-source refusal and read-only behavior
have dedicated controls. These latest changes still require remeasurement;
neither snapshot 46 nor these focused tests certify the completed API v23.

Both original failing CLI cases now pass unchanged, including cold/warm output
identity and hostile process/protocol behavior (2/2, 12.721s). All 139 broader
publication/accessor/generic/Result/platform/data tests pass (904 assertions,
nine files, 36.13s). Declaration artifact consumers and whitespace comparison
now also use Go, not a retired 5.9 test driver. Native publication, source-free
contracts, accessor maps and generated-project/declaration unit groups pass
(50.756s). All 33 installed/public-export tests pass (14.196s), including the
declaration API with no dependencies, legacy compiler, checkout, Go or PATH.
The ten host tests, including the warm-build control, pass (53 assertions,
1.51s). Whole-POC type checking and the brand gate pass.

The now-unused CLI compiler-object formatter and direct 5.9 import are removed
too. Doctor reports native generated checking/declarations and the still-legacy
language frontend explicitly, rather than advertising a JavaScript compiler
API version. The remaining direct production/type-only import census is now
fifteen; the CLI still reaches the legacy frontend transitively. Final build,
CLI/editor checks and a new frozen release measurement remain required.

The final API v23 build passes. Thirteen CLI/editor checks pass (34.905s),
including doctor, source maps, mixed runtime graphs and hostile test processes.
The diagnostic inventory passes 2/2. The full 554-case corpus again measures
553 JS passes / one xfail and 527 Go matches / 27 xfails, with zero unexpected
failures, XPASSes, unsupported, unmeasured or fail-open cases. Raw observations
agree on 528/554. The shipped-CLI oracle still matches the unchanged twenty-row
baseline exactly: zero product-only accepts, two product refusals and eighteen
diagnostic/position differences. API v23 changes no corpus markers or oracle
baseline. Logs: `native-declarations-cli-editor-qualified.log`,
`native-declarations-diagnostics-inventory.log`,
`native-declarations-corpus-qualified.json` and
`native-declarations-oracle-qualified.log`. A frozen full release run follows;
these focused receipts do not replace it.

Snapshot 47 (`/tmp/vibelang-alpha0-release.JrtYcJ`, 2,167 inputs, SHA-256
`0c5485ba9cad4ab2720e2c1ad9e182c19b1aed6523e5007524e4f274842a0bd6`)
freezes API v23 for a serial full release run. Its result is pending; later
live API v24 edits cannot become part of that certificate.

## Native generated-Flow boundary contracts (API v24, in progress)

The executable-body compiler's second 5.9 Program is replaced by the native
`bodyContract` query. Native checking and input/success/failure codec derivation
share one generated-project Program and bounded read snapshot. The actual SDK
ResultValue declaration is recognized by resolved symbol identity, not by the
word `Result`; generator/Promise completion extraction uses native library
identities. Pure bodies need no synthetic runtime import. Schemas use the
shared bounded structural/nominal descriptor builder, never the legacy JSON
fallback, and the host revalidates descriptor digests before constructing an
artifact. Native root diagnostics are mapped back to authored source positions.

The first bridge build caught a mistaken `ast.IsParameter` helper name. After
using the actual native AST kind, the initial native group passes (4.416s).
The build passes, and all fifty existing body execution/replay plus new protocol
tests pass (230 assertions, 11.03s), including the real process-kill/restart
fixture. More adversarial/native, installed, type-check and integration checks
remain required. The body compiler's authored semantic model, closure analysis
and first lowering are still legacy; its direct 5.9 import remains. The import
census is still fifteen, and this is not a Go-only implementation or a full
release verdict. Logs: `native-body-contract-first.log`,
`native-body-contract-second.log`, `native-body-contract-build-first.log` and
`native-body-contract-host-first.log`.

The expanded native tests initially caught a wrong newly written expectation
(`@`, not `#`, separates durable identity components). After correction they
pass (2.901s). Reviewing descriptor handoffs also found that the new caller
needed the existing distinct-Error-declaration collision guard before deriving
its error union. It now refuses colliding identical and different payloads;
the first two tests correctly refused but expected a different message phrase,
so the phrase assertions were corrected, not the required refusals. The final
native group passes (5.055s). Build, whole-POC type checking and brand checks
pass. Installed/public-export tests pass 34/34 (16.470s).

All 101 broader body/deployment/timer/implicit-protocol/value-materialization/
manifest/module tests pass (722 assertions, eight files, 32.14s). Six original
CLI/public-facade tests pass (7.557s), including signed async execution, timers,
replay and a clean Bun consumer. The runtime/type release fixtures now exercise
the new query too. Logs: `native-body-contract-native-expanded.log`,
`native-body-contract-native-qualified.log`,
`native-body-contract-collision-qualified.log`,
`native-body-contract-collision-final.log`,
`native-body-contract-installed-first.log`,
`native-body-contract-integration-first.log` and
`native-body-contract-cli-first.log`. Corpus, editor mapping and a separate
frozen API v24 release measurement remain required.

The full API v24 corpus run exits 0 with the same 553/1 JS and 527/27 Go
pass/xfail observations, 528/554 raw agreement and no unexpected, unmeasured,
unsupported or fail-open cases. The two original editor/authored-map cases
pass (11.278s). Final boundary review caught an unnecessarily shared descriptor
counter: Flow input, success and error codecs previously had separate budgets,
so the native caller now preserves that policy using the shared builder's
per-codec entry points. A 6,601-node input and equally sized output both pass;
a single over-10,000-node codec still refuses. Expanded native tests pass
(5.224s), and 28 host/protocol tests pass (43 assertions, 804ms), including
independent runtime validation of the returned canonical schema digests.
The latest build passes. Logs: `native-body-contract-corpus-qualified.json`,
`native-body-contract-editor-qualified.log`,
`native-body-contract-role-budgets.log`,
`native-body-contract-budgets-host.log` and
`native-body-contract-build-budgets.log`. The final shipped-CLI oracle is
running; no baseline or corpus expectation was changed for this port.

The final shipped-CLI oracle exits 0: all 554 cases measured, with the same
twenty-row record (zero product-only accepts, two product refusals and eighteen
diagnostic/position differences). Final type checking and the brand gate pass.
API v24 is ready to freeze for its own serial full release measurement; this
does not inherit the still-running API v23 snapshot's outcome. Oracle log:
`native-body-contract-oracle-qualified.log`.

Snapshot 48 (`/tmp/vibelang-alpha0-release.tpk3Jy`, 2,171 inputs, SHA-256
`c34bb320b293ef57eb22269476007f1cd27533dc3eb16b50d4cb8ea1c36a36fb`)
freezes API v24 and is queued behind snapshot 47. Its full release has not
started; live API v25 work is not part of either snapshot.

## Native editor module-literal facts (API v25, in progress)

Inspection now returns the exact UTF-16 range and string/template kind of a
literal module target separately from its containing module-use range. Hosts
do not reparse escapes or guess where an import attribute ends. The LSP's last
two direct 5.9 parser calls are replaced by these facts, captured with the
project text and reused for module traversal and literal navigation. The
direct production/type-only 5.9 import count is fourteen. Hover/row analysis
still reaches the legacy language frontend; this is not a native-only LSP.

The native inspection group passes (12.138s), build passes, and 108 initial
protocol/native/host tests pass (166 assertions, 2.09s). Installed/public-export
tests pass 35/35 (16.063s). The first live-editor run exposed an actual adapter
bug: editor paths are absolute, while inspection requires virtual relative
labels. The adapter now uses only a basename for that isolated syntax label;
the original absolute editor URI remains the host's module-resolution and
response identity, and the parser still receives the exact buffer text.
Windows/POSIX label regressions are added. Type checking also caught an
over-inferred test fixture comparison, now explicitly compared as unknown
wire data. These corrections still require remeasurement; none of the first
focused passes certifies the editor integration.

Snapshot 47's serial full release gate exits 0. Node passes 308/308 with no
skips (192.283s); Go passes 3,263/3,263 with no skips; Bun passes 3,981 with one
explicit credential-gated live-model skip and no failures across 195 files
(447.70s). All 554 oracle cases match the unchanged twenty-row divergence
record. Package verification inventories 610 files, 561 generated files and
44 exports, checks installed Node/Bun consumers and reproducibility, and
produces archive SHA-256
`b19baf5329637f1d207b12df8bc831f9e2270bc64f024d9ed0c7172acc162c6d`
and inventory SHA-256
`464191f4d7fefad1448f2f4885d440b23ed326cb3e79efc62b9d2d020ca31dd5`.
Docs generate 81 files. This is an API v23 regression certificate, not Go-only
completion. Snapshot 48's API v24 full release now runs serially after it.
Log: `snapshot-release-47.log`.

Snapshot 47's Go compiler package takes 1,373.693s; its Bun assertion census is
27,842. The live API v25 first editor run finishes 4/9 passing, five failing
(123.877s), due to the absolute-label adapter defect above. After correction,
all nine original/new editor tests pass (35.428s), including the native literal
navigation test through Unicode escapes, import attributes and changed editor
buffers. Six direct host/protocol tests pass (12 assertions, 408ms), and whole-
POC type checking passes. No expected diagnostic, navigation target or timeout
was weakened. Logs: `native-editor-literals-lsp-first.log`,
`native-editor-literals-lsp-qualified.log`,
`native-editor-literals-paths-host.log` and
`native-editor-literals-typecheck-final.log`. Broader remeasurement and the
API v25 full release checkpoint remain outstanding.

The corrected broader API v25 run passes 110/110 tests (169 assertions, five
files, 1.65s). Installed/public-export tests pass 35/35 (16.421s), including
editor literal links with no legacy compiler, dependency tree, checkout, Go
or PATH. Final whole-POC typing passes. The full corpus remeasurement is now
running. Logs: `native-editor-literals-host-qualified.log` and
`native-editor-literals-installed-qualified.log`.

API v25's corpus run exits 0: JS 553 passing/one expected failure, Go 527
passing/27 expected failures; zero unexpected failures, XPASS, unsupported,
unmeasured or fail-open markers. Log: `native-editor-literals-corpus-qualified.json`.

Snapshot 48's full release stops with exit 1 at the Node gate: 308/309 pass,
one fails, zero skips (194.707s). The transitive JavaScript declaration test
gets `VIBELANG_GO_TIMEOUT` from a native command after the unchanged 30-second
transport limit. The Bun, Go, packaging and docs stages do not run; snapshot
47 remains the latest complete release certificate. An unchanged isolated
rerun in the frozen snapshot passes (1.733s), which does not establish the
cause or turn the failed full run green. The entire frozen Node gate is being
rerun without competing compiler work. Logs: `snapshot-release-48.log`,
`snapshot48-declaration-timeout-isolated.log` and
`snapshot48-node-timeout-recheck.log`.

The unchanged full frozen Node recheck exits 0: 309/309 pass, no skips
(189.933s). No cause is inferred from the successful rerun and snapshot 48's
failed full release remains failed. Snapshot 49 freezes API v25 at
`/tmp/vibelang-alpha0-release.el5XYX` (2,174 inputs, SHA-256
`985185b0f7e9672c704d03ef53ba9179c5fb0b4ca965ec389fd38ff5525580c8`)
and now runs the complete release workflow. Live API v26 edits are excluded.

## Native checked schema reification (API v26, in progress)

The 5.9 type-to-schema converter is removed. Reification batches exact call
spans into one native Go program with explicit source kinds, virtual compiler
module mappings and embedded standard libraries; it has no host filesystem
or source evaluation. It shares the Go language backend's bounded schema
deriver. This query is not an intrinsic-authorization or whole-language
acceptance gate. The comptime frontend still owns recognition/lowering on
5.9; its type reification now consumes validated plain descriptors only.
Thirteen direct production/type-only compiler imports remain.

Schema cache identity now includes native compiler/bridge/transport identity,
mandatory options through the API, the complete immutable supplied source
closure, module map and query spans. The static cache already includes target
and value-graph identity. Imported-type changes cannot reuse a result merely
because the deriving module's authored bytes stayed the same. The public
checker-object helper is replaced by `deriveSchemaDescriptors`, not a fake
5.9 checker object backed by Go.

Initial native tests pass (5.336s), initial build and typing pass, all 51
schema/protocol tests pass (231 assertions, 7.05s), and installed/public-export
tests pass 36/36 (16.191s). The isolated new check resolves imported VibeLang
types and executes the existing validator with no legacy compiler, Go,
checkout, dependencies or PATH. Additional output-budget, cache invalidation,
source-recovery and whole-frontend remeasurement is pending. Logs:
`native-checked-schemas-first.log`, `native-checked-schemas-host-first.log`,
`native-checked-schemas-build-first.log` and
`native-checked-schemas-installed-first.log`.

Expanded native budget tests pass (4.589s), including a compact type whose
repeated literal expands beyond the output limit and a subsequent independent
successful query. Individual descriptor output is capped at 2 MiB and batch
output at 16 MiB. The first expanded host run passes 51/52: the new recovery
fixture incorrectly used withdrawn expression-position `if` syntax and was
rejected by the existing comptime parser, before schema derivation. It now
uses the supported conditional declaration form and asserts the correct
authored line. The corrected run passes 52/52 (245 assertions, 7.70s), including
cache misses on dependency-only edits with unchanged descriptors and native
refusals mapped through prior syntax recovery. This correction did not weaken
an existing test or change the grammar. Logs: `native-checked-schemas-budgets.log`,
`native-checked-schemas-host-expanded.log` and
`native-checked-schemas-host-qualified.log`. Broader integration is running.

The broader comptime/schema integration passes 148/148 (1,908 assertions,
six files, 23.01s). Installed/export/CLI-schema tests pass 38/38 with no skips
(17.920s); the rebuilt package includes the final native budget checks. Final
typing and brand gates pass. The full corpus is being remeasured without
marker changes. Logs: `native-checked-schemas-integration.log`,
`native-checked-schemas-installed-qualified.log`,
`native-checked-schemas-build-qualified.log`,
`native-checked-schemas-typecheck-final.log` and
`native-checked-schemas-brand-final.log`.

API v26's full corpus exits 0: JS 553 passing/one expected failure; Go 527
passing/27 expected failures, with zero unexpected failures, XPASS,
unsupported, unmeasured or fail-open markers. All 554 oracle cases match the
unchanged twenty-row record (zero product-only accepts, two product refusals,
eighteen diagnostic/code-position differences). Logs:
`native-checked-schemas-corpus-qualified.json` and
`native-checked-schemas-oracle-qualified.log`. The complete API v25 release
continues in its immutable snapshot; the next live work targets the remaining
comptime evaluator, not a compiler fallback or changed corpus expectation.

Snapshot 50 freezes the checked-schema checkpoint at
`/tmp/vibelang-alpha0-release.g0qIuF` (2,178 inputs, SHA-256
`7eaeb5f4e1a18efb2c3d23668a065f2a770e1dd1d0482a2d8e9949d16eaa6bb5`).
Its full release has not started; snapshot 49 remains active.

## Native comptime conditional scopes (API v26, in progress)

Reviewing the remaining evaluator exposed a native gap hidden by the old
frontend's pre-parse rewrite: the Go evaluator explicitly refused conditional
declarations inside comptime functions. It now interprets the native binder's
declaration-list scope, evaluates the initializer once before the condition,
shares the binding across the complete branch chain and unwinds it on return,
break and continue. No new parser rule is added. The new native execution
group passes (21.556s): eight observed successful programs and three
fail-closed cases for const assignment, escaping bindings and self-initialization.
The comptime host test driver also uses native transpilation now; the old
5.9 transpiler is no longer part of that test's execution path. Broader native
and host regression groups are running. Log: `native-comptime-conditional-first.log`.

The host conditional/comptime/schema group passes 71/71 (1,523 assertions,
20.85s), including executing the lowered conditional-scope case through native
transpilation. Log: `native-comptime-conditional-host-first.log`. The direct
native comptime regression group is still running. Before replacing the
remaining evaluator, the next lexical migration removes the legacy scanner
and conditional pre-parse planning from `recover.ts`; native binder/evaluator
support above means this adapter is no longer hiding a native scope gap.

The complete native comptime regression group passes (143.830s), recorded in
`native-comptime-conditional-integration.log`.

## Native source recovery (API v27, in progress)

The remaining legacy frontend now gets scanner tokens, expression-boundary
facts and conditional pre-parse rewrites from Go. `recover.ts` is a bounded
identity-keyed facts cache and source-map adapter, not a parser or scanner.
The native phase returns named token kinds and character-exact UTF16 mapping
runs; the host and Go bindings validate spelling, ranges and full coverage.
The native compiler itself continues to parse/bind the conditional declaration
directly. The still-unported legacy semantic analyzer translates the named
token tags to its existing enum; this does not replace that analyzer or expose
Go AST/checker objects. Direct native, protocol, provenance and installed
dependency-isolation tests are being added and run before qualification.

## Full release certificate: snapshot 49 (API v25)

The frozen `/tmp/vibelang-alpha0-release.el5XYX` checkpoint exits 0 through the
complete serial `release:verify` command: Node 311/311 with no skips (192.524s),
Go 3,301/3,301 with no skips (compiler package 1,378.301s), and Bun 4,022 passing,
one credentialed live-model skip, zero failures (27,904 assertions, 199 files,
452.84s). The 554-case oracle matches the unchanged twenty-row record, with
zero product-only accepts. Package verification passes for 613 files, 564
generated files and 44 exports, including installed Node/Bun consumers and
reproducibility; docs generate all 81 files. Archive SHA-256:
`ea162e30c4ddc744c787077cdd525745278bcd165b1b32271dec4e57d14f5afa`;
inventory SHA-256:
`385e4fb1a88e5d2d17bf6349b66266df57b521d46b2848bca40e1a741afa093c`.
Log: `snapshot-release-49.log`. This does not certify the later API v26/v27
changes or the incomplete Go-only migration. Snapshot 50's serial release
has now started after snapshot 49 completed.

API v27's direct native recovery group passes (5.151s). The first focused host
run passes 47/47 (285 assertions, 4.44s), including nested Unicode provenance,
native regex/template tokens, bounded identity fallback and malformed-wire
refusals. The broader retired-syntax/editor/format/comptime/schema group passes
109/109 (1,707 assertions, 33.56s). The rebuilt installed-package/LSP/CLI-schema/
export group passes 48/48 with no skips (17.115s); the recovery adapter loads
and runs in a package fixture without a JS compiler, dependencies or Go on PATH.
Typing and brand checks pass. Logs: `native-recovery-first.log`,
`native-recovery-host-first.log`, `native-recovery-integration-first.log`,
`native-recovery-installed-first.log`, `native-recovery-build-first.log` and
`native-recovery-typecheck-expanded.log`. Twelve production/type-only direct
5.9 imports remain; source recovery's removal does not remove the legacy
checker/emitter/comptime frontend. Full checkpoint qualification is pending
and must not be inferred from these focused runs.

Snapshot 51 freezes that API v27 checkpoint at
`/tmp/vibelang-alpha0-release.Eh9Alc` (2,183 inputs; SHA-256
`8a2c7ac05cf4793c2c20f344448f40f7a1d5a5a8ef0c285a00f0b92f6cd21718`).
Its serial full release started after snapshot 50 completed; it excludes the
subsequent comptime-phase and string-semantics changes below.

## Full release certificate: snapshot 50 (API v26)

The frozen `/tmp/vibelang-alpha0-release.g0qIuF` checkpoint exits 0 through
`release:verify`: Node 312/312 with no skips (192.005s), Go 3,323/3,323 with
no skips (compiler package 1,314.258s), and Bun 4,054 passing, one credentialed
live-model skip, zero failures (27,958 assertions, 201 files, 454.67s). The
554-case oracle matches the unchanged twenty-row record, with zero product-only
accepts. Package verification passes for 613 files, 564 generated files and
44 exports, including installed Node/Bun consumers and reproducibility. Docs
generate all 81 files. Archive SHA-256:
`5aaa7479ccd1e4bac3e92c10c093b896795bf99d559f53edb4583d45984841ab`;
inventory SHA-256:
`67b0827bd474f4ae5147bd90e3cd1cdf7bfe92b97db43f4d507f93ec06ab93f9`.
Log: `snapshot-release-50.log`. This certifies the checked-schema checkpoint,
not the later source recovery/comptime work or the Go-only end state.

## Native comptime phase planning (API v28, in progress)

A new native phase reuses the Go compiler's actual comptime analysis for
intrinsic recognition, scope, interpretation, checked schemas and generated
type aliases. It returns character-exact authored replacement plans and ordered,
alias-preserving value graphs. Cross-module observations identify the actual
initializer/return source. Evaluation errors in imported functions now name
that module, not the caller's unrelated byte offsets.

The phase has no filesystem access. It reports only reached `embed` reads;
the host can provide an immutable text/error snapshot and submit a fresh
request. Unselected target branches request no input. Incomplete or refused
plans publish no values or edits. Input indexes identify precisely which
supplied snapshots a result consumed. This is a new explicit phase operation;
the ordinary Go compilation request still refuses `embed` without this channel.
The old `compileComptimeIntrinsics` host path has NOT yet switched to it.

The first native-plan test run fails three newly written fixtures: a conditional
declaration was mislabeled ordinary `.ts`, and two fixtures used computed keys
outside both evaluators' supported literal subset. The corrected fixtures use
`.vibe`, a quoted Unicode key and `JSON.parse` to construct a `__proto__` data
property. Their runtime observations are unchanged. The native group then
passes (5.174s), including executed alias/order/loop/scoping cases, reached-input
discovery and all-or-nothing refusals. A new malformed-wire test also exposed
an accepted empty argument span; the decoder now rejects it. The corrected
host protocol/transport group passes 28/28 (40 assertions, 2.42s).

A subsequent Unicode probe found a real silent native miscompile:
`comptime("\\ud800")` became three replacement characters. The native interpreter
now uses the pinned compiler's lossless JS-string helpers. Quoting, JSON data,
string length/iteration/comparison/search/slice/split/padding, surrogate-pair
recombination and replacement substitutions preserve UTF16 semantics. Full
case mapping uses the native compiler's ECMAScript tables. Two obsolete Go
refusal assertions (Unicode case mapping and empty-search replacement) are
replaced by executed runtime comparisons, not removed from coverage. Numeric
JSON grammar and raw control characters are now validated, negative zero is
refused rather than changed to zero, and large repeat counts cannot overflow
the string-budget calculation.

The native string execution comparison passes through both the ordinary native
lowering and phase-plan emission (3.979s). Expanded plan/string/refusal groups
pass (18.316s). One expanded host run passes 28/29 but times out during a cold
source-only native build under Bun's five-second test budget. Native integration
tests now have a separate, bounded compiler-preparation hook; protocol-only
tests remain independent of compiler provisioning. No product request timeout
or existing gate budget was changed. Requalification and installed tests are
running. Transport identity now covers the graph decoder and its validator as
well as the native host/protocol files.

Logs: `native-comptime-plan-build-first.log`, `native-comptime-plan-first.log`,
`native-comptime-plan-corrected.log`, `native-comptime-plan-host-first.log`,
`native-comptime-plan-host-corrected.log`, `native-comptime-plan-utf16-probe.log`,
`native-comptime-strings-first.log`, `native-comptime-plan-strings-expanded.log`
and `native-comptime-plan-host-strings.log`.

The expanded host regression group now passes 135/135 (1,383 assertions,
five files, 11.99s), and the installed/export group passes 39/39 with no skips
(20.099s). The complete native comptime regression group passes (148.030s).
Source build, type checking and brand gates pass too. Logs:
`native-comptime-plan-host-expanded.log`,
`native-comptime-plan-installed-first.log`,
`native-comptime-plan-integration.log`, and
`native-comptime-plan-typecheck-final.log`. These qualify the new native phase;
the public comptime frontend migration follows separately.

### Public comptime host switch

`compileComptimeIntrinsics` now uses the native phase exclusively. Its old
5.9 Program, AST walks, interpreter and replacement/type-alias emitter are
removed. The host retains explicit root-confined tracked-input snapshots,
alias/order-preserving cache marshalling and source-map composition from native
authored UTF16 ranges. Native compiler/transport identity and the complete
supplied source closure enter cache and lowered-file identity. The provenance
frontend is now `vibelang-comptime-native@1`. Direct production/type-only 5.9
compiler imports fall from 12 to 11; the main language checker/emitter and
durable compiler helpers still need migration.

The first unchanged host regression run passes 113/118. Five differences expose
native gaps: surviving compiler-only re-exports/import assignments/dynamic
imports; JavaScript schema imports; the phase's genuinely-unbound-name
diagnostic; retained-function escape classification; and recursion-budget
attribution. These are fixed in Go without weakening the existing tests.
Ordinary Go compilation keeps TS2304 for an unimported name; the phase API keeps
its existing VCT1001, also based on the native checker proving no binding.
The original 118 tests then pass.

A new imported-helper probe also reproduces a real acceptance bug: a retained
runtime function borrowed its erased caller's authority to perform `embed`.
Its import would be erased while its body still referenced that intrinsic.
Phase permission now additionally requires that the called function's own
source is inside an erased region. Retained direct helpers/callbacks refuse;
erased inline callbacks retain tracked-input authority. The expanded group
passes 124/124 (1,923 assertions, five files, 15.81s); native phase/boundary
tests pass (6.346s). Broader build/CLI/installed qualification follows.

Logs: `native-comptime-host-switch-first.log`,
`native-comptime-host-switch-second.log`,
`native-comptime-retained-authority-probe.log`,
`native-comptime-host-switch-third.log`, and
`native-comptime-host-switch-go-boundaries-second.log`.

Broader build/source-map/conditional tests pass 274/274 (3,114 assertions,
15 files, 52.28s). The complete native comptime/schema group passes (282.568s).
The first installed/CLI/export group passes 41/42: its only failure is a text
assertion requiring unquoted schema keys, while the native phase emits JSON
keys. The assertion now pins that native spelling and retains the executable
schema round-trip. The rerun passes 42/42 with no skips (28.975s), including
the new comptime-host fixture with no dependency directory, Go toolchain or
checkout. Source build, type checking and brand gates pass.

The first full conformance test run passes 5/6. Go measures all 554 cases,
527 matches/27 expected failures and 6/6 interop. JS has two unmeasured cases
(551 passes/one expected failure); the old assertion omitted their identities
and reasons. Without a compiler change, the separately recorded full JSON
rerun measures all 554 JS cases: 553 passes/one expected failure, zero
unexpected failures, unmeasured cases or fail-open markers. Both affected-area
checks (16-comptime and 24-schema) also pass. The cause of the first unmeasured
results is NOT established. The conformance assertions now include those
details for future failures without changing any verdict or gate condition.
A repeat success does not turn the original failed run into a certificate.

Logs: `native-comptime-host-switch-integration.log`,
`native-comptime-host-switch-go-integration.log`,
`native-comptime-host-switch-installed-first.log`,
`native-comptime-host-switch-installed-second.log`,
`native-comptime-host-switch-conformance.log`, and
`native-comptime-host-switch-corpus-js-first.json`.

Snapshot 52 freezes this comptime checkpoint at
`/tmp/vibelang-alpha0-release.YecTUe`: 2,190 copied inputs, input-set SHA-256
`192dcc3be961eaccc13968465a75b4dd9d9dbc3be4a521575e2218c50595e9ae`.
Its full release run is queued behind the still-running immutable snapshot 51;
no release gate overlaps another release gate. This checkpoint does not remove
the remaining language/durable compiler implementation or claim Go-only alpha.

Snapshot 51's complete release gate exits zero. Node passes 313/313 with no
skips (217.579s); Go passes 3,359/3,359 with no skips (compiler package
1,459.662s); Bun passes 4,095 tests with the sole credentialed live-model skip,
28,201 assertions across 203 files (537.67s). The 554-case product differential
matches the existing 20-row record exactly: zero product-only accepts, two
product refusals and 18 diagnostic differences. Packaging verifies 613 files,
564 generated files and 44 exports, installed Node/Bun consumers and
reproducibility. Archive SHA-256:
`b3b9dccfc52286d050089cfd87d8dc56872502986676e4e1f0506abf491c7629`;
inventory SHA-256:
`bfc2fee2fcf2285ba9c78fe07a449812fe50a2931df2e5f73bf17815f4ab1774`.
Docs generate all 81 files. Log: `snapshot-release-51.log`. This certifies
source recovery/API v27, not the later comptime changes. Snapshot 52's serial
release run now starts, in `snapshot-release-52.log`.

## Native language analysis checkpoint (API v29, in progress)

The native compiler now exposes `analyzeLanguage` / `LanguageAnalyzer` for an
explicit bounded source closure. It consumes the ordinary native compilation
pipeline, not a second implementation of rows/checks. Diagnostics agree with
normal native compilation; successful compilation is reported separately from
provisional editor metadata on refused programs. Error declarations, named
functions, authored UTF-16 spans, channel/async/export flags, failure and
capability rows, and module-scope addressability cross the wire as data only.
Syntax/global failures return unanalysed empty declaration lists. No emitted
artifact, checker, symbol or AST crosses this query boundary.

The existing success-only observer used by checked implementation contracts
retains its gate after successful emit. A separately named provisional observer
is only for editor/query metadata; failed projects still receive no checked
function proof. Both host decoders validate source bounds, flags, row ordering,
completion and budgets. Go additionally checks required/null fields before
typed JSON decode, so an omitted `moduleScope` cannot silently become false.
Metadata expansion is bounded before repeated rows/class bodies are allocated.

Focused evidence (not a release certificate): native analysis/checker/lowering
integration passes in 48.045s. The Go analysis/protocol tests pass, including
malformed fields and provisional-proof separation. The host suite passes
49/49 (92 assertions, 1.84s), including the unchanged September 5 reviewer
sources: capability erasure, Result/Promise path ownership and local-time Date
operations are refused, while all three discarded effectful-call programs
compile and execute to 1. Installed native analysis and public compiler smoke
tests pass 2/2, no skips, in 1.637s with no dependencies, old compiler, Go or
checkout. Build, source typecheck and brand gate pass.

Initial test corrections are recorded rather than counted as product fixes:
two Go fixtures accidentally exported unannotated fallible functions (properly
VIBE1102), and a host fixture used a braceless conditional declaration (properly
VIBE1717). Those refusals remain explicitly tested; the accepted variants use
the required Result annotation/braced branches. The first expanded reviewer
test run also failed before execution because its relative fixture URL had one
too many parent segments; correcting that test path yields the 49-test run.

Logs: `native-language-analysis-first.log`, `native-language-analysis-second.log`,
`native-language-analysis-host-first.log`, `native-language-analysis-host-second.log`,
`native-language-analysis-integration.log`, `native-language-analysis-protocol-go.log`,
`native-language-analysis-host-review.log`, `native-language-analysis-host-review-second.log`,
`native-language-analysis-installed.log`, `native-language-analysis-build.log`,
`native-language-analysis-typecheck-second.log` and `native-language-analysis-brand.log`.

This API is available through `vibelang/compiler`; the old public analysis
wrappers have NOT yet switched. Their disk-import resolution, generated-asset
aliases/authority and recovery behavior must be carried over without silently
dropping information. No remaining legacy compiler import has been removed by
this checkpoint. Snapshot 52 is still the only running release gate and does
not include these later API v29 changes.

The final focused host run also covers comptime and source-recovery protocol
regressions: 112/112, 159 assertions, four files, 2.33s. Go analysis/protocol
checks pass in 7.942s. Snapshot 53 freezes API v29 at
`/tmp/vibelang-alpha0-release.em3WvG`: 2,194 inputs, input-set SHA-256
`9565328c4b42d0830c3990641e5e95ac81f991a0517db6b5c3ce7418722c6d57`.
It is queued behind snapshot 52, not running concurrently with it.

Snapshot 52's log records every release stage completing successfully: Node
316/316, no skips (214.346s); Go 3,424/3,424, no skips (compiler 1,345.033s);
Bun 4,130 passes and the one credentialed-model skip, 28,296 assertions across
206 files (507.17s). The 554-case differential matches the existing 20-row record
exactly, with zero product-only accepts. Packaging verifies 613 files, 564
generated files, 44 exports, installed Node/Bun consumers and reproducibility.
Archive SHA-256: `49c7ca82069b8f98f30f537304fcd52c8db36d398c930b8e29f8333ca93239fd`;
inventory SHA-256: `67c24d3300d10dbd2c7a1e561c8d8367420aa3ee7a3fdcf32d270849be92c29c`.
Docs generate 81 files. The final process result was lost across a context
handoff, so this records the stage evidence rather than inventing an observed
outer exit code. Snapshot 53 now runs serially in `snapshot-release-53.log`.

The upstream pin was rechecked on September 7: Microsoft's `refs/heads/main`
still resolves to `1f70213d4922b434345f639b441681e470c7cfc1`, matching the
installed native source pin. This is a dated upstream observation, not a
promise that a moving branch will remain unchanged.

## Native manifest closure checkpoint

A reproducer confirmed that an arbitrary object method called `context`
could perform an Action while the Go descriptor published empty action,
requirement and site sets. Native manifest derivation now follows checked
helper/alias/overload implementations and callback values, closes recursion
with a visited set, and recognizes Context reads by nominal declaration
identity. Layer discharge preserves the get site without adding a discharged
capability to the root requirement row. Mutable/opaque callables fail closed.

Expanded probes reproduced missing effects through getters, constructors,
inherited constructors, tagged templates and coercion methods. The traversal
now uses the existing native explicit/implicit invocation and accessor queries
for those edges. Compiler-prelude adapters are recognized by their resolved
declaration, with their callbacks still traversed. No source parser or runtime
calling convention changes here, and an inspectable descriptor is still not
an executable body or a resolution of the September 6 Plan/body decision.

Focused tests pass in 36.117s; the broader native Manifest/durable regression
group passes in 102.778s. Initial probe corrections are separate from product
defects: concise roots and helper `!` used unsupported historical Plan forms;
the decisive empty-manifest probe uses an accepted block root returning the
helper's Result. Unprovided capability roots remain refused by the existing
row checker; corrected positive probes provide a local Layer, and the external
requirement refusal has its own test. Existing conformance markers have not
been changed.

Logs: `native-manifest-closure-before-third.log`,
`native-manifest-closure-after.log`, `native-manifest-closure-expanded-before.log`,
`native-manifest-closure-expanded-after.log`,
`native-manifest-closure-expanded-second.log` and
`native-manifest-closure-integration.log`.

The affected 41-case durable corpus then measures 41 JS passes, 28 Go passes,
two Go XPASSes and 11 Go xfails, with no unexpected failures or unmeasured
cases. The project-helper and recursive-descriptor markers retire after exact
stdout agreement; neither fixture executes its Flow body. Notes and coverage
ledgers say so explicitly. The post-retirement rerun passes with 41 JS passes,
30 Go passes and 11 Go xfails, zero XPASS/unmeasured/unsupported/fail-open
markers. Full-corpus remeasurement is still pending. Logs:
`native-manifest-corpus-durable.json` and
`native-manifest-corpus-durable-retired.json`.

Snapshot 54 (`/tmp/vibelang-alpha0-release.RHBsZw`, 2,195 inputs, SHA-256
`cc0bc9a532077964cdab40adbeec8bd1fb2fc7b1b2e12b36e83aff51b8c211fd`)
preserves the manifest changes and the pre-removal compatibility files. It was
never run as a release gate: the two subsequently discovered stale markers
would fail it. It is superseded by the next checkpoint, not certified or rerun
with weakened marker checks.

## Public native root checkpoint

`vibelang` now resolves to the exact same module as `vibelang/compiler`, the
existing native Go request API. Root imports no longer load TypeScript 5.9 or
claim its mutable Program/checker/AST object identity. `vibelang/vibe` re-exports
that native API alongside the still-unported high-level language helpers.
The latter distinction remains explicit in the README and API contract.

The old TypeScript/tsserverlibrary aliases, pass-through plugin/type shims and
5.9 server launchers are removed (eight small implementation files, preserved
in snapshot 54). They are not relabeled as compatible Go interfaces. CommonJS
hosts use dynamic import on Node 22; `vibe lsp` is the existing editor protocol.
Package and lockfile bins, static inventory checks, docs, source/type tests and
installed consumer fixtures are updated together. There are 35 published
exports rather than 44. Nine direct production 5.9 imports remain, in the four
durable compiler modules and five language semantic/lowering modules. The
dependency cannot yet be removed, and CLI default/backend migration is not
claimed complete.

Focused evidence: build and public type checks pass. Root/API/installed tests
pass 47/47 with no skips (20.853s), including the real root import under an
isolated install with no dependencies, Go toolchain or checkout. The six root
API tests also pass on Node 22.4.1 (599ms), including CommonJS dynamic import,
so the change does not silently require Node's later synchronous require(ESM).
Runtime-boundary tests pass 35/35 (53 assertions, 192ms), and the brand gate
passes. Positive tests execute native output and compare native analysis with
native compilation diagnostics; negative tests refuse every retired alias and
assert that no old compiler-object API leaks back through the root.

Logs: `native-root-facade-build.log`, `native-root-facade-types.log`,
`native-root-facade-integration.log`, `native-root-facade-node22-4.log`,
`native-root-facade-runtime-boundary.log` and `native-root-facade-brand.log`.
Snapshot 53 remains the sole active release gate and predates this checkpoint.

Snapshot 55 freezes the public native root and marker retirements at
`/tmp/vibelang-alpha0-release.pfjBNY`: 2,187 inputs, input-set SHA-256
`a672885510573b0a913de42b45bfec3c9a7a69fe96df4c7a41cc2d61ea99252a`.
It is queued behind snapshot 53; superseded snapshot 54 will not run.

## Full release certificate: snapshot 53 (API v29)

Snapshot 53's complete serial `release:verify` exits 0 (the outer process result
was collected): Node 317/317 with no skips (214.608s), Go 3,457/3,457 with no
skips (compiler package 1,357.349s), and Bun 4,180 passes plus the credentialed
live-model skip, zero failures (28,389 assertions, 208 files, 524.41s). The full
554-case oracle matches the existing twenty-row record exactly, with zero
product-only accepts. Packaging verifies 613 files, 564 generated files and
44 exports, installed Node/Bun consumers and reproducibility. Archive SHA-256:
`78843f24d35833f44a19b737bf7341c7711b4630a581d2e689ca21970f290fbf`;
inventory SHA-256:
`318b07ecd8673fd991b96f5df9d6d8e87567a834acb89bbb300d6a1ce904c45f`.
Docs generate 81 files. This certifies API v29, not the later native package
root, manifest closure or marker retirements. Snapshot 55 now runs serially in
`snapshot-release-55.log`; its outer result is also persisted beside the log.

## Native construction closure follow-up

Two new probes reproduced empty Action/site sets for accepted class-field
initializers, including a derived class with an inherited constructor. Native
manifest construction now follows the actual class value, its immutable aliases,
instance initializers, base chain and constructor bodies. An explicit `super()`
over a synthesized base constructor shares that closure. Mutable/reassigned,
opaque and structurally collapsed constructor choices fail closed instead of
trusting a selected type signature. Static initializers are not new-instance
initialization. There is no parser or runtime ABI change.

The original two probes fail before the fix; their group then passes in 32.492s.
The expanded construction/Manifest/durable group passes in 127.231s, including
default constructors, private fields, aliases, class expressions, three distinct
base/derived/constructor sites and five ambiguity refusals. One negative-control
fixture originally invoked an Action during module initialization while loading
its descriptor; it now uses an unselected static branch to observe only the
construction set. This is a fixture correction, not executable Action support.
Logs: `native-manifest-initializers-before.log`,
`native-manifest-initializers-after.log`, `native-manifest-initializers-expanded.log`
and `native-manifest-initializers-integration.log`. Snapshot 55 predates this fix.

## Snapshot 55: implementation gates passed, packaging failed

The outer release process exits 1, recorded in
`snapshot-release-55.log.result.json`. Node passes 316/316 with no skips
(216.992s), Go passes 3,480/3,480 with no skips (compiler package 1,388.141s),
and Bun passes 4,180 with the sole credentialed live-model skip (28,389
assertions, 208 files, 526.91s). The 554-case product oracle matches the existing
twenty-row record, with zero product-only accepts. This is not a release
certificate: installed runtime smoke still called the now-removed root
`transpileModule`/numeric enum API while checking comptime values. It fails
before the installed Bun consumer and docs gate.

The live smoke fixture now uses the native transpilation request. Its execution,
insertion-order and alias-identity assertions are retained. Snapshot 55 remains
unchanged and failed; this correction requires a fresh package measurement.

## Native single-source analysis checkpoint (API v30)

`analyzeSource`, `parseErrors` and `parseFunctions` now marshal to native
language analysis, without a JavaScript compiler fallback. Native dependency
discovery optionally reads an explicitly bounded directory through upstream's
resolver, snapshots transitive source/declaration/asset bytes and package
metadata, and then uses the ordinary in-memory pipeline. Supplied bytes win
over disk. Symlinks, invalid UTF-8, oversized source/closures and malformed roots
are refused; no config or module body is executed. Foreign JS uses native JSDoc
types. The query exposes only explicitly requested files, and foreign dependency
diagnostics retain their identity in the public single-file view. Positions
remain UTF-16, with an indexed line lookup and prototype-safe row tables.

The switch exposed native return-lifting gaps: the upstream checker still sees
`!` as a non-null assertion, and inferred-fallible calls are not typed as Results
before lowering. The native emitter now follows post-lowering channels through
transparent wrappers, choices and unannotated, unwritten bindings. Its memoized
walk is bounded; writes through nested closures and destructuring prevent trusting
an initializer. Positive cases execute both channels; mixed changed bindings
remain refused. An immediate unannotated `Result.try` callback keeps its raw throw
for the adapter to catch, while explicitly Result-returning callbacks keep their
own channel. The built-in `Panic` type now resolves to the same nominal declaration
as the imported constructor. Static-block refusal no longer cascades into a
top-level-throw diagnostic.

Retired prefix type markers are found on the recovered native AST, including
beside another retired spelling. Parse-refused trees use the grammar gate;
complete trees retain semantic checking and its independent contract diagnostics.
Analysis can continue after
a language refusal only on a syntactically complete upstream tree, retaining the
original diagnostic and publishing provisional metadata. Actual parse failures
still stop semantic analysis; refused source produces neither code nor a checked
implementation proof. No parser syntax or cleanup-completion decision changes.

Focused evidence so far: the original two-file switch failed five tests after
the JS-option/Panic corrections; its four-file rerun passes 161 tests (398
assertions, 27.08s). New public/native protocol tests pass 63 tests (139
assertions, 3.36s); installed native/root tests pass 39/39 with no skips
(21.183s), including a detached single-source adapter with no dependencies or Go
toolchain. Build and the native source/test type check pass. The initial return
probes reproduce eleven lowering failures; the first fix leaves only the authored
adapter-throw refusal, and the subsequent native analysis/return/adapter group
passes in 37.583s. A comma probe's pure left operand was corrected to a real call
to avoid testing TypeScript's unrelated TS2695 diagnostic. Expanded native,
full language and packaging measurements remain pending.

Logs: `native-public-source-first.log` through `native-public-source-fourth.log`,
`native-return-channel-before.log`, `native-return-channel-after.log`,
`native-source-analysis-return-second.log`, `native-source-public-api.log`,
`native-source-analysis-build.log`, `native-source-analysis-types.log`, and
`native-source-analysis-installed.log`. `analyzeProject` and the remaining nine
direct production compiler-library imports are still legacy; this checkpoint
does not certify the combined language entry or the Go-only migration complete.

### Native single-source parity follow-up

The first complete language-directory run measured 1,827 passing and 42 failing
tests (`native-public-language-full.log`). Four failures came from row-table
fixtures that called an undefined `fail`; those fixtures now use ordinary typed
throws, preserving every row-identity and declaration assertion. The other
failures exposed native gaps: missing default disposal types, over-broad retired
keyword recognition, conditional-header diagnostics, and private runtime export
classification. All five affected public test files now pass: 78 tests, 331
assertions, 20.13s (`native-public-source-gaps-second.log`).

Default language libraries now come from the pinned compiler's own parsed
reference aggregator, plus disposal declarations. Explicit `lib` requests,
including an empty list, remain authoritative. The initial full-library filename
approach was invalid in upstream's explicit-lib registry and was corrected; the
subsequent bundled-URI path-join error was also caught and corrected. The added
ESNext check intentionally does not execute retained `using` syntax on the Node
22 fixture; the default and ES2022 outputs both execute disposal. Native
TypeScript-only option handling remains separate and unchanged.

Private runtime export checks use the exact compiler-module registry and the
original namespace binding, not package prefixes or local spelling. Native
constructor reads also use checker-resolved computed members. Type-only imports
and user-owned names remain outside this rule. Retired-token guards cover legal
member names, ASI and return-type identifiers; complementary native tests include
a separate parse error so the recovery gate cannot misclassify them.

An expanded native run passed these areas except a new conditional-preflight
control: a malformed header's recovered tree looked like a braceless branch.
Preflight now checks branch shapes only on a complete AST; parse-refused headers
use the same native grammar diagnostic as compilation. Its expanded conditional
and default-library checks pass in 6.842s
(`native-source-analysis-preflight-final.log`). The complete language-directory
rerun passes 1,869 tests, zero failures, 9,902 assertions across 61 files in
284.47s (`native-public-language-final.log`). Shared corpus remeasurement and a
fresh installed-package checkpoint remain pending.
No refusal was turned into an expected failure and no cleanup semantic decision
was made by these changes.

The final focused native group passes in 64.479s
(`native-source-analysis-final-native.log`), including the explicit control that
the ambient `Panic` type installs no constructor value. The complete 554-case
corpus records JS 553 pass/one xfail and Go 529 pass/24 xfail/one XPASS; there are
no ordinary failures, unsupported/unmeasured cases or fail-open markers. Both
backends pass all six ordinary-TypeScript interop cases; raw observations agree
on 531 cases. The sole XPASS is the ambient `Panic` type fixture. The migration
preserves that existing public-frontend spelling, and `failures.mdx` now states
its alpha-0 availability separately from the imported constructor/function.
Its marker is retired without changing source or expected diagnostics; the
focused post-retirement run passes identically on both backends. There are now
24 marked cases (all Go, one also JS). Evidence:
`native-source-analysis-corpus-first.json` and
`native-source-analysis-corpus-retired.json`. The corpus CLI returned zero with
the XPASS; that is measurement evidence, not the stricter stale-marker release
gate's certificate. Packaging and the new full release still need measurement.

Snapshot 56 (`/tmp/vibelang-alpha0-release.aPzkNE`, 2,191 inputs,
`260d0fe77f053868d98e8dfebfad2367b0a48d8f0ad85d7018996e41371c9b21`)
builds and passes native source/test type checking plus 39/39 installed-native
API tests (zero skips, 20.977s). Its focused package diagnostic fails before
consumer execution: the root README linked to `compiler/README.md`, which is
not shipped. The live README now points readers to the published native type
contract without that broken package-relative link. The snapshot is unchanged;
no full release was run on it. Logs: `snapshot-56-build.log`,
`snapshot-56-types.log`, `snapshot-56-installed-native.log`, and
`snapshot-56-package-diagnostic.log`.

Snapshot 57 (`/tmp/vibelang-alpha0-release.uMlUKv`, 2,191 inputs,
`0bc2d9b7324f1b344a60de3590147bee0df8b1ed622bf738a1cd73e7fa58eb86`)
includes that README correction. Build and the focused package diagnostic pass:
604 package files, 563 generated files, 35 exports, installed Node and Bun
consumers, CLI/type-contract checks and identical archives across clean builds.
Archive SHA-256:
`ee51e7cf54d38f4cafd0419ed434fac084fa33ae2fbb82d124b8ad985e896515`;
inventory SHA-256:
`295737f30512ad6fa1ed7501001b5e41b2ae2627744a6431a054fd3a11fa1893`.
This includes the corrected native-transpiler comptime smoke that blocked
snapshot 55. Logs: `snapshot-57-build.log` and
`snapshot-57-package-diagnostic.log`. Its complete serial `release:verify` is
now running through the persisted outer-exit recorder
(`snapshot-release-57.log` / `.log.result.json`); packaging alone is not a
full-release certificate or Go-only completion.

Snapshot 57's full serial release returned observed outer exit 1
(`snapshot-release-57.log.result.json`, 10:11:04–10:22:52 UTC). Node passed
317/317 with no skips in 210.650s. Bun recorded 4,192 pass, one credential-only
skip and one failure, 28,403 assertions across 209 files in 494.58s. The failing
schema-runtime private-hook matrix reached the snapshot's symlinked
`node_modules` before diagnosing the authored import. The native resolver now
maps that exact schema-runtime name to its already embedded module; this grants
neither prelude identity nor foreign initialization trust. New tests use a
symlinked dependency directory and assert the intended refusal, with an adjacent
non-compiler-name control still refusing the symlink. No later release stages
are certified by this failed run. The earlier focused package pass remains
separate evidence, not a full certificate.

## Native public project analysis (API v31, in progress)

`analyzeProject` now calls the native query and `analyze.ts` no longer imports
the old semantic model. It preserves caller file labels and authored UTF-16
locations. Foreign dependencies can resolve beneath the root without reading
omitted `.vibe` inputs. Native and Bun tests prove that invalid bytes in an
omitted file are never read, including through a foreign re-export; explicit
overlay bytes still win. Thin host path/option handling does not parse or check
the language.

Checker-only runtime aliases use native forwarding modules, preserving exported
symbol identity rather than duplicating declarations. The host's existing
nominal issuance check survives; structural copies remain foreign modules.
Go additionally validates claimed data as a closed inert graph, with no arbitrary
type casts/annotations, ambient references, executable expressions, unissued
dependencies, cycles or paths longer than 128 modules. Native dependency heights
are memoized rather than just marking visited nodes, so a previously checked
shared tail cannot hide a later over-depth path. Aliases are query inputs, not
executable deployments or implicit emitter output mappings.

The first public project run found three gaps without changing its assertions:
an unspelled generic failure-row template lacked VIBE1803, Error.match's missing
case message dropped the resolved module qualifier, and module-level foreign
property reads missed VIBE1506. The native checker now handles those cases.
The foreign-read check is one runtime-syntax walk, also covering parameter
defaults and class initialization while excluding type-only references. Initial
new regression failures exposed a missing parameter-default traversal and an
incorrect test message; both were corrected. The initial runtime-graph test used
shorthand properties outside the existing loader's admitted data grammar; its
fixture now uses that grammar's ordinary explicit data properties, without
loosening admission.

Measurements: the explicit-source Go test passes in 4.288s and its Bun transport
test in 2.97s (ten assertions). Project/native/ownership tests pass 35/35, 202
assertions, in 7.61s (`native-public-project-fourth.log`); a fresh process executes
all four public analysis operations with both compiler-library package imports
prohibited. This proves the isolated analysis module's independence, not the
combined language entry or remaining emitter. The expanded native analysis,
protocol, alias-graph, private-hook and project-regression group passes in
49.484s (`native-project-query-complete-go-second.log`). The final parameter
destructuring control passes in 2.465s
(`native-project-default-pattern-second.log`). Nine direct production/type-only
5.9 imports remain in the high-level compiler and durable frontend. No parser
patch or cleanup-completion decision was made by this migration.

The first complete project-backed language run reported 1,869 pass and ten
failures (9,920 assertions, 62 files, 251.53s). Two native fixes preserve callback
identity through type-only wrappers and option-widened indexed reads, and keep
nominal Error matching authoritative over an overriding method. New Go tests
also retain ordinary same-named methods and authored-optional callable controls.
The other failures were backend-specific expectations: native contracts now
link the Go ABI, incompatible resumable conventions fail at the declaration
boundary, nominal generic instantiation refuses structural impostors, native
row messages use set notation, and a retired import stops before downstream
coercion diagnostics. The must-use test now uses an actual authored Result
producer instead of the retired import and private constructor.

The new native regressions and existing aliased-callable tests pass in 24.397s
(`native-project-compatibility-go-first.log`). All 243 tests in the six affected
language files pass (676 assertions, 32.03s); the following full language run
passes 1,879/1,879 (9,929 assertions, 62 files, 250.93s), with observed exit zero
(`native-public-project-language-full-third.log`). This is a project-analysis
checkpoint, not a full release or Go-only certificate. Corpus/oracle, type
checking, packaging and the new frozen release still need fresh measurement.

That review also reproduced the previously pinned implicit-coercion ownership
gap: native ToPrimitive can discard a method's returned Result or Promise. A
native check now observes the existing protocol walk after row inference, so
it shares member identity, getter handling and short-circuit order instead of
inventing another coercion table. Its 26 new native cases pass in 45.173s
(`native-coercion-completion-go-first.log`), including Results/Promises returned
in containers, getters, aliases, exotic members, skipped members and ordinary
explicit consumers. The five-file Bun follow-up passes 255 tests and 562
assertions in 30.59s (`native-coercion-completion-bun-first.log`). Full release
measurement of this subsequent change is pending; the preceding 1,879-test pass
predates it. The first native POC type check found an alias-array inference loss
after runtime shape validation; an explicit readonly-string view restores the
validated element type without a cast or a weaker wire check.
The repeated POC type check passes with TypeScript 7's native launcher
(`native-public-project-typecheck-second.log`, observed exit zero).

Snapshot 58 freezes 2,197 inputs with SHA-256
`69214604cb20a759b505a28bfc4fc6c1a53275dd4e63c792b6756612ed20cb21`.
Its build and separate focused packaging diagnostic both return observed exit
zero. Packaging verifies 607 files, 566 generated files, 35 exports, installed
Node and Bun consumers, and identical clean-build archives. Archive SHA-256:
`35a3722a12940769b52a0ce3af1fd4c75c1039d7ef5bb3a405d018f15bd753c2`;
inventory SHA-256:
`93fb4e5d1e1a113f7bfbdca7353d16ceecdc1e633ca35e1d33b67b2482d68031`.
Its full serial release subsequently returns observed outer exit zero
(`snapshot-release-58.log.result.json`, 11:27:47–12:07:25 UTC). Node passes
317/317 with no skips in 209.595s. Go passes 3,668 tests with no skips. Bun passes
4,206 tests with one declared credential-only skip, 28,476 assertions across
210 files in 465.19s. The product/oracle comparison measures all 554 cases and
matches the 20 recorded differences exactly: zero product acceptances of corpus
refusals, two product refusals and 18 diagnostic differences. Packaging repeats
the same archive/inventory hashes above, and the docs build generates 81 files.
This is a complete regression checkpoint, not completion of the Go-only port.
The native source pin was rechecked against upstream's
`main` on 2026-09-07 and remains
`1f70213d4922b434345f639b441681e470c7cfc1`.

Post-freeze review reproduced three accepted parameter-default programs whose
owning function omitted its `Db` requirement. The live native walk now includes
parameter initialization in the callee's facts, keeping nested closures separate;
cross-module call admission uses that same scope boundary. A second live change
corrects JSON serialization's coercion selection: ordinary objects do not undergo
ToPrimitive, while Number/String wrappers are considered after `toJSON` and a
callable replacer. The first focused run passes all new default/JSON cases but
finds an erased `typeof Date` query incorrectly refused as clock access. Stopping
the host-global walk at type syntax fixes that independent gap; real dynamic-
code, randomness and clock controls remain rejected. The expanded native group
then passes in 91.504s (`native-default-json-go-second.log`). Six affected public
language files pass 238 tests/376 assertions in 23.45s.

The Go test harness now retains one process-local, content-addressed preparation
cache. Each helper still constructs a fresh backend, validates the checkout and
binary, and each compilation starts a separate native process; no Program,
checker, result or fixture is shared. Explicit cold-cache/preparation tests keep
their own directories. The same focused group plus preparation and isolation
controls passes in 19.420s (`native-default-json-go-cached-third.log`). The cache
is removed when the test process finishes. A full-suite run of this harness
change is still required.

The existing pure parameter-default corpus program is measured before changing
its expectation: native compile/execute prints `0`, while the legacy emitter
still refuses `VIBE1802@3:38`. Its expectation now follows the ordinary-call
inference rule and a JS-only marker records that missing implementation. The
post-change focused run exits zero with native pass/JS xfail and no integrity
violations. Both source files are unchanged. The corpus remains 554 cases with
25 marked cases (24 Go, two JS, one shared) and 42 `messageContains` cases; the
full corpus remeasurement exits zero: JS 552 pass/two xfail, Go 530 pass/24
xfail, both six interop cases, no unexpected failures, XPASS, unsupported,
unmeasured or fail-open markers (`native-default-json-corpus-full.json`). The
product/oracle remeasurement remains pending. These live changes are absent from
snapshot 58. The remaining native emitter/body port must preserve the SDK's distinct
Result/request ABI; changing only the selected compiler is not sufficient.

The subsequent optional-hook/union JSON regressions reproduce an optional
replacer hiding a Result and two false rejections of ordinary object union
members. Splitting possible runtime values before hook selection and wrapper
coercion fixes those cases (`native-json-union-go-after.log`, exit zero).
The six affected public language test files pass again: 238 tests, 376
assertions, 22.94s, including the strengthened fresh-process default-inference
check with legacy compiler imports prohibited. This follow-up predates the
SDK-emission work and has not yet received a full release run.

## Native SDK emitter (in progress)

API v32 added an explicit native intermediate-lowering operation. It reuses
the checked native Program and ordinary row/lowering implementation, targeting
the installed SDK's opaque Result and capability ABI. The response distinguishes
source checking from generated TypeScript checking; it is not deployment
authority. Public `compileVibeLang`, project compilation and compile-and-check
now route through it, alongside the already-native public analysis APIs. A
fresh-process test prohibits legacy compiler imports while checking and emitting
single-file and multi-file programs. Ordinary calls remain eager, including calls
inside async functions, methods and callbacks; private durable-body extraction
has not yet been ported.

The first complete language measurement after this routing change reports
1,800 passes and 95 failures across 63 files (`native-sdk-language-all-first.log`).
Those failures are being investigated, not converted wholesale into exceptions.
They include stale private generator spelling assertions, source-check versus
generated-check diagnostic placement, missing declaration linkage, and real
foreign-provenance bugs. This is not a green release checkpoint.

API v33 adds an explicit SDK declaration target. The native checker projects
validated v2 declaration metadata onto a language signature facet only when its
declared runtime selector exactly matches the requested SDK runtime. Ordinary
foreign imports, different runtime selectors, malformed metadata and the
standalone Go runtime ABI are not silently linked. Equivalent but differently
spelled runtime selectors are currently refused rather than guessed. This
signature projection is not runtime authentication or deployment authority.

The source-free publication tests exposed a real metadata-loss bug: replacing
a method's Result type discarded its capability-row comment. Native node updates
now preserve those comments, including through module-edge rewriting. The
affected declaration/implicit-invocation suite passes all 38 tests. The integrated
publication, accessor, project, SDK execution, native analysis and source-map run
passes 144 tests/843 assertions across seven files in 26.42s
(`native-sdk-public-integrated-first.log`). Native SDK target/protocol tests also
pass (`native-sdk-go-target-first.log`, 10.306s). Wire decoders now reject omitted
fields, nulls, incorrect source identities and malformed source-map coordinates;
68 focused Bun protocol tests pass. Five publication/source-map test drivers no
longer import the 5.9 compiler.

Nine production files still import the legacy compiler, in durable compilation
and its private semantic/lowering dependencies. The aggregate language export
also reaches that legacy graph indirectly. No fallback was added to public native
compilation; full import/dependency removal, durable-body migration, honest corpus
driver relabeling and a fresh frozen serial release remain required.

The ensuing foreign-boundary review reproduces seven accepted cast/container
escapes, then two annotated-container escapes and a cyclic-initializer compiler
stack overflow. Native call policy now retains runtime provenance independently
of a cast's replacement signature; only a still-resolved foreign declaration
can supply its trust marker. Member initializers and object binding patterns
retain that provenance through local containers. The finite value-flow traversal
keeps its cycle guard during callee resolution, so cyclic initializers receive
ordinary diagnostics instead of exhausting the stack. Positive controls retain
ordinary local values, type-only foreign interfaces, trusted primitive methods
and correctly attached synchronous arrow contracts. A trusted async arrow is
explicitly refused, not misclassified as infallible.

Refused foreign reads, construction and callback escapes also contribute their
Panic obligations before row inference. Exact native tests now require the
additional contract diagnostics rather than discarding them. One former native
"trusted satisfies" execution fixture actually contained an intervening cast;
that exact program is retained as a refusal regression, with a separate pure
`satisfies` execution control. The expanded native controls and the broader
foreign/selector/wrapper/shorthand suites pass (`native-foreign-views-controls-after.log`,
`native-foreign-views-go-broad-second.log`, 16.719s for the latter). Eight public
SDK suites pass 218 tests with no failures (`native-foreign-sdk-bun-third.log`).
The next full language measurement found 1,866 passing and 28 failing tests
(`native-sdk-language-all-second.log`). Investigation exposed three additional
native gaps: generated foreign adapters passed an Error constructor where the
SDK required a mapper; foreign `@throws` types were resolved at the call site
instead of the declaration; and trusted getters were unconditionally refused.

Native explicit Result adapters now accept error-mapping functions. Generated
foreign calls use a nominal validator mapper on both emission targets. A
declared foreign Error is resolved in its own declaration and paired with a
checker-proved live named/namespace value binding at the call; type-only alias
chains and shadowed or unrelated classes cannot supply that binding. Resolved
synchronous `@throws {never}` getters remain usable, while casts, setters
(including grouped assignments) and Promise-valued getter claims stay refused.
The focused native execution/control group passes
(`native-foreign-adapters-final-focused.log`, 4.941s). The preceding broad
foreign/accessor run had no other failures; it must still be rerun after the
final focused test correction.

The compiler-owned `vibelang/result` inspection seam now exposes only its
documented nominal predicates, not private constructors. Native public analysis
uses the latest ECMAScript library surface, including Float16Array, while the
standalone compiler retains its configurable target. All four updated SDK test
files pass 78 tests/329 assertions (`native-sdk-cleanup-fourth.log`, 10.45s),
including emitted-JavaScript executions for named/namespace Error aliases,
async foreign failures, explicit mappers, wrong classes and forged values.

All language test drivers are now off the TS5.9 compiler library. Metadata tests
exercise native publication/inspection and source-free consumers; they retain
the distinct standalone and SDK ABI checks. Formatter comparisons now use exact
native JS emission plus adversarial literal/comment/ASI controls, independently
of the native formatter's token/AST preservation gate. They are no longer
described as an independent TS5.9 scanner oracle. Diagnostic assertions retain
their refusal obligations at the native source-check stage, and declaration
assertions retain unrelated user types while naming the real SDK type alias.

The third complete language run reached 1,896 passes and one stale diagnostic
assertion (`native-sdk-language-all-third.log`, 242.81s): a retired Result-factory
import now gets TS2724 from the recognized inspection module rather than a
missing-module diagnostic. That exact refusal remains tested. Seven missing
generic arguments in the new execution test harness were corrected separately;
the current poc native type check is green (`native-sdk-typecheck-final.log`).
The fourth complete language run passes **1,897 tests**, zero failures and
10,165 assertions across 64 files (`native-sdk-language-all-fourth.log`, 245.94s).
The wider native Go gate is running. These live changes still have no frozen
release certificate, and nine production legacy-compiler imports remain.

Addressing limitations remain explicit: native project dependency discovery does
not treat physical absolute source paths as virtual-project aliases, even when
they are in-root; relative in-root foreign imports work and outside-root paths
remain refused. File-URL runtime selectors also need an explicit generated-check
resolution mapping; an absolute runtime path works with the current SDK checker.
These are not reasons to reinstate a TS5.9 resolver or silently widen filesystem
authority.

## Native executable-body compiler (API v34, live verification)

The public `compileDurableBody` now uses the native Go authored pipeline,
private SDK lowering, generated-program checking/codecs, and factory assembly.
Its TypeScript host validates data and assembles digests; it imports no compiler
library. There is no legacy fallback. The remaining eight production compiler
imports belong to Plan/Manifest source compilation and their private semantic
dependencies; removing that island and the dependency is still required.

The shared authored pipeline now explicitly separates provisional native
analysis from emission/checking. Private bodies enable ownership checking inside
durable callbacks (the bounded Plan path formerly skipped them), while the Flow
driver supplies the async invocation owner. Ordinary public function calls keep
their eager ABI. Module initialization is retained in authored order, and calls
that would perform journaled work outside the handler are refused. Native
payload-member classification uses the checked Result success type and actual
library symbols. Namespace timers, null timer answers, async overload contracts,
implicit accessor refusals and directly persisted non-finite literals are tested.

The initial existing-body parity measurement was 44 pass/15 fail, including two
accepted-program gaps (module initialization Actions and non-finite request
literals). After fixes, all 59 tests pass, with 408 assertions across the body,
timer, inferred-payload-method and implicit-protocol suites
(`native-body-existing-second.log`, 17.82s). This candidate measurement used an
external, test-only module substitution; that substitution was removed when the
public entry point was switched. It included real process-kill replay and signed
timer restart. New native API/protocol tests pass (`native-body-go-api-first.log`,
2.629s), and the new Bun transport/execution group passes 49 tests/69 assertions
(`native-body-bun-protocol-first.log`, 1.96s). The native poc type check passes
after fixing two test-handler `unknown` values (`native-body-typecheck-second.log`).
The complete durable suite is now running against the real public entry point.
No complete live release gate or frozen release certificate exists for v34 yet.

The earlier full native suite ran 3,835 test/subtest entries: 3,830 passed and
five failed. Those five entries were three exact diagnostic assertions plus two
parent groups: refused foreign boundaries now also contribute their Panic row
before contract checking. The exact obligations were strengthened, not filtered;
the affected groups pass (`native-sdk-go-cascade-corrections.log`). A complete
native rerun after the body/compiler changes remains pending.

### Public-body regression audit and API v35 (live, 2026-09-07)

The first full durable run through the real public body entry point measured
582 pass/16 fail (`native-durable-all-first.log`, 97.91s). Fixes now preserve
native Error constructor identity across the prelude's type-only augmentation,
reject type-only namespace and conflicting intrinsic bindings before erasure,
and retain authored diagnostics when a Manifest cannot be derived. Unsupported
intrinsic calling conventions and missing imported contracts are explicitly
delegated to their binding-owning profile; placeholder types cannot prove an
opaque output or a source error. This does not make that compatibility profile
Go-native or close its known gaps.

Two worker-mutation positives had propagated `Result<_, never>` from a plain
function, contrary to the explicit-channel rule in failures.mdx. Their positive
fixtures now declare the channel; the exact plain-function program remains a
VIBE1202 refusal control. No runtime mutation/evidence assertions were removed.
The second complete run measured 599 pass/1 fail (`native-durable-all-second.log`,
102.15s); the remaining imported-name collision is corrected, and its unchanged
source-compiler group passes in the focused rerun.

API v35 adds opt-in, bounded native syntax inventories for top-level variable
and function declarations. This replaces the last test helper directly parsing
with TS5.9 without reducing private-helper, overload or binding-pattern checks.
The query distinguishes decoded identifiers from exact UTF-16 binding spans,
rejects JSON mode and malformed transport facts, and cannot publish a complete
inventory after parse recovery. The native inspection/body/API group passes
(`native-body-declaration-inspection-go-first.log`, 15.453s); the corresponding
Bun protocol/module/source/execution group passes 148 tests/541 assertions
(`native-body-declaration-inspection-bun-first.log`, 18.22s). The native poc type
check passes (`native-body-declaration-typecheck-first.log`).

The full Go gate now passes **3,906 tests/subtests, zero failures or skips**
(`native-body-go-all-first.log`, compiler package 323.357s). The final full durable
rerun passes **600 tests, zero failures, 4,094 assertions** across 51 files
(`native-durable-all-third.log`, 102.63s). These are live measurements, not a frozen release
certificate. Eight source files still directly import the retired compiler:
three implement Plan/Manifest/schema compilation, while five now have only
legacy-internal test consumers. Those tests must be migrated without dropping
fault-injection or identity coverage before deleting the isolated frontend.
