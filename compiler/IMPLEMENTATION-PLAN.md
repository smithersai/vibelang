# End-to-end implementation review

**Go compiler refresh (snapshot 93, full release green):** Microsoft
TypeScript main was `bf7f49d6f5ad3254d03ed83dd07ab510ae4e582a` at
`2026-09-09T00:01:28Z`. Its single tooling-only commit changes independent VS Code
extension release mechanics, not compiler code or Go dependencies. The offline
capsule, Go pin and patch series agree. Pristine/patched health checks, exact
eight-file regeneration, clean patch reversal/reapplication and the native
package build pass. All existing patches and generated post-images are unchanged.
No upstream release workflow was run. Snapshot 93 qualifies this revision and
the API 53 bundler work; snapshot 91 is historical evidence only.
Snapshot 92 fails on one newly added documentation path spelling in the brand
gate (498 other Node tests pass). The redundant path reference is corrected;
the gate itself is unchanged. Its failed record and clean input audit remain.

Snapshot 93 passes the complete serial release: 499 Node, 5,279 Bun and 4,691 Go
tests/subtests, the unchanged corpus/differential baselines, reproducible
578-file/25-export packaging, fresh Node/Bun consumers and the 87-file docs build.
The one credentialed live-model skip remains explicit. All 2,323 inputs match
the frozen snapshot before the three status records are updated.
Upstream advances to `fe5d056f0cb291a8552081f8407abe0455b5be8f`, measured
at `2026-09-09T00:49:22Z`; its only changes are unused TypeScript API helpers and
benchmarks. The Go compiler tree, generator inputs and dependencies are identical.
The qualified pin is retained, not claimed to equal the newer repository HEAD.

**Bundler delivery, API 53 (full release green):** the Go-backed
CLI pipeline now also publishes code/maps atomically in memory for the common
unplugin factory. All nine host factories execute a checked propagation project;
watch coverage includes changing imported rows, comptime input edits, missing
input creation, and Vite package-declaration refusal/recovery. Native dependency
inventories and host input observers drive those invalidations. The latest Node
selection passes 120 tests, the SDK/build selection 187, and the native selection
84, including tightened UTF8-path budgets. Esbuild now explicitly requires
bundling instead of silently publishing imports of uncompiled source; both
new refusal regressions pass. Public plugin declarations no longer drag all optional
host packages into a consumer; fresh installed Node/Bun package verification
passes. Node now requires 22.12.0; Bun's plugin/CI requires 1.2.22. See the bundler
guide for the conservative transform-only subset, Vite reload behavior and Farm
library-map limitation. Browser runtime and durable Plan delivery are not implied.
Snapshot 93 supplies this changed tree's complete release certificate. Production
durable-host packaging still needs an owner decision, and the reviewed runtime
packages remain unavailable at `2026-09-09T00:31:44Z`. Other durable lifecycle and
cleanup-precedence obligations remain open; alpha-0 is not marked complete.

**Completed priority, user direction 2026-09-06:** the TypeScript 5.9
compiler-API implementation is replaced by the current pinned Go compiler.
See [the Go-only migration record](GO-MIGRATION.md). Snapshot 60 passes the
complete serial release gate: 325 Node tests, 4,345 Bun tests, 4,116 Go
tests/subtests, all 554 corpus cases with declared expected failures, installed
Node/Bun package consumers, reproducibility and the docs build. There is one
explicitly credentialed live-model skip and no unexpected failures. Ordinary
TypeScript CLI operations also use the same pinned native executable.

**Preparation ownership, focused checks green:** replace the stale directory
lock with a cancellable OS-held file lock and a separate `v2` cache layout.
Killed owners release ownership; cancelled waiters and repeated release callbacks
cannot take or release another owner's lock. All eighteen focused tests/subtests
pass under the race detector, including real preparation and preserved old-cache
evidence. Linux/arm64 and Windows/amd64 cross-compile; only this host's runtime
behavior is measured. No dependency, compiler ABI or language rule changes.
Five repeated race-detector runs and the package rebuild pass; the native
executable remains byte-identical to snapshot 89's qualified compiler.
Snapshot 90 passes all three main suites (417 Node, 5,225 Bun, 4,647 Go) but fails
the installed Node consumer on a reproduced native stdin stall. Its final input
audit is clean; its failed release record is preserved. The SDK transport now
uses private finite file-backed stdin instead of a synchronous pipe writer.
All fifteen transport checks pass. A separate nine-case regression fixes Deno
protocol-frame truncation under short writes; the combined 24 checks pass, as
do focused native Bun tests and two traced 500-sandbox/5,000-SDK-call runs.
An earlier stress run's separate sandbox exit is retained as unclassified, not
declared repaired by these controls. Fresh full release qualification now passes
in snapshot 91. The transport changes do not alter the native ABI, language rules,
dependencies or Node floor. Snapshot 89 is not reused for changed inputs.

**Snapshot 91 upstream refresh, September 8 (historical full release green):**
the pin and offline capsule named `10404f71a8675a010ca6431698c8d7ee80bbcd39`.
Its two new commits add upstream's readonly ambient import-attribute diagnostic
and extend an upstream TypeScript API helper that this project does not use.
All existing patch contents/images and Go dependencies are unchanged. Pristine
and patched compiler health selections, the new upstream baseline, regeneration
of eight files and clean reversal/reapplication pass. The package rebuild and
eighteen native delivery-profile/option tests pass, as does the focused installed
Node/Bun package verification. Those tests expose and fix the Go adapter's
incorrect refusal of explicit `skipLibCheck` booleans without changing the
existing default. Upstream still matches the pin after the full release at
`2026-09-08T22:24:10Z`.
The final 175-test native SDK/configuration selection, pinned Plan/value
comparisons and nine documented programs pass before that source freeze.
Snapshot 91 then passes the complete serial release: 441 Node, 5,225 Bun and
4,665 Go tests/subtests, unchanged corpus/differential baselines, reproducible
packaging, fresh Node/Bun consumers and the 85-file docs build. All 2,311 live
inputs match the frozen snapshot before this certificate-only update. The
credentialed live-model skip remains explicit. This does not settle runtime
packaging or the remaining durable-host/semantic obligations; alpha-0 is open.

**Earlier upstream refresh, September 8 (full release green):** the pin
and verified offline source capsule used
`d0ac85d8eab09e06376390c9352d07c8a8c00aa8`. Its build-task-only change leaves
all five patches and 22 Go dependencies unchanged. Selected pristine/patched
upstream checks, exact regeneration of eight files, patch reversal and the native
package build pass, as do the pinned Plan/value/control comparisons and four
real external SQL Control/scheduler/journal parallel/crash-restart scenarios. The shipped
architecture guide no longer describes a second compiler or the withdrawn body
model as the current target. Snapshot 89 passes the complete serial release,
and all 2,302 live inputs match the tested snapshot. The post-run upstream
check still equals this pin at `2026-09-08T19:58:50Z`. Installed Node/Bun
consumers, reproducibility and the docs build pass; the nine documented programs
also pass separately. Only the three implementation-status records change after
this full run. The preceding snapshot 88 is preserved as the certificate of its
own revision, not reused for this newer one.

**Next durable contract:** the September 6 owner decision in `docs/DECISIONS.md`
supersedes the ordinary-body replay model described by the historical review
below. Implement the [durable plan interoperability obligations](SMITHERS-INTEROP.md) <!-- brand-gate: allow external library name -->
against the reviewed upstream wire contract; the existing executable-body demo
does not establish that interoperability. Cleanup-completion precedence remains
undecided. The compiler migration does not mark the alpha-0 goal complete.

API 38 adds the native keyed Plan data boundary: compile, reconstruct/verify and
append, with the actual approval projection and filesystem ordering rules.
Its 141 pinned upstream comparisons agree, including verification of the Go
artifacts by the reference. This completes a protocol foundation, not the
source-to-scheduler integration or a change to the durable product default.

**Nullable success facts, API 52 (full release green):** static source
narrowing now comes from the fully checked native retained-body program, not
the extraction pass's non-null assertion approximation. Reference/declaration
source identities and semantic descriptors must match before a fact is used.
Null success branches, aliases, Unicode/escaped names, shadowing and child/fan-out
composition have regressions; record-to-null comparisons remain independent of
object identity. The 313-test SDK group, 59 CLI tests, native checks, 39 upstream-
verified source Plans and installed Node/Bun consumers pass. Snapshot 87's
accepted-but-incorrect `never` contract on a null return is independently
reproduced and corrected. Snapshot 88 passes the complete serial release, and
all 2,302 live inputs match it after completion. No JavaScript compiler API or
runtime dependency was added. Upstream `main` advanced during this run to
`d0ac85d8eab09e06376390c9352d07c8a8c00aa8`; the certificate remains valid for
its recorded preceding revision, and the newer pin needs its own qualification.
This is compiler/worker progress, not completion of the production durable host,
bounded rounds, time-travel administration or default-model migration.

**Statement graphs, API 51 (full release green):** scoped `if` statements,
early returns, consumed Action/Flow statements and native-checked input narrowing
now become complete keyed Plan data. Fallthrough-only statements do not order
independent continuation work; returned paths do not execute it. Guarded field
access stays deferred until the selected arm executes. The native descriptor
lookup includes work in still-open ancestor scopes. No source callback is
executed to discover a graph. The 270-test SDK group, 57 CLI tests, 38 upstream-
verified source Plans, installed Node/Bun consumers, nine documentation programs
and resource-budget refusals pass. Real external SQL Control/scheduler/journal
crash/restart controls remain green. Snapshot 87 passes the complete serial
release, including the corrected deployment tests. All 2,300 live inputs match
the tested snapshot. The failed snapshots 85/86 remain explicitly recorded; no
corpus expectation, dependency baseline or exclusion was changed. Only the three
implementation-status records are updated after this full run.
The production runtime-packaging choice remains unanswered and separate.

**Short-circuit work, API 50 (full release green):** Go lowers Action-bearing
`&&`, `||` and `??` through the existing complete conditional graph. The selected
operand, left-side Action identity, nested child/fan-out bindings and failure
channels remain intact. A mixed scalar/Result binding also retains its must-use
obligation. This uses the existing authenticated demand worker; it does not
deliver the separate production durable host or add a runtime dependency.
The 108-test/subtest native group, 200-test SDK group, 51 CLI tests, 32
upstream-verified source Plans and installed Node/Bun consumers pass. Snapshot
84 passes the complete serial release, and all 2,298 live inputs match it after
completion. No corpus expectations, dependency baseline or exclusions changed.
Only the three implementation-status records change after this full run.

**Conditional source graphs, API 49 (full release green):** Go
publishes both arms, boolean conditions and completion joins as bounded Plan
data. A demand-controlled authenticated worker selects one arm, retains shared
work and explicit sequencing, and rejects eager sweeps and invalid reservations.
Pure computation/typed failure/cancellation channels stay distinct. Cross-arm
filesystem-conflict edges refuse pending their conditional effect adapter; they
are not deleted from the approval graph. No source evaluator, compiler-library
fallback, runtime dependency or replacement durable scheduler was introduced.
The 280-test focused group, nineteen actual-interpreter comparisons and twenty-six
upstream-verified source Plans pass. Snapshot 83 also passes the full serial
release, including signed restoration and selected provider execution in installed
Node/Bun consumers. All 2,296 live inputs matched it after completion. Packaged
host admission/journaling, conditional effect adapters, bounded rounds and full
default migration remain owed. The API 48 certificates below remain historical
measurements; no corpus or dependency baseline was changed for this checkpoint.

**Durable docs and executable examples, snapshot 82 (full release green):** the main
specification and guide now describe the owner-adopted Plan contract, with the
withdrawn ordinary-body text preserved as labeled history. Current complete
examples run through the default native `vibe plan` command and independent Go
graph verification. The gate now refuses failed or incomplete JSON reports that
previously counted as successful checks. Its 29 new regression tests pass; the
docs measure three keyed examples, two ordinary checks and one explicitly
historical body example. No corpus expectation or runtime implementation changed.
All 2,290 live inputs matched snapshot 82 after the complete serial release.
A subsequent four-line warning-format correction passes a fresh docs build,
50 focused tests, six rendered-content checks and four actual-callout checks.
The follow-up changes presentation only; see the interop record for both audits.

**Keyed CLI default, API 48 (full release green):** `vibe plan` now publishes
the Go-derived keyed graph by default from checked source, exact input and
explicit provider declarations. Manifest inspection requires
`--profile manifest-compat`; no refusal falls back to body replay. All 44 new
CLI tests pass, including raw JSON/BOM and output-alias protections. Installed
Node/Bun consumers invoke the real CLI, restore its Plan against signed
deployment artifacts and execute the authenticated worker. Fabricated provider
claims fail restoration. No runtime dependency was added. All 2,287 live inputs
matched snapshot 81 before this documentation-only certificate update.
This completes Plan inspection delivery, not the separate production host,
branch/round integration or historical `compile`/`run` default migration.

**Pure computations, API 48 (full release green):** pure arithmetic,
bitwise operators, scalar comparisons and logical/nullish selections now lower
to checked Go-derived data expressions. Child-Flow and static fan-out bindings
preserve their dependencies. The authenticated worker validates producer Ref
types and reports computed boundary violations as defects. Conditional graph
work still refuses until the actual branch driver is connected. No runtime
dependency or compiler-library fallback was added. The focused 288-test SDK
group, 33 Go tests/subtests, installed Node/Bun consumers and four actual-runtime
parallel/crash-restart scenarios pass, followed by the full serial release.
That checkpoint audited all 2,286 live inputs against snapshot 80.
See the interop record for the precise subset, hashes and measurements.

**Latest full release checkpoint, API 52:** snapshot 91 passes the complete
serial gate with 441 Node, 5,225 Bun and 4,665 Go tests/subtests. The corpus,
installed package consumers, reproducibility and docs build pass with the same
explicit expected-failure/live-model exclusions as above. The new Plan data
boundary is verified against 141 upstream measurements and thirty-nine source-produced
Plans. Details and hashes are
in the linked interoperability record. Snapshot 62 was cancelled to fix a
confirmed long-Unicode-normalization mismatch; it is not counted as green.

**Fan-out child composition, API 46 (full release green):** compiler-bound source
Flows now compose as per-item fan-out steps. Shared native contract/depth checks,
scoped graph expansion, complete child joins, imported failure rows and strict
interpreter addresses are covered. Installed Node/Bun consumers compile, sign,
restore and execute the provider path in real Deno processes. All 2,279 live
inputs matched snapshot 77 before this record was updated. No runtime dependency,
corpus expectation or differential baseline changed. This does not complete the
separate scheduler/Control/journal path or resolve runtime packaging.

**Enclosing fan-out values, API 47 (full release green):** native static
templates may capture the enclosing Flow input and earlier checked `const`
values. Nested scopes bind their own inputs and node references; shared results,
child completion joins, object order and duplicate projection slots survive
expansion. Mutable/module/forward captures and unproven paths still refuse.
The focused Go/SDK, upstream and installed-provider checks pass, followed by the
complete serial release gate in snapshot 78. All 2,280 live inputs matched before
this certificate update. No runtime dependency, corpus expectation or product
differential baseline changed. Scheduler/Control/journal integration and the
runtime-packaging decision remain unfinished.

**Authenticated node worker (full release green):** the new Node/Bun
worker selects only authenticated provider/runtime bytes and validates complete
nodes, Ref handoffs, codecs and cancellation channels. An explicit isolated
composition with the actual reviewed SQL Control, scheduler and journal passes
approval refusals, independent-node execution and SIGKILL/fresh-process resume
without repeating committed work. It waits for real lease expiry and checks
owner liveness. The 86-test worker/value/signing group and native typechecks pass,
followed by the full serial release gate in snapshot 79. All 2,283 live inputs
matched before four documentation-only updates. This is not a bundled runtime
or completed production lifecycle; runtime packaging remains pending.

**Retained-body checking, API 45 (full release green):** the native Go compiler
checks complete Flow bodies before erasing them to Plan data. Typed child-Flow
collections and fan-out callbacks compose; fan-out, sequential and child failure
rows cannot disappear behind an explicit `never` contract. Concise and block
Result returns publish the same rows, while already-Result callback forwarding
remains legal. The signed source builder uses the same discarded checking
profile, which cannot authorize runtime emission. All 2,278 live inputs matched
snapshot 76 before this certificate was recorded. Snapshots 73–75 were cancelled
or failed and are not counted as green. No corpus expectation or product
differential baseline was weakened. Runtime packaging and the separate
scheduler/Control/journal acceptance path remain unfinished.

**Source composition, API 44 (full release green):** native source-declared child Flows
now expand into scoped keyed Action graphs. Entry-export selection is bound to
signing/restoration; failure rows, independent readiness, completion joins and
resource refusals have focused regression coverage. Snapshot 72 passed the full
serial release gate; all 2,276 live inputs matched the tested snapshot before
this certificate was recorded. See the interoperability record for the exact
supported and refused source profile. Scheduler/Control/journal integration is
still unfinished and the runtime packaging decision remains open.

**Source integration, APIs 40–42:** the additive `compileKeyedPlanSource` endpoint
checks a straight-line Flow and publishes the native keyed Plan. API 42 adds
explicit declaration-source dependencies, preserving imported nominal contracts,
full language checking and byte-bound source identity through signing/restoration.
Its focused native/SDK/package and upstream comparisons pass, followed by the
complete serial release gate in snapshot 70. All 2,270 live inputs matched that
snapshot before recording the result; no runtime dependency was introduced.
It preserves independent readiness and object construction order, binds derived
Action contracts and explicit provider/effect declarations, and refuses unknown
control-flow nodes with no body fallback. The data interpreter now preserves
object order through canonical storage and validates exact Ref handoffs and
typed outcomes. The source authentication follow-up below binds provider code;
scheduler/journal execution still needs connection. API 40 passed the full serial
release check, including the installed ordered-value/interpreter exports.
See the
interoperability record for the exact supported profile and its release evidence;
this is not an alpha-completion claim.

**Current provider work, API 41 (full release green):** source-only provider
compilation now asks Go for exact input/success codecs and the value/Promise
completion convention, in addition to error/capability rows. Worker bundles can
embed the shared keyed-value codec and encode answers inside a real Deno process,
before JSON transport loses information. Focused tests cover ordered data,
module initialization, typed failures, hostile values and completion semantics.
The full release and package delivery checks pass, including building and
executing these bundles from installed assets on Node and Bun, plus reproducible
archives. The reference scheduler and SQL Control seams have also been exercised
in isolated probes; those test executors do not establish product integration.
This is provider/value execution, not signed deployment,
Control approval, scheduler or journal integration in that checkpoint.

**Current source extension, API 43 (full release green):** native static keyed
fan-out now publishes key-addressed Action children and an ordered result, with
data-only per-item dependencies and explicit joins for all declared child work.
The focused 112-test SDK group, native source/Plan tests, upstream comparison
(141 data cases, ten source Plans and six value controls), build/typechecks and
installed Node/Bun consumers pass. Installed consumers also execute the two
real checked providers directly in Deno. Unknown future keys/sizes still require
bounded rounds; this is not scheduler admission or durable crash recovery.
See the interoperability record for exact supported/refused scope and the
snapshot-71 complete serial release certificate. All 2,273 live inputs matched
the tested snapshot before that certificate was recorded.

**Source authentication follow-up (snapshot 69 full release green):** a static
signed deployment now binds actual checked provider bundles, source, compiler,
runtime and driver bytes. Per-input Go compilation follows Control-assigned Plan
ids; restoration reconstructs the signed-source invocation, and approval targets
bind the complete input/deployment/envelope as well as the graph. Focused tests
(94 passed after the canonical-byte follow-up) and installed Node/Bun packaging
checks pass. Snapshot 68 was stopped after a review found that a leading UTF-8
BOM was silently removed from byte-input artifacts; the shared decoder and
byte/text regression coverage are corrected and pass the fresh serial gate.
An isolated real SQL Control
probe agrees on the full target, refuses unauthorized/altered approvals, persists
one grant and restores the invocation in a fresh process without changing input
order. This is not scheduler/provider/crash execution. Runtime packaging needs
an owner choice because the reviewed Control/scheduler packages are unpublished;
no runtime dependency or vendored copy has been silently introduced. See the
interoperability record for exact scope, evidence and remaining obligations.

Work started 2026-09-05. This is an implementation worklist, not a change to the
language contract. `docs/DECISIONS.md` takes precedence over conflicting product
pages. Existing provisional decisions stay provisional; existing accepted source
programs and safety checks remain regression coverage.

The user's delivery target is a working alpha-0 end to end. An external Claude
Code process has finished its e2e fixtures (554 cases). Preserve its work, review the
new fixtures against implementation, and use them alongside focused implementation
tests. Previous comments, reports, and tests require independent verification.

## Historical specification review — September 5

Reviewed the specification pages, decision ledger, durable execution draft,
asset-loader and agent-library drafts, packaging/fork contracts, and API
references before implementation changes.

The central contract is TypeScript-shaped `.vibe` with nominal errors and
capabilities, must-use Results and Promises, deterministic tracked comptime,
and ordinary Flow bodies executed under journaling handlers. TypeScript is the
only compilation target. Imported TypeScript/JavaScript keeps its semantics.

The documents contained stale implementation measurements at the initial review. In particular, the
reference compiler already emitted capability functions as generators without an
`effectLowering` option, and runtime/index.ts exported the provision/get hooks.
Failure propagation used statement hoisting and early returns. The replay
driver required explicit opt-in and was separate from ordinary Flow emit.
Ten Result operations named in the ledger were absent from the callable surface.

Progress since that initial review: the ten Result operations are implemented in
the reference runtime/checker and Go prelude, including awaited callbacks,
joined async collections, forwarding recovery, and canonical Result codecs.
Both new API fixtures execute identically on both backends. Result function
bodies now use synchronous/asynchronous delimiters; `!` suspends at its original
expression position. Ordinary public calls remain eager. Lexical `super`, `this`,
`arguments`, empty failure-row extraction, and expect placement are covered by
executed regressions on both backends. A pending panic survives abandonment in
sync/async finally blocks. Private durable Result frames now forward cleanup
Actions through synchronous/asynchronous finally and keep local Layers alive.
The general cross-function/async calling convention still needs completion.

Executable Flow work now has its first real source-to-replay slice:
`body-compiler.ts` uses the ordinary language checker/emitter through a
parser-independent intrinsic/request binding seam; it emits an executable
source closure, not a Plan. The manifest follows helpers/closures/recursion.
The body artifact pins original source, emitted code, codecs, and manifest.
`DurableStore.initializeBodyExecution` shares the existing atomic initialization
and fencing path without constructing a Plan or eager node rows. Executed unit
tests cover mutable locals, loops, closures, recursion, nominal failure replay,
finally-before-recovery, invalid-output refusal before commit, and source/body
pin mismatch. The explicit BodyDeployment/BodyExecutor path now authenticates a
signed body digest, Effect Manifest, journal schema and routing manifest before
loading code or invoking workers. It routes Actions with signed implementation
contracts, validates live/replayed answers, fences retries and cancellation,
supports memo/content reuse with atomic cache+node commits, and isolates captures
and nominal codecs per attempt. Async Flow bodies and local lexical Layers work
across await and replay; Manifest get sites carry nominal capability identities.
Unsupplied external capabilities still fail closed before deployment.

The real vertical slice now compiles an async Flow using a local Layer, signs its
deployment, routes workers, SIGKILLs after the first committed Action, and resumes
in a new process without repeating that Action. Its six tests pass. Native Error
contracts are structural (javascript:Error@1), never arbitrary JSON, on both
backends; persisted Flow failures are checked against their pinned codec too.

The normal CLI now materializes checked Flow descriptors and executable bodies
before project emission, sharing the same module stage with the reference
harness. `Deployment.build`, `SignedDeployment` and the authenticated coordinator
dispatch to executable bodies without downgrading to compatibility Plans. A CLI
consumer test crosses comptime, checked emit, declaration/source-map generation,
signed worker routing, execution and replay. Authored source/sites and the
earlier lowering's tracked-input identity are all pinned. The agent adapter now
accepts the authenticated executable-body path: a generated turn crosses Deno
RPC, SQLite commits and a fresh coordinator attachment without repeating its
first committed Action. Six new executable-body turn tests and the surrounding
agent group pass (20 tests, 168 assertions). Turn identity includes the validated
deployment manifest, so changing the signed provider cannot replay the previous
provider's answer. Executable-body coordinators now also provide typed core
handles (`start`, `resume`, `status`, `result`, `cancel`) and per-attempt replay
audit snapshots. Inspection uses a read transaction with the deployment pin and
never loads executable JavaScript; terminal attachment skips body loading too.
Five new tests cover eager start, persisted-input restart, replay counts, changed
deployment refusal, inert inspection and cancellation. Signal/child-control
methods are not pretended to exist on a body handle. Go body emit remains open. Foreign/imported
closure modules, external capability bindings, durable signal/queue/combinator
drivers, and effectful higher-order callbacks remain real gaps. Do not infer alpha
completion from the current path.

Conflicts/open design questions are recorded rather than silently ratified:
PR-1/2/3; dynamic evaluation/import permissions; capability subclass substitution;
Layer override policy; concurrent sibling cancellation and scheduler integration;
live Flow migration; foreign Rust/Zig ABI; and exact public loader APIs. Existing
implementations can supply routine API choices where the contract permits them.

## Implementation sequence

- [x] Read and review the authoritative specification set.
- [x] Review compiler, runtime, delivery paths, and test gates; measure baseline.
- [ ] Complete Result instance/static operations across runtime, checker,
  consumption analysis, declarations, Go backend, and executed conformance cases.
- [ ] Complete expression-position propagation using delimited failure exits,
  preserving evaluation order, cleanup, panic isolation, and source maps.
- [ ] Complete effect rows on function values and across declaration boundaries;
  preserve lexical receivers, async behavior, and eager public calls.
- [ ] Complete structural Layer scope for sync/async functions and callbacks.
- [ ] Connect checked Action signatures, ordinary Flow bodies, transitive Effect
  Manifests, codec classification, and the durable replay driver.
- [ ] Verify restart/replay, deterministic concurrency, suspension, cancellation,
  source pinning, divergence, fencing, retries, memoization, and content caching.
- [ ] Connect Flow body artifacts and Effect Manifests to authenticated deployment,
  inspection, worker routing, and agent adapters.
- [ ] Review and complete comptime, schema derivation, asset loaders, foreign
  source integration, incremental identity, and invalidation.
- [ ] Review and complete CLI, programmatic API, formatter, language service,
  bundler integration, host entry points, and package/declaration compatibility.
- [ ] Run full language/runtime/Go/conformance/package gates; record remaining
  design limitations separately from implementation failures.

## Verification

### Accessor views: complete pre-migration release checkpoint (2026-09-06)

Snapshot 20 completed `npm run release:verify` with exit 0. Its 2,075-input
manifest SHA-256 is
`c709041747b2a4a8010c61e27157981a01b608c3500e28227246985b6fe6a177`;
the frozen source is `/tmp/vibelang-alpha0-release.AZK2so`. This is the final
baseline before the user-directed Go-only compiler migration and source-pin
update. It does not certify those later changes.

- Node: 262 passed, no failures/skips; 132,886.413375 milliseconds.
- Bun: 3,331 passed, no failures, one explicitly credentialed live-model skip;
  23,762 assertions across 169 files, 525.10 seconds.
- Go: 2,175 passed, no failures/skips; compiler package 1,030.047 seconds.
- The unchanged 554-case corpus and interop gates pass. The CLI oracle retains
  exactly 20 reviewed differences: zero product-only accepts, two product
  refusals and 18 diagnostic differences.
- Package: 585 files, 537 generated files and 43 exports; installed Node/Bun
  consumers and reproducibility pass. Archive SHA-256:
  `e134dced2ae1d0442a8d351bc60d0d83252971bf4d2932954a947a09841096aa`.
  Inventory SHA-256:
  `9684d59e609a60dc56d8b30bfb5c717ebb07e799a96130bdff4ec91239f93a52`.
- Documentation: 81 files generated.

Evidence:
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-20.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-20.log`. <!-- brand-gate: allow existing verification path -->
This closes verification of the accessor structural-view follow-up below,
not the cleanup decision, native-only migration or alpha-0 goal.

### Accessor structural-view follow-up (2026-09-06)

Three accepted JS programs lost `C` through a data-property annotation, an own
getter viewed as a prototype getter, and a generic property reader. All passed
both compiler checks and panicked when executed. The initial shared assignment
matrix measured 18 failures out of 27 cases. This is the object-property form
of review finding 2, not a new surface syntax.

Both row relations now compare accessor reads, writes and own enumeration,
including hidden enumerable members and index signatures. Generic bodies must
respect their authored parameter bounds; a merely transferred value can retain
its richer type. Generic copy cannot silently read an unbounded argument's
effectful getters. The checker distinguishes mapped accessor views from data
materialized by a spread, and both publishers preserve that distinction. A
source-free test caught the publisher incorrectly recreating a getter on copied
data. The Go imported `typeof namespace.member` control also exposed and fixed
a member name being misclassified as an ambient global read.

The shared matrix contains 35 local assignment cases, two generic-callback
ownership refusal controls, one exact diagnostic-count control, and seven real
publication/consumer cases. The JS matrix initially passed 40 tests (74
assertions), and the combined JS relation/declaration/protocol group passed 325
tests (968 assertions). Two final controls ensure a generic function that
widens or casts its return is not mistaken for a row-preserving identity; the
final JS assignment/callable group passes 99 tests (168 assertions).
All original 33 Go local cases pass; the corrected Go source-free/map group
passes after fixing the qualified type-query classification. Both CLI controls
pass, now also requiring `VIBE1808` and no emitted artifact for an imported
accessor whose row is erased. Existing source-free implicit calls, native
disposal, pure prototype copies and key-only enumeration remain controls.
The Go relation group passes in 135.030 seconds; the final four generic
identity/erasure controls also pass in 7.759 seconds.

Evidence:
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-views-before.jsonl`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-views-after.jsonl`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-js-regressions.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-go-published-final.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-go-identity-final.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-cli.log`. <!-- brand-gate: allow existing verification path -->
These changes postdate snapshot 17. No corpus expectation or marker changed;
cleanup precedence remains undecided and this is not an alpha-0 certificate.

Snapshot 18 (`/tmp/vibelang-alpha0-release.q6qvmS`, 2,075 inputs, digest
`425f7cbcb8b51fa833a3f9a91ff05746a7fe1cc61d9a7091ff3385e8149007f6`)
stopped in the Node gate: 261 of 262 tests passed. The Go conformance test found
19 newly refused durable cases because the raw generic-bound comparison also
compared the compiler-owned `durable` callback's uninstantiated completion.
Go now recognizes all of its compiler-owned prelude files at this boundary,
matching the JS prelude exclusion. Ordinary generic completions are checked
against the instantiated signature; their return variables are not void sinks.
Existing generic callback ownership refusals remain explicit controls, not
newly claimed implementations. The unchanged Go corpus is back to 526 matches,
28 declared expected failures and zero unexpected divergence or unmeasured
cases. No marker was added or widened. Evidence:
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-18.log` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-corpus-go-final.log`. <!-- brand-gate: allow existing verification path -->
Snapshot 18 is a failed checkpoint, not a release certificate.
After that correction the JS assignment/callable group passes 101 tests (170
assertions); the focused Go generic/accessor/ownership controls pass in 13.314
seconds. Logs are
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-js-guards-final.log` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-go-guards-final.log`. <!-- brand-gate: allow existing verification path -->

Snapshot 19 (`/tmp/vibelang-alpha0-release.NSFLnf`, 2,075 inputs, digest
`d2c33c9588edd8290d3652467844026dc3c22078be9477d99296bcc445f62693`)
passed all 262 Node tests, then stopped in Bun: 3,329 passed, one failed and the
credentialed live-model test was skipped. The failed assertion caught the new
generic comparison repeating an existing `VIBE1303` at the same location in
the excluded duration port. The additional bound check now runs only after a
valid instantiated relation. The assertion remains unchanged; the focused
platform/assignment/callable group passes 112 tests (244 assertions), and a
new shared control requires exactly one diagnostic for an already-invalid
generic argument. No refusal or corpus marker was removed.

The original reviewer probes were independently remeasured on snapshot 19:
findings 1–6 and 8 retain their corrected observations; finding 7 remains open.
The unchanged public alpha demo also passes all four stages, including signed
deployment, persisted replay, and SIGKILL after the first journal commit followed
by a new-process result of 100 without repeating the committed Action.
Evidence:
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-19.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-js-duplicate-final.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/review-probes-snapshot19-js.jsonl`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/review-probes-snapshot19-go.jsonl`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/alpha0-demo-snapshot19.log`. <!-- brand-gate: allow existing verification path -->
Snapshot 19 is not a release certificate.
The completed shared Go accessor/publication group now passes all 45 cases
plus its two parent tests in 5.214 seconds. It reuses the pinned backend across
independent compile requests, matching the publication tests, while preserving
declaration emission and every diagnostic/runtime assertion. Its log is
`/tmp/smithers-alpha0-verification.Wa6A93/accessor-assignments-go-complete-final.log`. <!-- brand-gate: allow existing verification path -->

### Published implicit calls: complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 for the 2,072-input snapshot
`/tmp/vibelang-alpha0-release.qj17pM`. Input manifest SHA-256:
`b19959b3dafe651146828d1b145fd4536800d135385938e367ac941fde669e20`.
The verified manifest and complete log are
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-17.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-17.log`. <!-- brand-gate: allow existing verification path -->

- Node: 262 passed, no failures or skips; 132,826.965917 milliseconds.
- Bun: 3,286 passed, one explicitly credentialed live-model skip, no failures;
  23,682 assertions across 168 files, 521.99 seconds.
- Go: 2,128 passed, no failures or skips; 1,031.435 seconds.
- Shared corpus: JS 553 passed plus one declared expected failure; Go 526
  matched plus 28 declared expected failures; six interop cases per backend.
- CLI oracle: all 554 cases retain the exact 20-row reviewed divergence set;
  zero product-only accepts (two product refusals, 18 diagnostic differences).
- Package: 585 files, 537 generated files, 43 exports; installed Node/Bun
  consumers and reproducibility checks passed. Archive SHA-256:
  `86fd4c844a7e93ef0706480a52b5da50a749d45eb052a24498f308d0fdb922df`.
  Inventory SHA-256:
  `7e394a94d4f6e971b579c71491667b091d993289c075e63a0fcdf6949d0d9247`.
- Documentation build: 81 files generated.

This certifies the source-free implicit-call and CLI declaration-staging work
below. The accessor structural-view follow-up above postdates this snapshot;
cleanup precedence and shared-runtime linking remain open. This is not an
alpha-0 completion claim.

### Source-free implicit calls and CLI declaration staging (2026-09-06)

Four fresh JS consumers of actual emitted libraries compiled with empty rows and
then panicked on a missing `C`: getter, coercion, iterator and disposer calls.
Their declarations already carried the row. The first ten source-free tests
measured nine failures, also exposing object-accessor metadata erased by the
stock declaration serializer. Native invocation edges now read published
signatures without pretending those signatures are local function bodies.

Both publishers retain object get/set signatures and symbol-named methods.
Returned-callable and setter-parameter rows remain distinct. The versioned
`@vibelangAccessor` record preserves enumeration provenance through anonymous
class instance types; malformed/authored claims are refused. Source-free
disposal checks also preserve Result/Promise ownership. JS refuses native
invocations of published resumable conventions which native drivers cannot run.
The Go declaration map composes accessor restoration and metadata insertion,
including multiline types and comment removal.

The shared matrix now has 26 publication/consumer cases plus seven malformed
accessor envelopes. Additional tests pin compiler ownership, independent read/
write contracts, pure prototype/enumeration controls, declaration maps and
source-free eager execution. The focused language/runtime run passed 219 tests
(753 assertions); the subsequent paired-declaration group passed 86 tests
(479 assertions), and the final merged-getter control passes independently on
both backends. The Go declaration/disposal/map group passed 153 tests before
that final additional case. These are focused measurements, not a fresh full
release certificate.

The public CLI tests additionally found and fixed erased-JavaScript rechecking
and loss of the nominal table at the relocated runtime path. The bounded
runtime graph now captures companion declarations and their transitive type
dependencies, and the emitted-module resolver uses them at the relocated path.
Publication copies supplied declarations without inventing VibeLang metadata on
foreign declarations. Both CLI controls compile and run after removing the
original library directory; unprovided capabilities and incompatible ordinary
TypeScript types are still refused. The no-panic initialization claim is still
required and tested separately; no loader trust check was weakened.

Evidence is retained in the verification directory:
`/tmp/smithers-alpha0-verification.Wa6A93/declaration-implicit-js-regressions-final.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/declaration-implicit-go-regressions.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/declaration-implicit-paired-js.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/declaration-implicit-cli-final.log` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/declaration-implicit-cli-controls-2.log`. <!-- brand-gate: allow existing verification path -->
The corpus and its markers are unchanged. Cleanup precedence remains undecided;
this checkpoint does not declare alpha-0 complete.

### Disposal follow-up: complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 for the 2,068-input snapshot
`/tmp/vibelang-alpha0-release.7wv447`. Its input digest is
`64a6f7c5871c08013fac1be29380461434afe7b921162ad590581935d8279fc6`.
The manifest and complete log remain at
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-16.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-16.log`. <!-- brand-gate: allow existing verification path -->

- Node: 256 passed; no failures, skips or todos; 132,909.615 ms.
- Bun: 3,248 passed, one explicitly credentialed live-model skip, no failures;
  23,412 assertions across 167 files, 497.92 seconds.
- Go: 2,089 passed, no failures or skips; 1,022.728 seconds.
- Shared corpus: JS 553 passed plus one declared expected failure; Go 526
  matched plus 28 declared expected failures; six interop cases per backend.
- CLI oracle: all 554 cases retain the exact 20-row reviewed divergence set;
  zero product-only accepts (two product refusals, 18 diagnostic differences).
- Package: 585 files, 537 generated files, 43 exports; installed Node/Bun
  consumers and reproducibility checks passed. Archive SHA-256:
  `9cf649117e3d7a0caf7d60837ff40132ff928b35e76744936a4d72f7ef49dc7c`.
  Inventory SHA-256:
  `69eaaa4ceafa3b71da68ac6544c0c823c460f9da1cf7fb54ac0b2f947f7c7c8e`.
- Documentation build: 81 files generated.

This certifies the native disposal follow-up and implicit resumable-body
refusals below. It does not decide cleanup precedence, certify unmeasured
declaration-only protocol cases, or declare alpha-0 complete.

### Native disposal and implicit Flow invocation follow-up (2026-09-06)

Ordinary `using` declarations were missing invocation edges to their disposers.
Both frontends could publish an empty requirement row despite a capability read
in cleanup. Native synchronous disposal also discarded Result/Promise returns,
including the synchronous fallback of `await using`. The new shared protocol
selection walks each resource union member, prefers a definite async disposer,
keeps optional/nullish fallback rows, and charges disposer getters as well as
their returned callables. It covers `for (using ...)` bindings without a local
initializer. Foreign implicit disposal retains the checked panic refusal.

Completion checking reuses callable-completion loss and stored-value ownership
classification. Inference, return unions and returned data containers cannot
hide a lost Result or started Promise; ordinary returned data remains legal.
An extra inferred-return test caught a Go-only omission before the final fix.
Two container-return probes were also accepted cleanly on both backends before
the ownership-transfer check was connected to disposal.

The final shared matrix passes all 37 cases on each backend. The earlier broad
invocation/foreign/ownership/row/frame-elision groups passed 444 JS tests (860
assertions) and 247 Go tests. The final completion/callback/body group passes
83 JS tests (215 assertions); Go's final disposal run passes 37 subtests plus
its parent in 5.491 seconds. Logs are
`/tmp/smithers-alpha0-verification.Wa6A93/disposal-language-regressions.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/disposal-go-regressions.log`, <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/disposal-completion-collections-js.log` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/disposal-completion-collections-go.log`. <!-- brand-gate: allow existing verification path -->

The same investigation reproduced three accepted executable bodies whose native
disposal, iteration or coercion consumed a generator without driving its durable
request. A reusable semantic target query now lets the body compiler refuse
native consumers of private resumable methods with `VIBE1802`. Eight tests cover
all three body-compilation APIs, getters/setters/async disposal, ordinary native
cleanup, and an explicit `finally` that yields an Action and then completes.
The broader body/deployment/timer group passed 70 tests (463 assertions). A new
shipped-CLI test requires the three formerly accepted sources to refuse without
emitting an artifact; all six public durable tests passed. Product build, brand
and documentation-snippet checks passed.

This is a fail-closed implementation boundary, not general resumable native
protocol support. It does not decide whether a cleanup completion replaces an
already-propagating failure. These changes postdate snapshot 15 and are now
certified by complete snapshot 16 above. No corpus fixture or expected failure changed.

### Durable values and inventory: complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 for the 2,064-input snapshot
`/tmp/vibelang-alpha0-release.VDqAEm`. Its input digest is
`ce2aadcc1c12775c42a4a7cd952c8b32c94c302bcadfdfa8454f2843bf60b1b2`.
The manifest and complete log remain at
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-15.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-15.log`. <!-- brand-gate: allow existing verification path -->

- Node: 255 passed; no failures, skips or todos; 132,359.637 ms.
- Bun: 3,203 passed, one explicitly credentialed live-model skip, no failures;
  23,259 assertions across 165 files, 486.67 seconds.
- Go: 2,051 passed, no failures or skips; 1,022.107 seconds.
- Shared corpus: JS 553 passed plus one declared expected failure; Go 526
  matched plus 28 declared expected failures; six interop cases per backend.
- CLI oracle: all 554 cases, the existing 20 reviewed divergences match exactly;
  zero product-only accepts (two product refusals, 18 diagnostic differences).
- Package: 585 files, 537 generated files, 43 exports; installed Node/Bun
  consumers and reproducibility checks passed. Archive SHA-256:
  `1877036f328b45bb41a55e0e3dc23c166579ec6116e5d3d757c84c6024d13e85`.
  Inventory SHA-256:
  `35e9dd16af956dde00a61255a4b9643662fa0d8a40716e4899af85c0ea682a33`.
- Documentation build: 81 files generated.

This certifies the mutable-value boundary, inferred Action-payload library
methods and complete diagnostic inventory below. It does not certify the newer
disposal-protocol follow-up or declare alpha-0 complete. Cleanup precedence
remains an unanswered language-design decision.

### Inferred payload methods and diagnostic inventory (2026-09-06)

Removing a redundant local annotation from the Action-answer mutation regression
exposed a Manifest refusal: the raw TypeScript checker still sees the Result
behind `Read.run(input)!`, so it cannot resolve `answer.items.push`. The body
compiler now supplies value-view member symbols, derived from the existing
language extraction shape and the checker's property identities, to the
Manifest. This only supplements default-library classification; it neither
exempts unknown methods by spelling nor changes call lowering or effect rows.
Unconsumed Results and unsupported effectful native callbacks still refuse.

Nine focused cases cover direct and inferred receivers, const aliases, computed
member names, primitive and array methods, replay, opaque methods, missing
propagation and effectful callbacks. The body/value/compiler/Manifest/module/
source-compiler group passes 131 tests (1,037 assertions). Product build passes.
The original signed Action-answer mutation regression now uses inference without
the local annotation. The log is
`/tmp/smithers-alpha0-verification.Wa6A93/body-inferred-method-regressions.log`. <!-- brand-gate: allow existing verification path -->

The diagnostics-page generator had its own incomplete code grep, omitting
31 codes from durable, compiler and asset sources. It now uses the coverage
ledger's existing report-site census, including constructed Go codes and its
comment/test exclusions. The regenerated page lists 73 JS-observed codes and
56 additional implementation-defined codes (not a claim about Go observation).
Two new Node checks require every implementation code and the availability
table to agree with that census; they and the existing census tests pass, 32
tests total. No conformance fixture was added or weakened for these changes.
These follow-ups postdate green release snapshot 14 and are now certified by
snapshot 15 above.

### Mutable durable value boundary follow-up (2026-09-06)

An additional accepted-program probe found that `input.value++` inside an
executable Flow panicked on the codec validator's frozen object. Local Action
implementations received the same immutable validation evidence, and ordinary
`hasOwnProperty` calls on returned Flow values failed because normalized wire
objects have null prototypes. The executable and both compatibility output
paths reproduced that public-result defect before the fix.

The shared codec now has an execution-only materialization seam. Flow inputs,
Action inputs on local and remote-host transports, live/replayed Action answers,
and public results receive isolated ordinary object/array graphs. Persistence,
authenticated invocation evidence, inspection and cache-identity callbacks keep
their existing immutability. Deno transports already parse the wire data in the
isolated process. Neither canonical field ordering nor cross-boundary alias
identity is changed by this fix.

Ten new regression tests pass (69 assertions): schema/accessor rejection,
own `__proto__` safety, input mutation, live/replayed answer mutation, immutable
commits, terminal reattachment and worker-host invocation isolation. The broader
schema, transport-symmetry, remote-host, Deno-bundle, provider/cache and signed-body
group passes 97 tests (690 assertions). Actual remote and isolated worker fixtures
now mutate their authored inputs while retaining their previous expected results.
The clean product build passes. Logs are
`/tmp/smithers-alpha0-verification.Wa6A93/body-values-final-unit.log` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/body-values-regressions.log`. <!-- brand-gate: allow existing verification path -->

Another 121 body, timer, replay and runtime-boundary tests pass (584 assertions).
Brand and documentation-snippet gates also pass. These changes postdate timer
release snapshot 14; neither that snapshot nor snapshot 13 certifies this follow-up. Cleanup
precedence remains an unanswered language-design decision, not a test waiver.

### Executable timers: complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 for the 2,061-input snapshot
`/tmp/vibelang-alpha0-release.1clkEK`. Its input digest is
`279fec08c636ab428913cf5913aff1e0a37bef036979eabd1dfc9e7dba87415b`.
The manifest and complete log remain at
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-14.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-14.log`. <!-- brand-gate: allow existing verification path -->

- Node: 253 passed; no failures, skips or todos.
- Bun: 3,184 passed, one explicitly credentialed live-model skip, no failures;
  23,154 assertions across 163 files, 485.61 seconds.
- Go: 2,051 passed, no failures or skips; 1,022.546 seconds.
- Shared corpus: JS 553 passed plus one declared expected failure; Go 526
  matched plus 28 declared expected failures; six interop cases per backend.
- CLI oracle: 554 cases, the existing 20 reviewed divergences match exactly;
  zero product-only accepts (two product refusals, 18 diagnostic differences).
- Package: 585 files, 537 generated files, 43 exports; installed Node/Bun
  consumers and reproducibility checks passed. Archive SHA-256:
  `0779d1a790db5cebafc69f673649601757c4658addf47b3235767412810d6afd`.
  Inventory SHA-256:
  `3cd942ef2b7bdd0bf434e63a65d8ea5784d6ccbea34c35af1396a0ce6f3e8e0e`.
- Documentation build: 81 files generated.

This certifies executable timers, their versioned artifact admission, the CLI
timer path and the updated timer corpus expectation. It does not certify later
mutable-value or diagnostic-inventory work, or declare alpha-0 complete.

### Executable timer follow-up (2026-09-06)

The ordinary body compiler now binds the existing `sleep` intrinsic to a
Manifest-checked perform request. The shared emitter preserves its declared
`null` result, lexical call position and helper/loop/async behavior. Known invalid
durations and malformed call shapes refuse without a legacy Plan downgrade.
The signed BodyExecutor selects coordinator-owned timer nodes instead of Action
routes; persisted durations and source/site/occurrence identities remain pinned.
Timer artifacts use body version 2, so older runtimes refuse them before loading
code; version-1 Action-only bodies remain readable. A timer site cannot claim
the older artifact version, even after its digest is recomputed.

Timer creation and its absolute wake time commit in one store transaction under
the deployment fence and running-state check. No lease is acquired before the
wake time. The replay driver records submission at `timer_scheduled`, so a crash
before the first claim cannot hide that request from divergence checks. Timer
answers use the ordinary fenced commit path; cancellation, deadline expiry and
competing coordinators share existing durable terminal-state behavior.

Seventeen focused timer tests pass (130 assertions), including codec tampering,
changed-duration/shortened-replay refusal, early-lease refusal and real SIGKILL
after scheduling followed by fresh-process authentication and resume. The wider
body/replay/legacy-timer/module group passes 115 tests (730 assertions). Another
53 crash-matrix, vertical-slice and runtime-boundary tests pass (213 assertions).
All five
public durable package/CLI tests pass, including a new CLI-emitted timer loop,
declarations, authored source maps, signed execution and partial replay.

The unchanged corpus sleep-duration projection source now executes and replays
its two-element array length as `durationMs: 2`, with one Action invocation.
Its old Plan-only refusal is retired in favor of the existing §Flow contract;
Go retains a missing-executable-body marker, measured at its previous
`VIBE4110@10:29`; neither backend has a fail-open marker for this case. The
41-case JS durable area passes, and a filtered CLI oracle run agrees on the
timer projection. Product build, documentation snippet and brand gates pass.
These changes postdate the successful release snapshot 13 recorded below and
are now certified by snapshot 14 above. They do not settle cleanup precedence.

### Completion ABI and hygiene: complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 for the 2,058-input snapshot
`/tmp/vibelang-alpha0-release.p3Ohv5`. Its input digest is
`fe48378727322ad99acd37dd1917dc3bff952b655be52f9a17d0580c0827b258`.
The manifest and complete log remain at
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-13.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-13.log`. <!-- brand-gate: allow existing verification path -->

- Node: 252 passed; no failures, skips or todos.
- Bun: 3,167 passed, one explicitly credentialed live-model skip, no failures;
  23,024 assertions across 162 files, 483.54 seconds.
- Go: 2,051 passed, no failures or skips; 1,024.059 seconds.
- Shared corpus: JS 553 passed plus one declared expected failure; Go 527
  matched plus 27 declared expected failures; six interop cases per backend.
- CLI oracle: 554 cases, the existing 20 reviewed divergences match exactly;
  zero product-only accepts (two product refusals, 18 diagnostic differences).
- Package: 582 files, 534 generated files, 43 exports; installed Node/Bun
  consumers and reproducibility checks passed. Archive SHA-256:
  `66ad295ed9710978b92b4089a4e6ab163db7c5d16af1de39dcb13528222ae64b`.
  Inventory SHA-256:
  `f51a415477b626e1aa0e5b02af893e9ab68b2f4041fd61f30616f0033f867ca6`.
- Documentation build: 81 files generated.

This certifies frame elision, generated-name hygiene and both completion-helper
integration fixes. It predates the executable-timer work and its corpus
expectation change; it does not certify those or declare alpha-0 complete.

### External-review probe remeasurement (2026-09-06)

The reviewer's unchanged 23-case probe runner was rerun against the live tree
on both backends. This is a fresh observation, not a claim that every shape in
each broad finding has been exhausted.

| Review finding | Current observation |
| --- | --- |
| 1: discarded effectful calls | Async, method and callback probes execute and return `1` on both backends. |
| 2: annotated row erasure | Both frontends refuse the assignment with `VIBE1808`. |
| 3: missing ownership paths | All six row/lifetime probes refuse with source diagnostics; branches, uninvoked closures, collections and propagation-before-await are covered. |
| 4: host-dependent Date | Both frontends refuse the three local-zone operations with `VIBE1602`; the executable-body probe also refuses. |
| 5: lost capture mutation | The executable body completes with `2`, matching authored initialization. |
| 6: comptime order | All three compile-time/runtime comparisons retain authored order on both backends. |
| 7: cleanup completion | Still unresolved: `finally_return` yields `-1`, and both cleanup-throw probes retain `first`. The requested precedence decision has not been made. |
| 8: nested Flow compiler crash | The executable-body API returns structured `VIBE4103`, not an internal exception. |

The three direct executable-body probes are JS API measurements; the Go probe
runner explicitly skips them, so they are not Go body-emission evidence. The
two extra controls remain unchanged: extracted Error matching succeeds and an
out-of-bounds Result access panics. Logs are
`/tmp/smithers-alpha0-verification.Wa6A93/review-probes-latest-js.jsonl` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/review-probes-latest-go.jsonl`. <!-- brand-gate: allow existing verification path -->
Other implementation obligations remain open; passing the corrected probes
does not establish alpha-0 completion.

### Non-suspending Result completion follow-up (2026-09-06)

Explicitly annotated fallible bodies with no lowered yield now use a lexical
completion thunk and a final brand check, without allocating a generator or
handler frame. Both emitters decide this after lowering; inferred contracts and
the reference's private durable resumable convention remain framed. Return
checking retains the authored type inside the thunk, and the final brand check
occurs after `finally`/disposal so it cannot preempt an ordinary return override.
No cleanup-precedence decision for active failure propagation is made here.

Thirty-eight shared vectors execute sync/async returns, forwarding, recursion,
generic contracts, lexical receivers, `super`, disposal, panic protection,
foreign invalid completions and ordinary cleanup overrides. Propagation,
`expect`, nested yields and inferred contracts retain their delimiters; invalid
success/missing-number returns remain refused. Together with nine runtime
completion/forgery checks, the reference passes 47 tests (214 assertions). The
38-case Go matrix also passes. A surrounding reference group passed 284 tests
(1,066 assertions), including executable-body compilation, signing, deployment
and the real crash/restart vertical. The pre-alias Go surrounding group passed
166 tests; its stale non-suspending frame assertion now checks both optimized
emission and executed values. The final Go group, including helper-name hygiene,
library/configuration checks and source-free declaration round-trips, passes
246 tests in 101.4 seconds. The compiler-hook authoring-surface suite passes
16 tests (17 assertions), including refusal of the new completion hook.

The tests exposed and fixed additional lowering defects: Go bare/implicit
`Result<void, E>` completion now lifts `void 0`; synthesized undefined values
and pending-panic sentinels cannot resolve to an author's shadowing parameter;
Go helper import aliases avoid every authored identifier, including nested
parameters and generated-looking suffixes. Explicit `lib` values now use the
fork's upstream bundled-library resolver, independently of emit target. Unknown
names/paths are rejected, omitted libraries are not restored, and incomplete
globals produce stock diagnostics rather than an internal prelude failure.
Relative/unnormalized configuration paths no longer crash the JSON parser;
diagnostics retain the caller's path spelling and source span.

A local Bun 1.2.20 benchmark of three one-million-call samples fell from
456–476 ms with the old generator driver to 208–215 ms with validated completion.
Each run checked the computed sum. This is a measured microbenchmark, not an
alpha-wide performance promise or a timing-threshold test. Source type checking,
the brand gate and whitespace checks pass. These changes postdate the frozen
generator-row release certificate below; alpha-0 is not declared complete.

The first frozen release attempt for this follow-up (snapshot 11) failed the
Node gate: its separate external-pipeline proof runtime lacked the new completion
hook (`TS2305`), which also prevented its map-round-trip observation. It is not a
green checkpoint. The proof runtime now implements the same final brand check;
all four pipeline tests pass with no skips. No acceptance assertion was removed.

The next frozen attempt (snapshot 12) passed all 252 Node tests, then failed
the Bun gate (3,129 pass, one declared live-provider skip, 20 failures). Its
embedded worker runtime had a second, separate export allowlist missing the
same completion hook. The bundle now exposes the real branded runtime helper;
new sync/async bundle tests execute success, ordinary `finally` return override,
and nominal failure through the digest-covered emitted bytes. The local/Deno/
remote worker, transport, lease and runtime-boundary group passes 65 tests
(175 assertions). The schema group, including the formerly failing bundled
nominal-Error case, passes alongside the name-hygiene matrix below: 35 tests,
381 assertions. Snapshot 12 is a failed checkpoint, not a release certificate;
its Go, oracle, package and documentation stages did not run.

### Generated-name hygiene follow-up (2026-09-06)

The Go emitter now allocates every generated lexical capture, pending-panic
slot, hoisted match receiver and computed-super binding against all authored
identifiers. The same allocator already protects its helper imports. It also
reserves previously allocated names and generated-looking authored suffixes;
Unicode escape spelling cannot hide a binding. No parser change is involved.

Sixteen shared vectors cover receiver/arguments/new-target/super captures,
computed key types, panic state, match callbacks, async functions and both
emitters' temporary-name spellings. Before the fix, nine Go-accepted programs
returned the wrong value and one valid program was refused; the reference
passed all ten original probes. All sixteen vectors now pass on both backends.
The wider Go group passes 257 tests (105.6 seconds), including frame completion,
panic protection, configuration/libraries and source-free declaration behavior.
The final sixteen-vector Go rerun passes in 3.4 seconds. Source type checking
and whitespace checks pass. These checks do not settle active-propagation
cleanup precedence or replace a fresh full release run.

### Authored-generator row follow-up (2026-09-06)

The existing generator refusal covered recoverable failures but missed capability
requirements. A Go-accepted generator could be created inside `Layer.provide`,
escape the provider's extent, then panic when resumed. The reference missed the
same source diagnostic and leaked a generated TypeScript type error instead.
Both source checkers now enforce the existing specification's prohibition on
an authored generator's non-empty `(E, R)` row, using `VIBE1106`.

Seventeen shared vectors cover direct/transitive/callback requirements, expressions,
methods, async generators, cleanup and the scope-escape reproducer. Pure
generators and generators that internally discharge their requirement still
compile and execute. The ambient `Date.now()` control remains refused by its
existing `VIBE1602` source rule, before a capability row is inferred. Both vector
suites pass; the initial fifteen-case reference group reported 60 assertions.
The expanded matrix adds ordinary iterator-method execution and an unsupplied-row
control. Together with the updated invocation tests, it passes 89 JS tests
(201 assertions) and 89 Go tests (18.5 seconds). The existing invocation tests
retain their row assertions and now declare the additional generator refusals;
the method-versus-arrow comparison uses two ordinary methods with the same
static contract, not a separately forbidden generator. A prior surrounding
language group passed 175 tests (413 assertions), and the strengthened
context-row suite passes 19 tests (123 assertions).
Source type checking, the brand gate and diff whitespace checking pass. The new
vectors are outside the 554-case corpus. One existing negative invocation fixture
also contains two requirement-bearing generators: its expected cascade now adds
the two normative `VIBE1106` refusals while retaining all six existing `VIBE2102`
positions and the `Db` message obligation. Both backends measured that complete
cascade. No marker or output expectation changed. The generated diagnostic page
now records the newly exercised capability-row wording.
This follow-up is covered by the complete release checkpoint immediately below.

### Generator rows: complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 for the 2,050-input snapshot
`/tmp/vibelang-alpha0-release.cm3AbX`. Its input digest is
`4362a30d639677a9df9e8a3166ce7b0a4e6d0bb4ed5042fa77cefe1c1fabd005`.
The manifest and complete log remain at
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-10.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-10.log`. <!-- brand-gate: allow existing verification path -->

- Node: 252 passed; no failures, skips, or todos.
- Bun: 3,101 passed, one explicitly opt-in credentialed live-model test skipped;
  no failures; 22,735 assertions across 159 files.
- Go: 1,973 passed; no failures or skips.
- Full CLI differential: 554 cases, 20 divergences matching the reviewed record;
  zero product acceptance of corpus-refused programs.
- Reproducible package: 582 files, 534 generated files, 43 exports; installed
  Node/Bun, CLI, and API-type consumers pass.
- Production documentation: 81 generated files, exit 0.

Archive SHA-256:
`ee3c0ec3d570bb18ffecf97a77cedfd8d886ecf90789eeb73276bce5e4827bf7`.
Inventory SHA-256:
`b855916a6be91cadbcdae177278289f23cfe61eb15e22776a77f613530c200f8`.
This snapshot predates the non-suspending Result frame optimization and its
follow-up checks. It does not settle cleanup precedence or establish alpha-0
completion.

### Go source-free declaration publication checkpoint (2026-09-06)

The Go backend now carries compiler-owned callable rows through the stock
TypeScript declaration serializer, including returned closures, members,
constructors, overloads and anonymous default exports. Type-only requirement
tables preserve nominal constructors across private captures, forwarding
packages, imported function aliases/containers, and re-exports. Imported labels
are rebound through actual constructor types, so same-spelled local keys cannot
replace a dependency's identity. Unrepresentable escaping local constructors
fail publication with `VIBE1810`. Metadata survives comment removal; declaration
maps account for inserted comments. The documented source-free `.vibe` import
pair is now connected to runtime `.js` rewriting after contract validation.

Callable envelopes remain v2. Go module envelopes use v3 with an explicit
`vibelang-go-eager@1` runtime ABI, because paths and similar export names do not
link brands or capability environments. Go rejects mismatched ABI identities
and unlinked locations; the JS reader rejects this envelope pending a compatible
linker. This is a bounded Go-to-Go publication path with one shared emitted
prelude, not a claim of general installed-package or cross-backend linking.
No upstream parser/checker patch was added for publication.

The eighteen-shape execution matrix and private/returned-alternative/map/comment
controls passed in 13.1 seconds. Result/async/nominal Error execution plus runtime
identity controls passed in 4.9 seconds; forwarding/private controls passed in
5.1 seconds. A broader callable/Layer/declaration/lowering/nominal/configuration
regression group passed 221 tests in 214.8 seconds. Five later imported-alias/container/
collision/re-export cases passed in 4.3 seconds. The reference metadata group,
including the Go-ABI refusal, passes 26 tests (35 assertions); together with
the reference ABI execution suite it passes 34 tests (105 assertions). The combined
current declaration group passes 76 tests in 28.4 seconds. The complete release
certificate immediately below now covers this publication work; other goal
obligations and the cleanup-precedence decision remain open.

### Go publication: complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 for the 2,047-input snapshot
`/tmp/vibelang-alpha0-release.6MpCWn`, including the Go declaration publisher,
strict runtime-ABI identity, source-free execution tests, and matching docs.
Input digest:
`eb3b5352fbdde2554a2709237df030d0abd1b862ea6292898ac7c4ca02581f5b`.
The manifest and complete log remain at
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-9.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-9.log`. <!-- brand-gate: allow existing verification path -->

- Node: 252 passed; no failures, skips, or todos.
- Bun: 3,084 passed, one explicitly opt-in credentialed live-model test skipped;
  no failures; 22,666 assertions across 158 files.
- Go: 1,955 passed; no failures or skips.
- Full CLI differential: 554 cases, 20 divergences matching the reviewed record;
  zero product acceptance of corpus-refused programs.
- Reproducible package: 582 files, 534 generated files, 43 exports; installed
  Node/Bun, CLI, and API-type consumers pass.
- Production documentation: 81 generated files, exit 0.

The npm archive and inventory digests equal the preceding comptime certificate:
these newer changes affect Go bridge source, tests and non-packaged docs rather
than npm runtime bytes. This snapshot predates the authored-generator follow-up
and its expectation amendment. It is not an alpha-0 completion claim.

### Comptime follow-up: complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 for the 2,045-input snapshot
`/tmp/vibelang-alpha0-release.TUSsEO`, including the allocation-identity fix,
shared vectors, real sandbox transport, and the installed-consumer alias check.
Its input digest is
`88dd452178db4af97dd41a11dd6cdd9921c810d38b8aab261157de2c65e588b6`.
The manifest and complete log remain at
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-8.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-8.log`. <!-- brand-gate: allow existing verification path -->

- Node: 252 passed; no failures, skips, or todos.
- Bun: 3,083 passed; the one credentialed live-model test is explicitly opt-in
  and skipped; no failures; 22,664 assertions across 158 files.
- Go: 1,917 passed; no failures or skips.
- Full CLI differential: 554 cases, 20 divergences matching the reviewed record;
  zero product acceptance of corpus-refused programs.
- Two clean package builds are byte-identical: 582 files, 534 generated files,
  43 exports; installed Node/Bun, CLI, and API-type consumers pass.
- Production documentation: 81 generated files, exit 0.

Archive SHA-256:
`f82336ad5f3fdb408b91d4cefe516a0afd95dba4cc866f2e3f090ae493120aab`.
Inventory SHA-256:
`6bfd85b5d57777f3d223398124040b47905d609d9459185999e9ce80dd2d3c72`.
This certifies that snapshot only. Go declaration publication is newer work with
separate regressions in progress, cleanup precedence awaits the user's decision,
and the other open implementation obligations remain open. This is not an
alpha-0 completion claim.

### Comptime allocation-identity follow-up (2026-09-06)

Additional review probes found an accepted-program defect beyond property
order: a comptime result `{ left: shared, right: shared }` materialized two
objects, so reference equality changed from `true` to `false` on both cold and
warm builds. A structurally equal but separately allocated control stayed false.

Program-data snapshots now preserve aliases. The reference cache and real
sandbox argument/result protocol use a bounded, canonical postorder value graph,
pinning both own-property order and allocation sharing; obsolete cache identities
are invalidated. Both emitters allocate shared containers once inside a closed
ordinary TypeScript expression. The Go evaluator also validates cycles and
expanded-data bounds before literal/type generation or JSON serialization.

The new twelve-case shared matrix covers shared/distinct objects and arrays,
nested and shallow-copy aliases, numeric/string property order and an own
`__proto__` data property. Its Go execution group and three graph-bound controls
pass. Fully checked reference emission and execution, cache tampering, graph
validation, sandbox transport and the surrounding build/comptime regressions
pass 133 tests (1,949 assertions). The broader Go comptime/asset/schema group
passes in 138.6 seconds. The complete reference build group passes 227 tests
(2,740 assertions). Cross-phase/cross-call allocation identity is not settled
by preserving sharing within one value. The later complete release checkpoint
above covers this implementation.

This follow-up was made after the release snapshot below was frozen. Its changes
are not covered by that snapshot's release certificate. No corpus fixture or
expected-failure marker changed.

### Complete serial release checkpoint (2026-09-06)

`npm run release:verify` completed with exit 0 in the isolated source snapshot
`/tmp/vibelang-alpha0-release.qHEnR0`. Its 2,041-input manifest has SHA-256
`938194c0bc9e9df69d23fb98e2b131932a96d4ece24eddc4fce8e75a47ebe0e1`;
the manifest and full log are retained at
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-7.json` and <!-- brand-gate: allow existing verification path -->
`/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-7.log`. <!-- brand-gate: allow existing verification path -->

- Node: 252 passed, no failures/skips/todos.
- Bun: 3,044 passed, one explicitly opt-in credentialed live-model test skipped,
  no failures/todos; 22,388 assertions across 157 files.
- Go: 1,900 passed, no failures/skips.
- Full CLI differential: 554 cases; its 20 recorded divergences match the
  reviewed baseline, with no new failure or permissive acceptance.
- Packaging: two clean builds produce the identical archive, with 579 files,
  531 generated files and 43 exports; installed Node and Bun consumers, API
  types and CLI smoke tests pass.
- Documentation production build passes, generating 81 files.

The archive SHA-256 is
`926d858d69b8b6260c528c5c75b58d5b36de89d91903c975a07b4402067f1470`.
This certifies the stated snapshot, not alpha-0 completeness: the later
comptime identity fix needs fresh gates, cleanup precedence still needs the
user's decision, and the declaration/runtime-linking and other implementation
obligations below remain open.

### Async Layer execution checkpoint (2026-09-06)

New shared execution probes found accepted-program failures beyond the saved
review cases. The Go runtime popped its provider stack when an async callback
returned its Promise: six probes panicked after await. Its eager-call bridge now
uses isolated async environments through completion/rejection, keeps the exact
returned Promise (including cross-realm/pre-existing values), and revokes access
from escaped work. Layers are opaque and branded; unspecified duplicate/override
precedence no longer silently selects an implementation. The host declarations
needed by this bridge do not grant authored code access to those APIs.

On the reference path, a synchronous provider inside an ordinary async scope
incorrectly treated inherited keys as unprovided. Its root driver now uses the
same eager-call bridge as other non-delegating calls. A non-async callback that
returns a Promise also no longer becomes a synchronous generator whose early
completion revokes that Promise's environment. Provider lifetime follows the
returned value, not merely the presence of an `async` modifier.

The shared matrix in `compiler/layer-scope-vectors.json` covers 17 cases: async
scope, sibling isolation, nesting, cleanup, callback references, Promise identity,
mixed scalar/Promise completions, and ownership/collection-erasure controls. The
Go focused group passes, including runtime revocation/forgery controls and denied
host imports. The subsequent isolated serial implementation gate passed Node,
Bun, Go, and the full CLI differential. No conformance marker was relaxed or
changed. That release attempt then failed packaging: the README linked to
repository files that are not shipped. It is not a completed release certificate.

The first isolated release attempt at this checkpoint stopped in Node: 240 of
241 tests passed, and the remaining test found two foreign-call corpus diagnostic
regressions. A checker-type Promise choice had incorrectly taken precedence over
the foreign boundary's lifted Result. Restoring semantic-channel precedence on
both backends fixes that regression without changing either fixture. The full
121-case foreign-call area then passes on JS, with Go matching 111 and retaining
its ten declared expected failures; there are no new divergences or fail-open
markers. That stopped release attempt did not run the Bun/Go/package stages and
is not a release certificate.

The README's source-only links now point to the repository, with a fast check
against npm's actual archive inventory and unit cases for link resolution. A
focused package-content diagnostic (not a replacement release gate) then found
an installed-consumer assertion still expecting sorted comptime object keys.
That fixture now asserts authored key order and JSON serialization both before
and after emitted-code execution, matching the review's object-order correction.
Package-consumer verification and the next complete release gate are pending.

This is an eager-runtime correctness checkpoint, not completed shared-runtime or
Go request-ABI linking. The Go prelude now needs the same Node-compatible async
host modules as the reference bridge; browser/edge runtime linking remains an
explicit implementation obligation. Cleanup-completion precedence is still an
unresolved user decision, and alpha-0 is not certified.

### Go declaration reader checkpoint (2026-09-05)

The Go callable-row reader no longer accepts only a loose version-1 JSON tag or
turns every declared capability into an ambient string. It reads the same strict
version-2 module/callable envelopes as the reference, including inline returned
function types and methods, and resolves requirement-table entries to the
actual Context constructors. Published classes participate in nominal row-name
qualification, so a same-spelled local class cannot discharge a library row.
Known published eager callbacks use their declared contract at higher-order
boundaries; unknown calling conventions and malformed metadata are source
diagnostics, never permission to emit a guessed call. Source code cannot mint
these tags or import the private declaration-type bridge.

The initial 19 source-free reader cases all failed before implementation. The
expanded 35-case Go group passes, including constructors/accessors, duplicate or
missing module headers, forged source claims, a wrong-typed ambient table entry,
and runtime incompatibility controls. These are reader/compile tests against
declaration fixtures, not tests of a completed Go publisher. The broader callable
regression group passes (100.7 s), as does the final trust/accessor group (19.2 s).
The reference declaration suites pass 33 tests (103 assertions). A fresh complete
corpus run records JS 553 passing plus one expected failure and Go 527 matching
plus 27 expected failures; both interop drivers pass six cases. No unexpected
failure, divergence, unmeasured case, or fail-open marker occurred. The corpus
and its expected-failure markers are unchanged.

Runtime ABI linking is an independent completion obligation: the standalone Go
prelude and reference runtime still use different Result brands and capability
environments. A valid JSON calling convention does not make those compatible.
The Go reader accepts declarations linked to its own prelude and refuses
unlinked runtime or resumable contracts with VIBE1810. Completing Go declaration
emission, the shared-runtime linker, and actual producer-to-consumer execution
remains required; this checkpoint does not redefine the goal around the narrower
reader or settle cleanup precedence.

### Latest gate follow-up (2026-09-05)

The isolated release snapshot including the editor/CLI durable-stage regression
and stricter conformance gates passed its full Node and Bun stages. Its Go stage
was deliberately interrupted when a concurrent lane's completed Go report
identified stale fixtures in that same snapshot. There is no completed release
certificate for this checkpoint; interruption is not a passing Go/package run.

The callback/ownership fixes preserve the strengthened rules. Positive callback
and coercion fixtures now preserve capability rows with `typeof`; the old empty-
row `satisfies` claim and incompatible mutable callback assignments are explicit
negative coverage. Result fixtures observe retained values before a later await
or arbitrary indexed propagation can exit. No checker rule or expected-failure
marker was relaxed. The focused Go callback/ownership group passes (24.1 s);
the expanded 56-case shared callable matrix passes all its newly added Go cases,
and its complete JS suite passes 57 tests (92 assertions). An already-running
external Go gate predates the last index-fixture correction and is not evidence
against or certification of that corrected fixture.

`CONTRIBUTING.md` now names the actual serial pre-merge entry point and explains
that it already runs the runtime suite and both conformance backends. It no
longer prescribes repeated full suites or falsely says `npm test` omits Bun.

The review's cleanup-completion decision remains unresolved: whether explicit
`finally` returns and recoverable failures replace an already-propagating
recoverable failure, while a pending panic remains protected. The saved probes
still expose that discrepancy. This checkpoint does not settle that rule, close
the remaining declaration/delivery gaps, or establish alpha-0 completion.

### Review-driven correctness work (2026-09-05, live tree)

The external review reproducers are inputs to this implementation goal, not a
replacement for completing alpha-0. They exposed accepted-program failures that
the previously green suites did not cover. Do not call the remainder only wiring.

- Flow extraction now preserves executable module initialization in source
  order (mutations, aliases, helper calls, unused initializers, loops, static
  field initializers), instead of assuming symbol reachability captures state.
  Each tested case executes and replays its authored result; unsupported static
  blocks retain their diagnostic. Broader runtime closure capture remains open.
- BodyExecutor now accepts the same optional defect stack that workers persist,
  adopts every terminal winner on cancellation/fence loss, and exposes the
  committed cancellation reason consistently on attachment. Four new tests
  reproduced the previous failures before the changes; the focused body/module/
  deployment suites passed 43 tests afterward.
- Replay cancellation is checked before claims, queued worker dispatch and
  commits. Lease-maintenance storage errors now raise a nonterminal
  CoordinatorUnavailable, leaving the execution resumable. Late abandoned
  workers cannot commit defects or schedule retries under their old fence.
  Four new tests reproduced the previous cancellation/heartbeat failures before
  the fix; seven focused race tests pass afterward. The combined body/replay/
  source/Manifest/runtime-boundary/agent group passes 194 tests (1,201 assertions).
- A generator-returning dependency callee now has an eager driver at ordinary
  call edges, including discarded calls inside async functions, methods,
  accessors and native callbacks. Six executed shape regressions pass. This is
  not completion of function-value row subtyping or the declaration ABI.
- Nested executable Flow bindings now receive structured source diagnostics
  across body, Flow and Manifest APIs, without falling back to a legacy Plan.
- Runtime-issued request occurrences now remain authoritative when inner
  handlers answer some requests locally. The replay driver shares the body's
  dispatch scope, accepts genuine gaps and refuses forged or repeated indices.
  Sync/async Result delimiters also deliver a raised answer back into suspended
  cleanup. The focused runtime-delimiter/replay group passes 39 tests. This
  forwarding fix does not decide cleanup-completion precedence.
- Host-zone Date construction, parsing and local setters now require Clock;
  provably absolute inputs and UTC operations remain available. A shared matrix
  has 26 passing cases on each backend, including positive execution under UTC,
  Los Angeles and Kathmandu. The JS matrix additionally checks executable-Flow
  refusal. The spec's incorrect setter exemption is corrected against its
  existing locked implicit-host-input criterion.
- Callable requirement assignment now uses one structural type relation per
  backend, including fields, arrays/tuples, aliases, arguments, returns, casts,
  generics, higher-order parameter variance and class overrides. Inferred
  conditional alternatives retain both requirements before TS coalesces their
  ordinary signatures. The shared 47-case assignment matrix passes on JS and
  Go (zero skips); JS also checks typed-call row propagation. The combined JS
  assignment/core-language run passes 81 tests. The relation has a structured
  bounded-expansion refusal, not an unchecked recursive compiler call. This is
  not yet full declaration/calling-convention ABI certification or complete
  opaque-value/container variance coverage.
- An evaluation-order ownership CFG on both backends now checks binding/Result-parameter
  obligations on every exit, follows actually invoked local callbacks, and
  routes return/throw/propagation/break/continue through finally. It distinguishes
  a fresh value selected by a conditional from selecting only one of two
  previously owned values. Literal and statically returned collections track
  their separate members. Promise joining and fulfillment creation are distinct
  events: a rejected await cannot create a Result obligation, and consuming only
  one possible fulfillment path does not discharge the others. Native Promise
  executors run immediately, but nested uninvoked closures remain inert. The
  shared 61-case matrix passes on JS and Go (zero skips); all six external
  row/lifetime probes refuse with source diagnostics on JS. Remaining ownership
  work includes module-scope/general value-flow precision and implicit disposal.
- Callable return contracts cannot erase an owned Result or Promise through
  TS's special `() => void` assignability, `unknown`/`any` return widening,
  containers, higher-order variance or class overrides. A shared 32-case matrix
  passes on both backends, including Promise fulfillment Results and genuine
  joining Result observers. Trusted foreign calls do not waive this rule;
  consumers that preserve and inspect the return channel remain accepted.
- Comptime program values no longer use sorted metadata encoding: JSON parsing,
  stringification, emitted object literals, sandbox arguments/results, and cold/
  warm cache returns retain observable property order. Value/argument JSON bytes
  participate in cache identities and tampering checks; cache versions are
  bumped. Twelve shared compile/runtime equivalence cases pass on JS and Go,
  with JS cache-integrity/sandbox/validation tests too. The broader JS ownership,
  core-language, and build group passes 219 tests. This is not full comptime or
  asset-loader certification (e.g. reified object allocation identity remains a
  separate concern).
- The JS declaration boundary now records an explicit calling convention in a
  strict version-2 module/callable envelope. Public functions stay eager when
  exported aliases are added. A type-only requirement table links rows to the
  actual nominal constructors, including private module capabilities and calls
  forwarded by a package that did not import the constructor. Source-free
  consumer tests read only emitted JS/declarations, execute ten callable shapes,
  reject a same-spelled impostor capability, and preserve conditional closure
  alternatives and anonymous default factories. Eight ABI cases and 25 strict
  metadata cases pass; the surrounding declaration/project/generic/lowering
  group passes 55 tests. Version 1 remains inspectable but is refused by the
  consuming frontend with VIBE1810 rather than silently losing its row.
  This is a JS checkpoint, not cross-backend package certification: Go still
  needs the versioned declaration reader/emitter and compatible runtime linking.
  Unnameable dynamic requirements and full opaque/container serialization also
  need completion. Declaration metadata is a static contract, not code signing
  or runtime attestation.
- Pending: cleanup completion precedence (user decision requested), remaining
  callable/declaration ABI work, path-sensitive must-use obligations, comptime
  remaining delivery work and final gates.

Ownership/conformance follow-up: a fresh Node run passed 231 tests and failed
the reference corpus test on 14 cases (not a source-map failure). Nine positive
fixtures now explicitly observe retained Results before a later exit point;
their API/output promises remain unchanged, and negative counterparts live in
the shared ownership matrix. The two comptime object stdout contracts now follow
authored insertion order. Invalid bang operands forward their ownership through
the rejected expression instead of creating duplicate producer diagnostics; three
exact-cascade vectors pin both forwarding and unconsumed stringification. The
matrix now has 72 cases. Three more exact-cascade vectors pin the old/new
ownership checks reporting one obligation rather than duplicating it. A full
shared-backend remeasurement is underway; the
historical counts below do not certify this tree.

The pre-rename Node gate passed 232/232, including JS conformance 553/554 plus one
declared expected failure, Go conformance 527/554 plus 27 declared expected
failures, and 6/6 interop on each backend. The Bun gate exposed a stale eager
driver export allowlist and a second, now-explicit gap in the already-refused
`duration.vibe` port: a foreign runtime Result type is not yet recognized as the
checker-owned Result contract. The latter is recorded as an implementation gap,
not waived as an owned callback or portrayed as a completed library port.

The same Bun run exposed recursive generic collection relations exhausting the
bounded callable check: freshly instantiated method type parameters prevented
cycle detection. Both backends now key active comparisons by recursive reference
target/arguments and declaration-bound type parameter constraints, while keeping
concrete callable identities and the existing expansion budget. Six shared
positive/negative controls extend the assignment matrix from 47 to 53 cases.
The JS row/completion/data group passes 89 tests (347 assertions), including the
unchanged collection ports; the six new Go cases and three ownership deduplication
cases pass. A separate platform/runtime focus passes nine tests (25 assertions),
and the production TypeScript configuration checks cleanly.

A concurrent repository-wide rename to VibeLang interrupted release verification.
Preserve that work. The first renamed run was not green: old environment-variable
usage skipped the Go cases, virtual durable filenames leaked `.vibe` into stock
tsc, the honest-gate fixture still searched for `smith`, two payload expectations
retained old content, and the retired-import case now named the current virtual
module. The implementation/fixture corrections have focused controls; the full
release gate is being rerun against a fresh offline pinned fork checkout. Neither
the pre-rename counts nor this partial run are current-tree certification.

Fresh serial measurement after these fixes: the complete JS language suite
passes **1,481 tests, zero failures** (46 files, 5,461 assertions, 231.93 seconds).
The production TypeScript emit configuration also checks cleanly. This is a
language checkpoint, not a claim that durable/delivery/root gates are complete.

Reviewed reports: `reviews/2026-09-05/REVIEW.md` and the read-only fan-out handoff.
The editor now invokes the same `compileDurableModule` stage as the CLI, after
comptime and before row analysis/generated-TypeScript validation. Rows use the
materialized text, while hover/definition retain authored declaration ranges.
Stage and row diagnostics compose maps back to the open buffer through the
compiler's shared source-map decoder. Three new tests reproduced bogus TS2307/
TS2339 diagnostics before the change; the complete editor/source-map group now
passes 37 tests (217 assertions), including a disk/buffer disagreement control.
A shipped editor/CLI comparison test additionally covers opening, invalidating
and repairing the same Flow buffer against disagreeing disk contents. All eight
shipped LSP tests pass from a clean isolated build. Its complete release
measurement remains pending.
The failures spec's error-extraction argument is corrected: public `match`
already exposes an `E`; bootstrapping primitive Result operations is separate.

An isolated release snapshot passed the full Node gate (239 tests, zero skips),
then reached 3,012 Bun passes, six failures and one named live-model skip. The
six failures concerned renamed identity boundary vectors, a predecessor-collision
test pair, and pinned Plan digests. Concurrent rename fixes now pass the focused
52-test identity/source-compiler group (556 assertions). That release run stopped before Go and package
verification; it is not an alpha-0 certificate.

The normal test chain now includes the full read-only CLI/oracle differential
after the Go gate. Gate-composition tests refuse a removed, filtered or updating
substitute. Root conformance also refuses stale JS markers, unmarked unsupported
cases and fail-open markers on both backends; Go's ordinary-TypeScript interop
failures are enforced rather than merely printed. These are additional gates,
not new expected-failure exemptions.

The post-rename full CLI differential measured 554 cases, 21 divergences and zero
product-only accepts. It verified 53 baseline retirements: 38 durable rows and
15 retired-syntax rows. One new missing-cascade discrepancy was then fixed by
leaving TS-parseable retired types to the full checker. The new CLI test checks
every retired-syntax refusal, including the complete function-channel cascade.
The 53 measured fixed baseline rows are removed. A fresh full 554-case CLI
measurement matches the remaining 20 rows exactly (two product refusals, 18
diagnostic differences, zero product-only accepts). The source-asset preflight and checker now share
one syntax diagnostic implementation when parsing prevents asset discovery;
ordinary TypeScript still reports its own parser diagnostics. The focused
asset/retired-syntax group passes 47 tests, and the follow-up source-syntax and
CLI/docs checks pass. Three documented complete programs are compiled by the
new documentation gate, including a checked Action/loop/Flow example.

Post-rename independent checks also passed the docs production build and the
four-stage public durable demo, including real SIGKILL after one commit and
fresh-process resume to 100 without repeating that Action. All 23 saved review
probes were remeasured: discarded calls execute, row/ownership/Date cases refuse,
captured state returns 2, nested durable declarations report VIBE4103, comptime
matches runtime object/JSON order, and public error extraction succeeds.
The three finally-completion probes still expose the pending semantic decision;
unchecked Result indexing still has its separately documented panic behavior.
Neither is silently claimed fixed by those measurements.

Initial worktree: clean. Node v22.4.1, Bun 1.2.20, Go 1.24.6. `npm test` started
before source changes; its Go gate resolves and verifies the pinned fork.

Initial run: Node gate passed; runtime gate reported 2,651 passed, one allowed
live-model skip, and one failing SystemClock host-clock test. The npm chain
therefore did not reach its Go gate. Source edits began while the runtime run was
active, so this is an initial measurement, not a certified pristine baseline.

Meaningful behavioral tests accompany semantic changes. Refusal fixtures are
retired only when their specified positive behavior is implemented and executed.
Unknown/forged values, panic distinction, lost Promise/Result obligations, and
backend divergence remain negative coverage. No result is declared complete
merely because a partial suite passes.

Focused verification: new Result API/runtime tests pass, including iterator
failure after async submissions. Delimiter tests cover nested failure frames,
awaited disposal, unhandled-request disposal, ordinary/async completion,
short-circuit and repeated-loop evaluation, and lexical receivers. The original
clock failure was a live-clock test assuming two consecutive samples were equal;
the revised contract test verifies finite independent dates and monotonic time.
The language/source-map/declaration group passes 52 tests; focused Result and
effect lowering/runtime groups pass. The 02 propagation corpus passes
27/27 on both backends, with no unsupported case. Claude independently flipped the retired refusal fixtures as
the new lowering became available; its fixture and coverage edits are preserved.

Broad runtime gate after the first changes: 2,653 passed, one allowed live-model
skip, 37 failed. Snapshot updates, the LSP contextual-return regression, and
worker-bundle runtime imports have since been fixed and focused groups passed;
the full gate still needs rerunning. The full Go gate ran 1,635 tests with eight
failures; the two obsolete repeated-loop-header refusals and one typed-callback
diagnostic column are corrected, and another complete run is in progress.
The external durable fixtures now have deliberate entries in the Manifest/Plan
cross-check table (54 tests pass); historical Plan refusals are not the language
contract for executable bodies. The user-requested SA-1 documentation correction
is made in failures.mdx and specification/index.mdx.

Current gate work (2026-09-05): all five failures from the latest 1,638-test Go
run are fixed in focused tests; the Durable/Result-delimiter group passes after
cross-backend verification of the new structural native-Error codec snapshots.
The latest full Node measurement was 224/230 with six failures. The generated
schema import regression and source-site-sensitive formatter comparison are
fixed; fork e2e fixtures now implement the emitted delimiter ABI and are being
rerun. The remaining corpus mismatches must be reviewed individually before
retiring expectations: ordinary locals/captures/helpers/projections now execute,
but non-finite boundary literals and Action schema arguments still must refuse.
The full runtime and Go gates still need a fresh measurement after these changes.

Latest follow-up: full runtime gate 2,730 passed, zero failed, one named
live-model skip (146 files). Three subsequently added body/ownership regressions
also pass focused. The full Go gate ran 1,638: 1,637 passed, one Manifest failure
because native Error was omitted from its failure set. That omission is fixed,
the exact cross-check passes, and a fresh full Go run is underway. The Node gate
reached 230/231; its only failure was the corpus's obsolete non-Result-message
substring, now corrected to VIBE1207's Result-provenance sentence. A fresh
full Node run is underway.

Reviewed corpus remeasurement: JS 553/554, one expected failure; Go 527/554,
27 expected failures; zero xpass/unsupported/divergent/unmeasured, zero fail-open
markers. The five newly exposed Go markers are historical Plan restrictions
reclassified against actual ordinary-Flow semantics, not new runtime regressions.
The explicit-Result and schema JS markers are retired after executed proof; the
Go fallible-generator fixture already passes. Harness selftest 50/50. Product
differential regenerated: 73/554 divergent, no product-accepts; 14 changed durable
rows reviewed as product-wrong because CLI check/compile lacks the body stage.

The Node-safe public body compiler now resolves its runtime from import.meta.url
and supports both source .ts and packaged .js/.d.ts, tested through vibelang/durable.
Private durable callbacks handed to native consumers are now refused rather than
silently dropping yielded Actions (Array.map(...).length was a concrete fail-open).
The guard permits checked Layer callbacks and direct function aliases. General
callback resumption still needs implementation; an unresolved function parameter
can be rejected earlier by Manifest derivation.

CLI/deployment integration follow-up (2026-09-05): the new shared module stage
erases compiler-only imports and checked Action declarations, extracts private
function helpers (including const function literals and overload declarations),
and preserves exported/shorthand-referenced helpers and untouched source tokens.
Descriptor materialization preserves own `__proto__` data. Invalid source
provenance cannot fall back to a legacy Plan. Ordinary boundary diagnostics keep
their existing ownership and authored locations. The normal signed coordinator
accepts only verifier-issued proofs; selecting the body path never reads fields
from an unissued proof and never repairs a tampered body by selecting its Plan.

Completed measurements: Node 231/231 and runtime 2,730/2,730 plus one allowed
live-model skip before this module/API integration; fresh Go gate 1,638/1,638,
zero skips, after the native-Error Manifest fix. The CLI consumer group passes
4/4 including the combined comptime/async-Flow test. Focused module/body/deployment
group passes 34 tests before one subsequently added overload regression. Filtered
product differential: all 41 durable cases agree, zero divergent. The full
product-divergence baseline still needs regeneration to remove the now-fixed
durable rows. These are completed intermediate measurements, not the final
serial certification on a settled tree.

Coordination: the user reported a separate chat had launched five agents.
Their task/file assignments have been requested. This agent owns Flow module/CLI
emission, source provenance, and deployment/signature/coordinator integration;
no additional agents have been launched from this thread.
