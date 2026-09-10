# Durable plan interoperability worklist

<!-- brand-gate: allow-start -->
The September 6 owner decision in [the decision ledger](../docs/DECISIONS.md)
adopts Smithers 1.0 plans and reverses the ordinary-body replay model for the
durable product. The existing body implementation remains regression coverage;
its crash/restart demo is not evidence of Smithers interoperability. The native
compiler migration and this durable-model migration are separate work.

## Reviewed reference

On September 7, the upstream reference was read at
[`smithersai/smithers`, `6bcbaa2d03a10afe8fe59934dabe262f55f012e7`](https://github.com/smithersai/smithers/tree/6bcbaa2d03a10afe8fe59934dabe262f55f012e7).
Its package version is `1.0.0-rc.0`. Packages have moved under
`packages/smithers/flows/`; their published names remain `@smthrs/*`.
This exact revision is a comparison baseline, not an instruction to track an
unreviewed moving dependency in the product.

Read the flow/plan, content-addressing, durability and time-travel concept pages,
then the key, material, plan, journal and scheduler interfaces. Important seams:

- `canonical/src/internal/canonicalize.ts`: RFC 8785 JSON bytes, UTF-16 property
  ordering, ECMAScript number spelling and rejection of unpaired surrogates.
- `keys/src/Key.ts`: `key1_` plus SHA-256; validating a stored key never hashes it.
- `plan/src/KeyMaterial.ts` and `StepKey.ts`: material version
  `flows/key-material/v2`; tagged `Literal`, `Ref` and `Pending` inputs; distinct
  plan, dispatch, content and execution-environment identities.
- `plan/src/Plan.ts`: keyed graph, exact approval projection, append-only
  generations and reconstruction-based verification of imported plans.
- `engine-store/src/PlanScheduler.ts`: `NodeExecutor` is the explicit execution
  seam. The scheduler owns admission, durable attempts, identity and caching;
  a language adapter supplies the meaning of each node. This avoids needing
  `Graph.build` to invoke a VibeLang Flow symbolically.
- `journal/src/JournalEvent.ts` and `engine/src/FlowEngine/Lineage.ts`: persisted
  event and lineage identities, separate from plan or dispatch keys.
- `control/src/ControlSchema.ts`: an approval submits the complete target,
  digest, authority envelope, scope and idempotency identity.

There are two different digest layers. The persisted `Plan.digest` is a
`key1_` commitment to the keyed graph's approval projection. Control's
`ApprovalTarget.digest` is instead a plain lowercase SHA-256 of canonical
`{ flowId, input, envelope, deployClass, executionDigest?, persistedPlan }`,
where `persistedPlan` is the graph digest (or null). An absent execution digest
is omitted, not replaced with null. Passing the bare graph digest as a Control
approval would omit the invocation, deployment and authority envelope. Envelope
comparison uses canonical JSON equality, preserving array order. Principal
attribution is not authorization: approval policy must validate the exact
principal, target and scope inside the durable write transaction.

## First measured comparison baseline

An isolated host executed the unmodified upstream source with its pinned
Effect `4.0.0-rc.112` dependency and real SHA-256. The cryptography provider
throws if planning requests randomness. This was a small contract measurement,
not the upstream suite and not a product test. It adds no product dependency.

The final run exits zero with empty stderr. It records seven canonical/key
vectors and twelve verified plans, including input-reference variants,
dependency ordering, independent nodes, tiers and nondeterminism. Controls prove:

- Renaming a structural address or changing priority leaves a node key intact
  but changes the approval digest.
- `Pending`, whole-result `Ref` and projected `Ref` remain different identities.
- Literal data resembling a digest reference remains literal data.
- An appended generation preserves the earlier node and `baseDigest` exactly,
  advances the current digest, and passes upstream `Plan.verify` after JSON
  round-trip.
- Duplicate nodes, missing dependencies and cycles refuse; an altered priority
  with the original approval digest also refuses.
- Irreversible material can have a plan key, but requesting a reusable content
  key from it refuses with `non_content_material`.

Evidence is under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`smithers-contract-oracle-fifth.json` and its empty `.err` file. The measurement
program and isolated dependency lockfile are in
`/tmp/vibelang-smithers-oracle.rhNpW3/`; the source checkout is
`/tmp/vibelang-smithers-contract.PCGrlE/`. Initial resolver attempts are retained
separately: two emitted a Bun tsconfig-path warning and two could not resolve a
package. None is counted as the clean measurement.

## Native keyed Plan boundary — implemented, API 38

`KeyedPlanCompiler.KeyedPlan` in Go and `NativeCompiler.keyedPlan` in the SDK
expose the same native data endpoint. An explicit operation selects `compile`,
`verify`, `append` or generic `derive-key`; the payload is `inputJson` so duplicate
object fields can be refused before a host JSON parser loses them. There is no
source execution, deployment loading, approval, scheduler or cache lookup here.

- `compile` takes `{ planId, flow, nodes }` with complete node drafts: explicit
  recovery tier, body, tagged inputs, layers, capabilities and declared effects.
- `verify` takes an imported Plan and reconstructs its keys, edges, conflict
  annotations, approval digests and generation history. Schema-excess fields
  are discarded; a caller's `approved: true` is not execution authority.
- `append` takes `{ plan, nodes }`, verifies the existing Plan first, and
  preserves earlier rows and the base digest while extending the graph.
- `derive-key` hashes arbitrary supported JSON in the `key1_` namespace. It is
  deliberately not named a dispatch key or reusable content identity.

Successful data results contain `planJson` or `key`, never both. Refusals clear
both fields. Go owns all graph, effect, key and verification logic; the SDK
only transports bounded data and checks the native response envelope. This is
separate from API 36's older unkeyed source-Plan query.

The native implementation matches 141 measurements of the pinned upstream
source: 107 accepted cases and 34 refusals. Every accepted native-produced Plan
also passes upstream `Plan.verify`, with full structural equality. Cases cover
canonical number/Unicode spelling, NFC set normalization, all input tags and
tiers, prototype-like addresses, effect projection, filesystem overlap,
reader ordering, and append-only generations. The first comparison caught
missing required body/Literal fields and a Unicode glob terminator mismatch;
those failures were corrected, not recorded as expected exceptions. A subsequent
probe found that Go's stock NFC helper inserts CGJ in long combining sequences.
The native adapter now preserves ECMAScript NFC without inserting or deleting
characters; 52 additional vectors cover stream-safety boundaries, ordering,
composition exclusions, Hangul, explicit CGJ, and distinct/alias file paths.
Snapshot 62's release run was cancelled at the Go gate to fix this finding; it
is not a green release certificate. Node and Bun had finished before cancellation.

Fixtures and their input generators are checked in under
`compiler/testdata/keyed-plan-*`. The repeatable read-only measurement is:

```sh
bun scripts/keyed-plan-oracle.mjs \
  --reference /path/to/reviewed/reference-checkout \
  --effect-root /path/to/isolated/node_modules/effect \
  --native /path/to/prepared/vibelang-native \
  --check compiler/testdata/keyed-plan-oracle.json
```

The script requires the exact reference revision and Effect version above;
those dependencies are isolated test infrastructure, not product dependencies.
Native and SDK tests consume the checked-in measurements without downloading
or invoking the reference. Separate hostile-artifact tests alter keys, material,
effects, ordering, priorities, conflicts and generation boundaries, then exercise
both verify and append. A 10,000-node chain compiles and round-trips; an oversized
graph and a dense conflict expansion refuse without an artifact.

Transport limits are explicit: 10,000 nodes, 16 MiB inner JSON/artifact, depth
256 and one million visited JSON values. An additional 16 MiB expansion budget
charges conflict annotations and inferred edges before allocating a dense
matrix. These resource refusals are transport restrictions, not additional
language or upstream effect semantics. All successful outputs must fit the
input verifier's own budgets. Ill-formed Unicode, non-finite JSON numbers,
duplicate fields and trailing JSON refuse; RFC 8785 normalizes negative zero.

The adaptation retains the upstream MIT notice in `THIRD_PARTY_NOTICES.md`,
included in the package inventory.

### Full release checkpoint — September 7, snapshot 63

The corrected API 38 implementation passes `release:verify` serially, from
`2026-09-07T22:43:39.811Z` to `2026-09-07T23:02:00.559Z`, exit 0.
Snapshot `/tmp/vibelang-alpha0-release.thvQrl` contains 2,250 inputs with manifest
SHA-256 `6ede32182325c78149425275a8bd556bfaa69291525843682deee95931891f54`.
After completion, every live input still matched that snapshot; no files had
been added. This measurement note is a subsequent documentation-only update.

- Node: 329 passed, no skips or todos.
- Bun: 4,516 passed, 30,025 assertions, 223 files; the one existing credentialed
  live-model test is explicitly skipped. No unexpected failure.
- Go: 4,297 tests/subtests passed, no skips; compiler package 373.101 seconds.
- Corpus: SDK 553 pass / 1 expected failure; standalone Go 540 match / 14 expected
  failures, both over 554 cases; six ordinary TypeScript interop cases pass in
  each profile. These are delivery profiles over the same Go engine.
- Product differential remains exactly the reviewed 20 rows: zero product-only
  accepts, two product refusals, eighteen differing diagnostic/code positions.
- Package: 538 files, 507 generated, 24 exports; installed Node/Bun consumers
  and reproducibility pass. Both consumers exercise the new keyed Plan API.
- Docs: 81 generated files; the existing experimental-glob and bundle-size
  advisories remain, so this is not a warning-free build claim.

Package archive SHA-256:
`dd39038a4f8776713d7e08862ae8b57db9b5bdbb7158e837db4fbe7906007949`.
Inventory SHA-256:
`24643bf747c8f4b7e2a9a5c02228f2cb2386bd60fe3ed3848e2164022e1e4978`.
Evidence: `/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-63.log`,
its `.result.json`, and `snapshot-63.json`.

The diagnostics-page generator also now refuses incomplete corpus evidence
before writing. Its missing-native negative control exits 1 and preserves the
original page byte for byte; the correctly configured full-corpus `--check`
passes. The new guard is covered by the release Node gate.

## Checked source profile — APIs 39–43

`KeyedSourceCompiler.CompileKeyedPlanSource` in Go and
`NativeCompiler.compileKeyedPlanSource` in the SDK now connect native source
checking to the keyed Plan compiler. This additive endpoint does not change the
existing durable default or invoke any source, provider, or reference library.

The request supplies `source`, a canonical relative `.vibe` `fileName`, `flowId`
(empty selects the declaration-derived identity), positive `flowVersion`, an
explicit `planId`, `inputJson`, and `providersJson`. JSON strings are deliberate:
duplicates and malformed Unicode must be rejected before a host loses them.
API 42 also accepts explicit `dependencies: [{fileName, source}]` containing
actual `.vibe` declaration modules, as detailed below.
Successful results contain `ok: true`, `planJson`, and empty `diagnostics`;
refusals carry diagnostics and an empty Plan string. There is no body fallback.

The current profile selects one module-level `const Flow = durable(body)` with a
single input, straight-line const bindings, local or imported abstract Action declarations,
direct `Action.run(...)!` propagation, static projections, literals, arrays,
objects and an explicit return. API 43 also expands a statically known keyed
`fanOut` collection into ordinary Action nodes, as detailed below. API 44 adds
checked source child-Flow composition and explicit entry-export selection. Direct
`sequential` calls retain ordering edges across Actions and source child Flows.
Independent Action bindings acquire no ordering edge from `!`. A compiler-owned
result node waits for all declared work, including Actions not used by the final
expression. General control-flow nodes, helper calls, opaque child artifacts,
capability resolution and appended rounds still need their keyed-source adapters;
unsupported source or node kinds refuse instead of being silently dropped.

Both the normal language checking pipeline and a complete native value-view
type-check precede publication. The second check prevents erased Flow bodies from
hiding ordinary type errors. The integration caught and fixed a shared native
lookup that treated a propagated success alias as its upstream Result wrapper;
the serialized Action input contract remains independently checked.

Each reachable Action needs exactly one explicit provider declaration:
`{ actionId, implementationId, implementationDigest, tier, effects, layers,
capabilities }`. `implementationDigest` is a lowercase SHA-256 commitment to
provider code, **not** a compiler-derived proof that those bytes have been
supplied or checked. Tiers must be explicitly `sealed`, `compensable`, or
`irreversible`; effects use the reviewed hard/expected boundary schema. Missing,
extra, duplicate or malformed provider declarations refuse. No tier or empty
effect set is inferred from an abstract Action. Execution must still authenticate
and match the actual provider code and enforce its declarations.

The Plan material binds the native-derived Action contracts, provider code
commitments, effects, tiers, consumed input values, source bytes and compiler
identity. Its current node bodies use the data-only `vibelang/keyed-source/v2` interpreter
ABI: primitive input slots, ordered object entries and arrays. This is an emitted
interpreter program, not emitted JavaScript. The data interpreter below implements
this ABI; authenticated dispatch and scheduler integration are still owed.
Authored and input-JSON object construction order is retained explicitly.
Durable input rejects negative zero; generic RFC 8785 key derivation still
normalizes it, but that normalization cannot silently change a consumed value.
Captures, module-level execution, Action implementation overrides, class static
initializers/computed names and prototype-setting object literals refuse.

The aggregate source budget is 2 MiB, with at most 256 explicit dependencies;
the graph includes at most 10,000 nodes including its
result, with a shared 100,000-expression expansion budget, depth 128, and the
keyed Plan endpoint's encoded-byte limits. These are explicit profile/resource
restrictions, not evidence that every durable language construct is implemented.

The upstream comparison script's optional `--source` flag additionally checks
native source-produced Plans and changed-priority refusals against the actual
upstream verifier. It requires `--native` and does not change the 141-record data
fixture baseline. Installed Node/Bun package smoke tests exercise source
compilation, independent readiness, reconstruction and missing-provider refusal.

### Full release checkpoint — September 7 local time, snapshot 65

The API 39 implementation passes the complete serial `release:verify`, from
`2026-09-08T00:01:04.470Z` to `2026-09-08T00:19:29.861Z`, exit 0.
Snapshot `/tmp/vibelang-alpha0-release.Hdepkh` contains 2,256 inputs, manifest
SHA-256 `8cf3b616b4a50b65bdc29ba57241de0389a361e2c6a389863b5e51ed38ce8066`.
After completion, every live input matched its digest and mode; no input files
had been added. This measurement entry is a subsequent documentation-only change.

- Node: 329 passed, no skips or todos.
- Bun: 4,554 passed, 30,141 assertions across 225 files; the existing credentialed
  live-model test is explicitly skipped. No unexpected failure.
- Go: 4,361 tests/subtests passed, no skips; compiler package 376.396 seconds.
- Corpus: SDK 553 pass / 1 expected failure; standalone Go 540 match / 14 expected
  failures, over 554 cases; six ordinary TypeScript interop cases pass in each
  delivery profile. Both profiles use the same Go engine.
- Product differential: exactly the reviewed 20 rows, with zero product-only
  accepts, two product refusals and eighteen diagnostic/code-position differences.
- Package: 538 files, 507 generated, 24 exports. Installed Node/Bun consumers and
  reproducibility pass, including the new source-to-keyed-Plan public API.
- Docs: 81 generated files; existing experimental-glob and bundle-size advisories
  remain. This is not a warning-free build claim.

Package archive SHA-256:
`6176d886066c8187c7e01065f754f2f503983e030b40d4e6e9786b5b71d77015`.
Inventory SHA-256:
`b71c7a078c1d49b6f720468368c3aefa771d9dba78aaf1d7e65948ea5c797903`.
Evidence: `/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-65.log`,
its `.result.json`, and `snapshot-65.json`.

The separate upstream measurement verifies all 141 data vectors and six
native-source-produced Plans, including changed-priority refusal controls;
`keyed-source-oracle-release.json` records that run with empty stderr. Snapshot
64 failed at type-checking a new protocol test fixture and did not reach the
gates. Its literal-type annotation and an independently found static-method AST
accessor panic were fixed before snapshot 65; neither failure is counted as green.
This checkpoint certifies the stated source profile, not scheduler execution or
alpha-0 completion.

## Ordered value interpreter — implemented, API 40

`KeyedSourceInterpreter` is exposed from the platform-neutral durable entry and
the Bun entry. Its constructor asks the authenticated Go compiler to reconstruct
the imported Plan, then validates every node's exact interpreter ABI, expression,
slot use, structural Action contract and source/provider declarations. It accepts
the current generation-zero source profile only; unknown operations, old value
ABIs, inconsistent declarations and appended rounds refuse before any provider
can be loaded. A verified graph is **not** a signed source attestation, approval
or permission to execute. These APIs grant none of those.

`prepare(nodeId, resolvedInputs)` follows the scheduler's `NodeExecutor` seam:
the input list contains each projected `Ref` in material order, including
duplicates, but never a Literal or Pending dependency. It validates identities,
paths, counts and repeated-reference consistency. Actions produce a fresh,
structurally checked ordinary input plus the Plan's claimed contract/code
commitments. Result nodes produce an encoded value. `encodeSuccess` and
`encodeFailure` check output schemas; failure data must carry its exact nominal
Error identity. None of these methods runs a provider, decides readiness,
commits an outcome, or folds a defect/cancellation into a recoverable failure.

The upstream cache intentionally canonicalizes JSON objects, which changes
ordinary JavaScript key order. The adapter therefore stores scalars unchanged,
arrays as `{ kind: "array", items }`, and objects as
`{ kind: "object", items, order }`. Ordered names are data in `order`; `items`
holds recursively encoded children. Both container kinds project through
`items`, so Go translates each authored Ref segment to `["items", segment]`.
The new `keyed-source/v2` body identity commits to that representation. Old v1
Plans must be recompiled; interpreting their plain-object paths as v2 is refused.
Decoded data has ordinary mutable Object/Array behavior, including safe own
`__proto__` fields. Different object orders cannot collapse into one cached value.

The encoded wire value, including metadata, is bounded to 4 MiB, depth 128,
100,000 JSON values and 16 KiB property names, matching the reviewed cache
boundary. Oversized codec expansion, getters, proxies (including revoked ones),
functions, exotic/hidden data, cycles, sparse arrays, malformed Unicode and
noncanonical numbers refuse without invoking them. The resolved-input list has
the same aggregate transport budget. Existing legacy canonical codecs are not
silently changed.

Focused validation: 296 runtime/protocol tests across six files pass, with 1,136
assertions. The native keyed/source/durable group passes 576 tests/subtests
(51.616 seconds); the build, native-toolchain type-checks and 15 Node documentation/
fixture checks pass. Logs are `keyed-runtime-bun-handoff.log` (and `.err`) and
`keyed-runtime-go-final.log` under the evidence directory below. The optional `--values`
flag on the comparison command requires `--source --native` and additionally
executes the actual upstream `CacheStore.encodeCanonical` and `StepKey.project`.
All 141 data vectors, six source Plans, five codec values and a native-source
reference/cache/result round-trip pass. Evidence is
`/tmp/smithers-alpha0-verification.Wa6A93/keyed-runtime-oracle-final.json`, its
empty `.err` and `.result.json`. The first run could not resolve the isolated
database package; that infrastructure failure is retained, not counted as green.
The isolated resolver now links that package's unchanged reviewed source. No
product dependency was added. This is not an on-disk run or scheduler test.

The five storage-codec measurements are checked in as
`compiler/testdata/keyed-value-oracle.json` and consumed by ordinary unit tests.
Pass `--check-values compiler/testdata/keyed-value-oracle.json` alongside
`--source --values` to compare that fixture against the reference afresh. The
unchanged 141-case data Plan baseline still uses its separate `--check` option.

An independent native transport repair also retains valid zero-length EOF
diagnostics as the query's one-unit caret. Previously the source refused but
the SDK reported a protocol error. Go and SDK regressions cover incomplete
declarations, blocks, comments and UTF-16 positions; ordinary compiler diagnostic
semantics are unchanged.

### Full release checkpoint — September 7 local time, snapshot 66

API 40 passes the complete serial `release:verify`, from
`2026-09-08T01:00:11.071Z` to `2026-09-08T01:18:39.128Z`, exit 0.
Snapshot `/tmp/vibelang-alpha0-release.3JQ3cZ` contains 2,261 inputs with manifest
SHA-256 `b563929534f7ef20c540ebfea512423aedf807064efa18175d4875e0e822509b`.
Every live input still matched its digest and mode after completion, with no
added input files. This measurement note is a subsequent documentation change.

- Node: 329 passed, no skips or todos.
- Bun: 4,641 passed, 30,416 assertions across 227 files; the one existing
  credentialed live-model test is explicitly skipped. No unexpected failure.
- Go: 4,367 tests/subtests passed, no skips; compiler package 377.255 seconds.
- Corpus: SDK 553 pass / 1 expected failure; standalone Go 540 match / 14 expected
  failures, over 554 cases, with six TypeScript interop cases in each profile.
  These remain delivery profiles over the same native engine.
- Product differential: exactly the reviewed 20 rows, zero product-only accepts,
  two product refusals and eighteen diagnostic/code-position differences.
- Package: 544 files, 513 generated, 24 exports. Installed Node/Bun consumers
  exercise the source compiler, ordered-value interpreter and refusal controls;
  clean-build reproducibility passes.
- Docs: 81 generated files, with the existing experimental-glob and bundle-size
  advisories. This is not a warning-free build claim.

Package archive SHA-256:
`f65a3742b9d537d277e9d1d4da4529961ae7a8c38afaaf0363af19a954237b35`.
Inventory SHA-256:
`fb322dcc3656024e405657ccdb6550bb5ba7899195d32e2dac02553351af5b8d`.
Evidence: `/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-66.log`,
its `.result.json` and `snapshot-66.json`. This verifies the implemented data
interpreter, not authenticated provider invocation or scheduler execution.

## Source-only provider bundles — API 41

`compileActionImplementationSourceContract` checks a complete explicit `.vibe`
closure without asking for a host callback. Go's `checkedFunction` query has an
opt-in `durableBoundary` profile: one required input, a non-generic/non-generator
signature, no overload/`this` parameter, exact structural input/success codecs,
and a `value` or native-`Promise` completion convention. Errors/capabilities still
come from the ordinary whole-project checker. A public fallible implementation
must still declare its Result contract. This first profile requires exact Action
codec equality; it does not claim general provider signature variance.

The exact issued contract retains the checked source and completion convention
privately. A serialized copy is not a compiler proof, and source-only issuance
does not grant callback authority. Legacy callback contracts keep their existing
row-inspection profile and cannot stand in for the new value-boundary proof.
The unchanged serialized contract format still commits to the Action and full
source project; it is not a signature or proof of a caller's callback code.

`buildWorkerPoolBundle` is also exposed from the Node-safe durable entry. Its
explicit `valueCodec: "vibelang/keyed-source/v2"` option requires that source-only
proof. The emitted bundle includes the shared data codec, completion convention
and keyed invocation entry, so its SHA-256 binds those bytes as well as the actual
provider code. Compilation/lowering/module conversion still use Go; source is
not executed while building. Complete module initialization is retained.

The optional sandbox configuration `runtimeValueInspection: true` supplies the
runner's native proxy predicate as a second entry argument and participates in
its configuration identity. The default one-argument ABI is unchanged. The
runner's only import is a Deno builtin, covered by the runtime binary pin; no
mutable module file or downloaded library is added to its closure. A keyed
bundle refuses to invoke without the inspector. Provider results are encoded
inside the worker: negative zero, malformed Unicode, proxies, accessors and
non-data values cannot become apparently valid answers through JSON repair.
Synchronous data is not blindly awaited; declared Promise completions are.
Nominal Error fields are read from data descriptors, including inherited and
non-enumerable built-in fields, without invoking getters or proxy chains.

The provider/value group passes 192 tests across seven files (550 assertions),
including a native source Plan → compiled provider → real zero-permission Deno
process → encoded Ref projection/result round-trip. It checks typed failure
encoding separately from defects. This is not a scheduler, approval, cache-store
or durable-commit test. Evidence: `keyed-worker-bun-second.log` and its `.err` and
`.result.json` under `/tmp/smithers-alpha0-verification.Wa6A93/`. The native
checked-function group also passes. The final focused reruns are
`keyed-provider-go-final.log` and `keyed-provider-bun-final.log`; the full release
measurement follows below.

Delivery review found that older bundle emission read runtime source files which
were absent from installed packages. The build now explicitly ships those
inputs, plus the keyed codec, in an isolated text-asset directory. They are
byte-checked by the package gate and cannot shadow `.d.ts` module resolution.
The installed consumer now builds a source-only keyed bundle, checks tampering
and value-contract refusal, and executes it in Deno. The focused package gate
passes on Node and Bun, with 556 files, 525 generated files and 24 exports;
two clean builds produce identical archives. Evidence:
`keyed-provider-package-first.log` and its `.result.json` in the verification
directory above (`2026-09-08T02:05:26.304Z` to `02:05:45.232Z`, exit 0).
This focused packaging measurement is not a full release-gate result.

### Full release checkpoint — September 7 local time, snapshot 67

API 41 passes the complete serial `release:verify`, from
`2026-09-08T02:17:42.788Z` to `2026-09-08T02:36:25.056Z`, exit 0.
Snapshot `/tmp/vibelang-alpha0-release.pzxagG` contains 2,265 inputs with manifest
SHA-256 `743adb3fa49171840194d1efddefbb790acc570416ee7d78e37c863d0d3fd6db`.
Every live input still matched its digest and mode after completion, with no
added input files. This certificate is a subsequent documentation change.

- Node: 329 passed, no skips or todos.
- Bun: 4,679 passed, 30,517 assertions across 229 files; the one existing
  credentialed live-model test is explicitly skipped. No unexpected failure.
- Go: 4,391 tests/subtests passed, no skips.
- Corpus: SDK 553 pass / 1 expected failure; standalone Go 540 match / 14 expected
  failures, over 554 cases, with six TypeScript interop cases in each profile.
  These are delivery profiles over the same Go compiler, not independent engines.
- Product differential: exactly the reviewed 20 rows, zero product-only accepts,
  two product refusals and eighteen diagnostic/code-position differences.
- Package: 556 files, 525 generated, 24 exports; installed Node/Bun consumers
  build source-only provider bundles from shipped assets and execute them in
  Deno. The clean-build reproducibility check passes.
- Docs: 81 generated files; the existing experimental-glob and bundle-size
  advisories remain. This is not a warning-free build claim.

Archive SHA-256:
`f8c0477fabbbb621476e5178685e067f44d571bfc95c72f728a51ece66b122d0`.
Inventory SHA-256:
`c8f1a7ff1395ce1c3932fa759b30a46a9a203fc5ca919a3be567f90490a85560`.
Evidence: `/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-67.log`,
its `.result.json` and `snapshot-67.json`. The current native executable reports
API 41, TypeScript `7.1.0-dev`, revision
`1f70213d4922b434345f639b441681e470c7cfc1`, and executable SHA-256
`a1c73976c0b648bc86ccb427877949717a770227fc5412156d61276564ca3011`.
The same 141 upstream data comparisons, six source Plans and six value controls
pass again in `keyed-provider-oracle-final.json`. This checkpoint does not claim
authenticated Plan scheduling or alpha completion.

### Isolated scheduler and Control probes

The unchanged reviewed upstream runs under an isolated Node 22.19.0 installation,
with its exact Effect/SQLite dependencies and the existing jj 0.40.0 binary.
No product dependency or compiler fallback was added. A native-produced fixture
Plan runs through real SQLite stores, filesystem/artifact boundaries and the
production step sandbox: two independent test executor bodies overlap, all three
nodes settle as built, and a second pass settles all three as clean without extra
executor calls. The executor answers are explicit test data, not language
provider execution. This is not crash/restart evidence.

A separate SQL Control probe refuses an unauthorized principal and an altered
target digest without installing any grant. Exact approval installs one
run-scoped grant; repeating its idempotency key does not duplicate it. A fresh
process reads the approved Plan and the grant from disk. Evidence in the same
verification directory: `keyed-scheduler-reference-first.json`,
`keyed-control-reference-fifth.json`, `keyed-control-reference-restart.json`, and
their stderr/exit records. SQLite's experimental-feature advisory is retained;
earlier setup/assertion failures are not counted as successful measurements.

One integration constraint is now explicit: Control assigns its Plan id during
planning. Sign the static source/provider/runtime deployment independently of
that id, then compile its authenticated source for each decoded input and the
Control-assigned id. Approval still binds the complete per-invocation target.
`lookupApproval` refuses resolved decisions; persisted Plan state is read through
`getPlan(...).decision` and `grants`. The adapter must use the actual transaction
boundary, not infer approval from a caller's boolean or a graph digest.

## Static source authentication and invocation approval targets — implemented

The additive `SignedKeyedSourceDeployment` API now builds and authenticates a
static source deployment, then uses Go to compile each invocation after Control
assigns its Plan id. The signed material covers source bytes, native compiler
identity (including executable bytes), exact emitted provider bundles and
contracts, the local Deno runtime identity/configuration and invocation driver.
The source-only bundle builder supplies private issuance evidence; a copied
bundle or caller-provided implementation digest cannot stand in for checked code.
Deployments are currently bound to the exact local native/runtime identities,
not advertised as portable across architectures or runtime installations.

Ed25519 envelopes use the distinct `vibelang.keyed-source-deployment.v1` signing
domain. Signature verification precedes native compiler queries; semantic and
byte-identity checks still run after a valid signature. Source authentication,
invocation compilation and runtime issuance have separate private proofs.
Clones, proxies, inherited lookalikes and persisted proof-shaped objects cannot
acquire any of them. No proof or data target implies approval, readiness or a
run lease, and this API does not expose an execution method.

Every invocation rechecks the supported native source profile and matches its
derived Action contracts to the signed provider contracts. Unsupported symbolic
forms refuse, with no executable-body fallback. This first deployment profile
requires explicit recovery tiers and empty hard effects, layers and capability
requirements: a filesystem/capability adapter has not been implemented.
`restoreAuthenticatedKeyedInvocation` reauthenticates separately, reconstructs
the saved invocation from signed source/input and compares the full verified
Plan; it does not promote a stored graph into authority.

`keyedInvocationApprovalTarget` emits Control's full data-only target. The
digest binds the complete input, deployment, graph, authority envelope and
deployment class. Tests prove that distinct unused inputs can produce the same
graph while requiring different approval digests. Envelope array order is
preserved. Original input JSON is retained for restoration; canonical display
text must not be substituted when object construction order is observable.

Focused validation passes 83 tests in five files, 399 assertions, including
legacy signed-body regressions and fresh-process source reauthentication.
Build/type checks pass. The installed Node/Bun package gate passes with 559
files, 528 generated files and 24 exports, including source bundle construction,
authentication, invocation restoration and approval-target exports. The initial
installed assertion compared null-prototype defensive records with ordinary
objects; it now compares JSON wire data, while keeping the exact digest check.
Evidence: `keyed-deployment-fifth.log`, `keyed-deployment-build-second.log` and
`keyed-deployment-package-third.log`, with their exit records, under
`/tmp/smithers-alpha0-verification.Wa6A93/`. These changes postdate snapshot 67;
their complete serial release measurement is snapshot 69 below.

Snapshot 68 was deliberately stopped during the Bun stage after its Node stage
passed: read-only review reproduced a leading UTF-8 BOM being silently stripped
from byte input, while text input correctly refused it. This was a canonical-byte
alias, not a way to change a signed payload. The shared canonical decoder now
preserves that prefix for JSON validation to refuse. Tests cover text/byte
parity, malformed UTF-8, BOM characters inside valid JSON strings and subarray
views, plus both legacy and keyed signature decoders. The corrected focused
group passes 94 tests in six files, 460 assertions (`keyed-deployment-bom-sixth.log`);
the original failing byte probe is retained as `keyed-source-bom-before.json`.
Snapshot 68's `.result.json` records SIGTERM, not a green certificate.
The original Node byte probe now passes (`keyed-source-bom-after.json`), as does
the corrected installed Node/Bun package check (`keyed-deployment-bom-package.log`,
559 files, 528 generated, 24 exports). Both installed consumers exercise the
noncanonical-byte refusal. Build/type and brand checks are also green.

The real SQL Control probe now composes these product APIs: compile/sign source,
authenticate, compile with the Control-assigned id, compare the exact target,
refuse an unauthorized actor and a bare graph digest, then approve exactly once.
A fresh process reauthenticates from stored signed bytes and public trust roots,
recompiles/restores the Plan from `StoredPlan.decodedInput`, and reads its approved
decision and single grant. Using the sorted `inputSummary` instead of the stored
input correctly refuses for an order-sensitive input. Both runs exit zero:
`keyed-product-control-first.json` and `keyed-product-control-restart.json` with
their stderr/exit records in the same directory. This is isolated reference
integration, not packaged Control, a provider execution, or a scheduler/crash
test; the Node SQLite experimental advisory remains visible.

One additional request-identity constraint is measured separately. Control
fingerprints raw request input before its decoder/planner, using canonical JSON.
Reordered raw objects therefore alias under one idempotency key even when a fresh
order-sensitive Plan has a different key. The language adapter must submit
`encodeKeyedValue(input)` as the raw Control input, then decode that representation
in the Flow catalog before native compilation. Real SQL Control then refuses the
changed-order retry, accepts an exact repeat without a second Plan, and persists
the original decoded order. Evidence: `keyed-control-order-reference-second.json`
and its exit record. This probe uses the data codec only, no native compiler or
execution. The first probe had an incomplete material fixture and is not counted
as green. This is an obligation for the unimplemented adapter, not a claim that
the current public API automatically performs Control admission.

### Full release checkpoint — September 7 local time, snapshot 69

The source-authentication/approval APIs and canonical-byte correction pass the
complete serial `release:verify`, from `2026-09-08T03:25:44.479Z` to
`2026-09-08T03:44:33.711Z`, exit 0. Snapshot
`/tmp/vibelang-alpha0-release.a7aJq7` contains 2,268 inputs with manifest SHA-256
`47cc55204b2ef1b459af165342ca66f9acfe26bf91afe4cc8b2abf8a9de8235f`.
After the run, every live input still matched its digest and mode; no input files
had been added. This certificate and request-identity note are subsequent docs
changes, not part of that frozen input manifest.

- Node: 329 passed, no skips or todos.
- Bun: 4,721 passed, 30,696 assertions across 231 files; the existing credentialed
  live-model test is explicitly skipped. No unexpected failure.
- Go: 4,391 tests/subtests passed, no skips; compiler package 378.870 seconds.
- Corpus: SDK 553 pass / 1 expected failure; standalone Go 540 match / 14 expected
  failures, over 554 cases, with six ordinary TypeScript interop cases per profile.
  These are delivery profiles of the same Go engine, not independent compilers.
- Product differential: exactly the reviewed 20 rows, zero product-only accepts,
  two product refusals and eighteen differing diagnostic/code positions.
- Package: 559 files, 528 generated, 24 exports; installed Node/Bun consumers,
  source-only worker execution, signature/byte controls and clean-build
  reproducibility all pass.
- Docs: 81 generated files; experimental-glob and bundle-size advisories remain.

Archive SHA-256:
`529c5b2359da7740e0f983b259b4beb17cbc462fc53ef2257cc36ec809824e67`.
Inventory SHA-256:
`c4ece548d30749916a10f97e52ca661ae27b0243c691dd54d2c383b50dc83baf`.
Evidence: `/tmp/smithers-alpha0-verification.Wa6A93/snapshot-release-69.log`,
its `.result.json`, and `snapshot-69.json`. The native API remains 41, using
TypeScript `7.1.0-dev` at `1f70213d4922b434345f639b441681e470c7cfc1`;
the upstream `main` read-only recheck still matches. Snapshot 68 remains an
interrupted run. This checkpoint does not certify authenticated scheduling,
the new model's crash recovery, or alpha-0 completion.

## Explicit source-module closure — API 42, full release green

The native keyed-source request and signed `KeyedSourceDeclaration` now accept
explicit dependency sources. Go resolves named/default/namespace imports and
re-exports using the existing native project resolver, checks every supplied
module through the normal language checker and the extraction value view, and
derives Action/Error identities from their actual declaration module. Aliases
and barrels do not rename those contracts; same-spelled declarations in separate
modules remain distinct. Diagnostics retain each dependency's own filename and
UTF-16 positions. No TypeScript compiler library or descriptor-only `never`
failure stubs participate in this path.

These are declaration modules, not silently extracted module initializers.
The aggregate source is bounded to 2 MiB and at most 256 dependencies. Paths
must be unique canonical relative `.vibe` paths; missing imports, source errors,
value initialization, mutations, decorators, computed class names and class
static initialization refuse before a graph is published. All supplied modules
are checked and committed, including unused ones. The Flow body itself remains
in the entry module; imported helper bodies, child Flows and general control-flow
nodes are still outside this keyed profile. No source module is executed or read
implicitly from the filesystem.

The existing `sourceDigest` still hashes entry bytes. With dependencies, every
node additionally commits the same `projectDigest`: a canonical, UTF-16-sorted
list of filenames and source-byte hashes including the entry. Reordering the
request's dependency list leaves Plan identity unchanged; changing any module
bytes changes it. Signed deployments retain and authenticate the complete actual
source set, normalize its order during building, and reject noncanonical sets
from external signers. Restoration recompiles that closure; persisted proof
lookalikes or a changed dependency cannot adopt an old invocation.

The final focused integration group passes 86 tests across six files with 476
assertions, including dependency tampering and externally signed malformed sets.
The broader native Plan/source group and
default-export/refusal controls pass. Build and both native typechecks pass.
The isolated upstream comparison passes all 141 data cases, seven source Plans
(including a re-exported Action) and six ordered-value controls, with empty
stderr. Installed Node/Bun consumers pass, including compiling/signing/restoring
a multi-module source and executing its checked provider in Deno. This is direct
worker execution, not scheduler admission, an approval grant or a journal commit.
Evidence is under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`keyed-modules-go-second.log`, `keyed-modules-default-before.log`,
`keyed-modules-bun-final.log`, `keyed-modules-oracle.json` and
`keyed-modules-package.log`, with their exit records. The second Bun measurement
had one incorrect phase assertion: Go already refused the hidden imported `Bad`
failure with `VIBE1104`. The corrected test requires that code and failure name;
no source acceptance rule was changed to make it pass. Snapshot 70 below is the
complete release certificate for this follow-up.

### Full release checkpoint — September 7 local time, snapshot 70

API 42 passes the complete serial `release:verify`, from
`2026-09-08T04:24:00.783Z` to `2026-09-08T04:42:52.407Z`, exit 0.
Snapshot `/tmp/vibelang-alpha0-release.M44LBC` contains 2,270 inputs with manifest
SHA-256 `9e2b81143d821ece28bb076541dfd9d4d736697ee959d677ac000626ee3b293b`.
The post-run audit found every live input's bytes and mode unchanged, with no
added files. This certificate is a subsequent documentation-only update.

- Node: 329 passed, no skips or todos; 184,673.194291 milliseconds.
- Bun: 4,732 passed, 30,744 assertions across 232 files; 465.12 seconds. The
  existing explicitly credentialed live-model test is the sole skip.
- Go: 4,421 tests/subtests passed, no skips; compiler package 383.511 seconds.
- Corpus: SDK 553 pass / 1 expected failure; standalone Go 540 match / 14 expected
  failures, over 554 cases, with six ordinary TypeScript interop cases per profile.
  Both delivery profiles use the same Go engine.
- Product differential: exactly the reviewed 20 rows, zero product-only accepts,
  two product refusals and eighteen differing diagnostic/code positions.
- Package: 559 files, 528 generated, 24 exports; installed Node/Bun consumers and
  reproducibility pass, including multi-module source authentication/restoration
  and the direct checked-provider execution described above.
- Docs: 81 files generated. Existing experimental-glob and bundle-size advisories
  remain; this is not a warning-free build claim.

Archive SHA-256:
`c39088d72bff224d0ce8aea2f14f3da75e75ce618448c44f9b9cb267b528e98f`.
Inventory SHA-256:
`9a184ceef39f2509d10ffb3d4960329d784590bfe575fd6eec09acb160bb2d92`.
Native executable SHA-256:
`2eeeb05fc3f2090b6a9518e474bdb747c46332d6aa2a61904245a603d7bf2a2a`.
Its API is 42, TypeScript `7.1.0-dev`, revision
`1f70213d4922b434345f639b441681e470c7cfc1`; a read-only upstream `main` check
after the gate still matches. Evidence is under
`/tmp/smithers-alpha0-verification.Wa6A93/`: `snapshot-release-70.log`, its exit
record, `snapshot-70.json` and `snapshot-70-live-audit.json` with its exit record.
This checkpoint does not implement authenticated scheduler admission, journal
crash recovery under the new model, or the remaining symbolic graph patterns.
It does not declare alpha-0 complete.

## Static keyed fan-out — API 43, full release green

Go now expands checked `fanOut(items, key, body)` templates into the complete
generation-zero Plan before publication. Collections must have known array
structure and known string, number or boolean keys. Inline synchronous callbacks
contribute checked data templates only; neither callbacks nor Action
implementations execute during planning. Each item supports up to sixteen Action
bindings, with immutable aliases and ordered object/array inputs.

Children have structural addresses
`fanout/<source ordinal>/key1_<canonical item-key SHA-256>/<step ordinal>`.
Emission order follows canonical key text; the returned array follows invocation
item order. Reordering items preserves each child's address and content key while
changing the ordered result and approval target. Distinct scalar types and
distinct original Unicode strings do not alias. Item keys identify work's
position, not additional consumed Action data: constant-input sealed Actions can
have equal content keys at different structural addresses. This alone does not
authorize cache adoption or execution.

Per-item Action-result references supply data dependencies. Independent bindings
and independent items acquire no implicit sequencing edge; explicit enclosing
sequencing still applies. Consuming a group joins all declared child work,
including unused intermediate bindings. The final result also waits for all
declared Actions when their values are unused. Empty fan-out publishes no child
Actions, but still checks the callback's source/contracts and all provider
declarations, including malformed effect paths.

The existing 10,000-node limit includes the final result; source nodes and
expanded nodes are both bounded. Expansion shares the 100,000-expression budget,
depth 128 and 16 MiB encoded-graph limit. Duplicate keys, future-result collection
sizes or keys, unsupported callback computations, prototype-setting records and
excessive expansion return diagnostics with no partial Plan. Future-dependent
work needs an explicit bounded round; that adapter remains unfinished.

The source profile remains deliberately bounded. Array indexing must still prove
the value is present before it can feed a required Action input. An unannotated
propagated value nested in a collection can retain an upstream Result in callback
contextual inference and is refused; an explicit checked binding such as
`const value: number = Work.run(n)!` supports known item structure carrying a
future non-key field. Propagated scalar bindings inside the callback itself now
use the same native checked-value assignability helper as ordinary Actions, with
the independent serialized contract check retained. This is not a claim of
complete contextual inference, nested fan-out or dynamic-round support.

Focused verification on September 7 local time:

- Native source/Plan/fan-out group passes, including prior artifact identities,
  empty/single/128-item two-step expansion and reason-specific budget refusals
  (compiler package 28.399 seconds).
- SDK group: 112 passed, 435 assertions across five files, no failures. It covers
  reversed ready-node test-data order, scalar key collisions, sixteen-step
  callbacks, forged addresses and signed fan-out reconstruction in a fresh
  process. The included legacy runtime tests remain compatibility checks.
- Build and both native TypeScript typechecks pass.
- Isolated upstream: 141 protocol cases, ten source Plans and six value controls
  agree, with empty stderr. Source cases now include independent, chained and
  empty fan-out, and altered-priority refusals.
- Installed Node/Bun package consumers pass with reproducible archives: 559
  files, 528 generated files and 24 exports. The installed test compiles, signs,
  authenticates and restores a multi-module fan-out, executes its real checked
  provider for both children in Deno, and reconstructs `[42, 3]` in input order.
  These are direct local worker calls, not scheduler admission or journal replay.

Evidence under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`keyed-fanout-go-second.log`, `keyed-fanout-bun-final.log`,
`keyed-fanout-build.log`, `keyed-fanout-types.log`,
`keyed-fanout-compat-types.log`, `keyed-fanout-oracle.json`, and
`keyed-fanout-package.log`, each with its exit record. The earlier development
runs are retained, including wrong expectations for an unproven array index and
the public signing API's code-only refusal text; they are not green certificates.
No source acceptance check was removed to satisfy those expectations.
Snapshot 71 below certifies the complete serial release gate for API 43.
This feature does not declare alpha-0 complete.

### Full release checkpoint — September 7 local time, snapshot 71

API 43 passes the complete serial `release:verify`, from
`2026-09-08T05:22:20.824Z` to `2026-09-08T05:41:18.548Z`, exit 0.
Snapshot `/tmp/vibelang-alpha0-release.y1eLiY` contains 2,273 inputs with manifest
SHA-256 `afd636b5f8f1cc0f90a392108f0d9fd9af365ad345028194f07fcc7eca689fc7`.
The post-run audit found every live input's bytes and mode unchanged, with no
added files. This certificate is a subsequent documentation-only update.

- Node: 329 passed, no skips or todos; 184,660.818458 milliseconds.
- Bun: 4,766 passed, 30,834 assertions across 233 files; 471.32 seconds. The
  existing explicitly credentialed live-model test is the sole skip.
- Go: 4,430 tests/subtests passed, no skips; compiler package 383.366 seconds.
- Corpus: SDK 553 pass / 1 expected failure; standalone Go 540 match / 14 expected
  failures, over 554 cases, with six ordinary TypeScript interop cases per profile.
  Both delivery profiles use the same Go engine.
- Product differential: exactly the reviewed 20 rows, zero product-only accepts,
  two product refusals and eighteen differing diagnostic/code positions.
- Package: 559 files, 528 generated, 24 exports; installed Node/Bun consumers and
  reproducibility pass, including the signed multi-module fan-out and direct
  checked-provider execution described above.
- Docs: 81 files generated. Existing experimental-glob and bundle-size advisories
  remain; this is not a warning-free build claim.

Archive SHA-256:
`ff13ce06a70b787ff619af7d7b4bc1f64fdb8ae38940266f5a0954e939593dd0`.
Inventory SHA-256:
`22ef297f73a2294b49190b3415ca3ee9e2a6e000f5d34129f5555b59c1a4433c`.
Native executable SHA-256:
`704468f5630687362ba58c16ab0f6a8586bae600d253a61628e78d4d3f804de3`.
Its API is 43, TypeScript `7.1.0-dev`, revision
`1f70213d4922b434345f639b441681e470c7cfc1`; a read-only upstream `main` check
after the gate still matches. Evidence is under
`/tmp/smithers-alpha0-verification.Wa6A93/`: `snapshot-release-71.log`, its exit
record, `snapshot-71.json` and `snapshot-71-live-audit.json` with its exit record.
No runtime dependency was introduced. Authenticated scheduler admission, the new
model's journal crash recovery and the remaining symbolic patterns are still
unfinished; this checkpoint does not declare alpha-0 complete.

## Checked source Flow composition — API 44, full release green

Module-level immutable `const Child = durable(body)` declarations can now be
composed by `Child.run(input)!` in another static Flow. Native Go resolves the
real source declaration, including named/default/namespace imports and re-exports;
it never runs a body or loads a module to discover work. A named body function or
immutable function expression in the declaration module is also supported.
Imported Actions and nominal failures retain their declaration-module identities.
Failure/capability checking follows the source function graph, not the structural
prelude `.run` signature; error-row erasure draws the existing language diagnostic.
Source `.run` references outside a static Flow body refuse instead of implying
an executable method or approval on the published descriptor.

The additive `exportName` request/deployment field chooses an entry-module export.
Without it, a single declaration retains its old behavior; multiple declarations
require a unique exported Flow. Ambiguous, missing and private exports refuse.
An explicit selection is bound into source evidence, the signed deployment and
invocation restoration. Merely re-exporting an imported Flow as the entry is not
yet an entry-body adapter; imported Flows can be composed from an entry body.

Each call expands into flat Action nodes under a structural `flow/<ordinal>/`
scope. Repeated calls have distinct addresses; identical declared work still has
equal content keys. Data edges and explicit `sequential` barriers cross scopes.
Consuming a child result joins all its declared work, including unused internal
Actions, while independent sibling calls remain ready together. Nested children,
fan-out inside children, ordered object results and known child-returned array
structure are data-only compositions. Action-free children introduce no fake
execution node, and preserve inherited completion barriers.

Recursion, more than seven nested child boundaries, mutable/opaque receivers,
unrepresentable captures and missing providers refuse with no partial Plan.
Source/expanded node counts share the existing 10,000-node cap including the
result. Expression traversal remains bounded at 100,000 visits/depth 128. Before
descriptor walking and hashing, a conservative private-IR serialization check
also bounds alias-expanded trees and repeated child artifacts to 16 MiB.
At this API 44 checkpoint, the propagated-collection contextual-inference limitation remained:
`const items: readonly number[] = Child.run(n)!` can feed known static fan-out;
the unannotated collection form refused rather than weakening callback types.
API 45, below, retires that limitation through retained-body checking.
Children inside a fan-out callback remained unsupported at this checkpoint;
API 46 below adds their static composition. Future-dependent graph shapes still
need their bounded-round adapters.

Focused verification on September 7 local time passes:

- Native durable/Plan/keyed-source group: compiler package 77.038 seconds,
  including seven/eight-boundary controls, recursion and serialization refusals.
- SDK group: 148 tests, 559 assertions across six files, no failures. It includes
  signed source selection and fresh-process reauthentication/restoration.
- Build and both native TypeScript typechecks pass.
- Isolated upstream comparisons: 141 protocol cases, thirteen source-produced
  Plans and six value controls agree, with empty stderr.
- Installed Node/Bun consumers and reproducibility pass: 559 package files,
  528 generated files and 24 exports. The installed consumer compiles, signs,
  authenticates and restores a selected multi-module composition, executes both
  real providers directly in Deno, and delivers the second provider's `43`.
  Archive SHA-256 is
  `a9bd96cdc04fd8f5078118cdbcf9eddd7a8493aa46def303eb1fb4837535788d`;
  inventory SHA-256 is
  `76b639419852c171e3d8018e693920909e41b99d8916e3df0ae935c8cc42161b`.

Evidence under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`keyed-flows-go-verified.log`, `keyed-flows-bun-final.log`,
`keyed-flows-build.log`, `keyed-flows-types.log`,
`keyed-flows-compat-types.log`, `keyed-flows-oracle.json` and
`keyed-flows-package.log`, each with its true exit record. Earlier development
failures remain recorded. One old blanket source-child refusal test now checks
the still-invalid mutable receiver; positive immutable composition is tested
separately. No conformance expectation or diagnostic baseline was weakened.

The native executable is API 44, TypeScript `7.1.0-dev`, revision
`1f70213d4922b434345f639b441681e470c7cfc1`, SHA-256
`7b524fdcc4b45ec4e481ff8a222dafabd1c2e009c42c17c49c02180e57cfb1de`.
The source pin still matches upstream main at the 06:36 UTC read-only check.
The full API 44 release certificate follows this focused checkpoint. These results
establish graph composition and direct provider integration, not scheduler
admission, Control approval or journal crash recovery. They do not declare
alpha-0 complete or add a runtime dependency.

### Full release checkpoint — September 7 local time, snapshot 72

API 44 passes the complete serial `release:verify`, from
`2026-09-08T06:40:06.297Z` to `2026-09-08T06:59:36.563Z`, exit 0.
Snapshot `/tmp/vibelang-alpha0-release.WdnkH8` contains 2,276 inputs with manifest
SHA-256 `08441eeb3abc92fbdefd4dab5bf23291d113193de69fdc139fd77bd113a614b0`.
At `07:00:07Z`, every live input byte/mode still matched and no new input had
appeared. This measurement entry and the two summary certificates were written
after that audit; implementation files were unchanged throughout the gate.

- Node: 329 passed, no failures/skips/todos (185,926.999041 ms).
- Bun: 4,794 passed, no failures/todos, the one existing credentialed live-model
  skip; 30,902 assertions across 234 files (478.72 seconds).
- Go: 4,458 tests/subtests passed, no failures/skips; compiler package 405.469s.
- All 554 corpus cases and six plain-TypeScript interop controls pass their
  reviewed gates: SDK 553 pass plus one expected failure; standalone Go 540
  match plus fourteen expected failures. These are delivery profiles over the
  same Go engine, not separate JavaScript and Go compiler implementations.
- Product differential: exactly the unchanged twenty reviewed differences,
  zero product-only acceptances, two product refusals, eighteen diagnostic
  code/position differences. The committed record matches exactly.
- Installed Node/Bun consumers, reproducibility and package inventory pass,
  with the same archive/inventory hashes as the focused checkpoint above.
- Docs build 81 files; only the existing experimental-glob and bundle-size
  advisories remain.

The post-gate read-only upstream check at `07:00Z` still matches the pinned
`7.1.0-dev` revision. Evidence is in
`/tmp/smithers-alpha0-verification.Wa6A93/`: `snapshot-release-72.log`, its true
exit record, `snapshot-72.json` and `snapshot-72-live-audit.json` with its exit
record. This is a green compiler/source-composition checkpoint, not completion
of the separate scheduler/Control/journal alpha-0 acceptance path.

## Retained-body source checking — API 45, full release green

Keyed source compilation now checks the complete Flow bodies before erasing
them into graph data. The native Go lowerer keeps every declaration, lifts
Result returns, and presents compiler-proven static propagation as success
values in a private, discarded checking program. Ordinary functions retain
their runtime lowering. The original grammar, failure/capability rows,
ownership, determinism and full lowered TypeScript checks still run.

The extraction Program has a separate success-value type view: it no longer
mistakes the intentional Result/value distinction for a source type error.
It still checks binding and every native Action/callback/structural contract.
Its only keyed caller must first complete retained-body checking. No source
or callback is executed to discover a graph, and no checking helper is a
runtime export. The query-only `staticPlanCheck` analysis option cannot
authorize runtime emission or checked implementation artifacts.

Explicit `Result<A,E>` Flow and fan-out callback annotations now compose with
source child Flows. Unannotated propagated collections, nested collection
properties and known-key objects carrying planned success values retain their
native callback/Action input types. Typed fan-out bodies may return the final
Action with `!`. Future-dependent collection size or keys still require an
explicit bounded round; this change does not pretend those shapes are known.
Wrong annotations, missing names, unused invalid declarations, incompatible
callback parameters and omitted nominal failures continue to refuse.

Fan-out and loop callbacks, plus `sequential` steps, contribute their failure
rows to the enclosing static Flow's ordinary fixed point. Source child calls
retain those rows transitively. A `Result<..., never>` annotation cannot erase
a reachable Action failure. Expression-arrow returns now carry the same Result
row as an equivalent block return. The retained-body check also projects
`sequential` arguments to their checked success types, without changing the
ordinary runtime implementation of that combinator.

The signed source builder uses the same retained-body check. Its exact source,
compiler identity and graph remain bound through signing and fresh-process
restoration. Focused verification passes:

- Native keyed/row/callback/Result/durable/Plan group: 998 tests/subtests,
  compiler package 135.987 seconds.
- SDK: 221 tests, 648 assertions across eight files, no failures.
- Build and both native TypeScript typechecks pass.
- Upstream comparison: 141 protocol cases, fifteen source-produced Plans and
  six ordered-value controls agree, with empty stderr.
- Installed Node/Bun consumers and reproducibility pass: 559 package files,
  528 generated files, 24 exports. Installed typed child collections feed
  fan-out, real Deno providers return `[42,3]`, and typed child composition
  passes a real provider result along its data edge to produce `43`.

The archive SHA-256 is
`eae9310149401292e2d7dd6e8c5d31917795f5bd4ee23f198e2a7ffa1882db7e`;
inventory SHA-256 is
`dba3f50248aa3637f024ea21fdf037b2a345fe2e5300b16ac831f77d92995f0e`.
The API 45 native executable SHA-256 is
`1a2a0a76558512ad0c5a51bc22991ef67c10738cb69e77db86be96af8f9e3680`;
its TypeScript `7.1.0-dev` revision remains
`1f70213d4922b434345f639b441681e470c7cfc1`, matching the read-only upstream
check after focused verification.

Evidence under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`keyed-check-rows-go.log`, `keyed-check-rows-bun.log`,
`keyed-check-rows-build.log`, `keyed-check-rows-types.log`,
`keyed-check-rows-compat-types.log`, `keyed-check-rows-oracle.json` and
`keyed-check-rows-package.log`, each with its true exit record. Initial regression
failures remain recorded. Two old inferred-collection refusal expectations are
replaced by actual interpreted-success checks; no conformance marker or
product-differential baseline is weakened. The full serial gate follows this
focused checkpoint. Snapshot 73 was stopped with exit 143 to verify and fix
the confirmed fan-out error-row erasure; it is not a green release. Scheduler
admission, Control approval and journal crash
recovery remain separate unfinished work, not claims of these tests.

The following compatibility follow-up is included in the hashes above.
Snapshot 74 failed because the new expression-arrow row facts made the existing
callback checks reject plain Result forwarding. No corpus expectation was
changed. A native proof now distinguishes an already-Result callable ABI from
an inferred body that introduces a failure: forwarding remains legal without
a new annotation, while propagation, uncaught throws, foreign failure lifts,
default-parameter propagation and evaluated computed names do not qualify.
The same rule serves ordinary callbacks and `Layer.provide`.

Final focused evidence: `keyed-check-final-go.log` (7.346 seconds),
`keyed-check-final-bun.log` (221 tests, 648 assertions),
`keyed-check-forwarding-build.log`, `keyed-check-forwarding-docs.log` (all three
complete examples), `keyed-check-final-oracle.json` and
`keyed-check-final-package.log`. The two corpus subtests in
`keyed-check-forwarding-conformance.log` return to 553 + 1 expected failure and
540 + 14 expected differences, with zero divergence. That combined ad-hoc run
still exits one because its docs check used the previous bundled CLI binary;
the rebuilt CLI's separate docs log exits zero. The next frozen full release
must establish all stages against one settled tree, not combine these partial
results into a release certificate.

Snapshot 75 passed the Node/corpus stage but failed one of 4,801 Bun tests:
an old assertion exempted a concise wrapper around an inferred-fallible call
from the callback-contract rule. The wrapper itself crosses that boundary.
A separate native analysis probe verifies identical `VIBE1101`, `VIBE1303`
and `VIBE1808` diagnostics and the `Db` requirement row for concise and block
forms. The test now covers both forms and requires both callable-contract
diagnostics; product code and corpus expectations are unchanged by this test
correction. Snapshot 75 is a failed release, not partial green certification.

### Complete serial release checkpoint — snapshot 76

API 45 passes the complete serial `release:verify`, from
`2026-09-08T08:24:15.712Z` to `2026-09-08T08:44:11.828Z`, with exit zero.
The frozen source is `/tmp/vibelang-alpha0-release.AZT9Eg`; its 2,278-input
manifest SHA-256 is
`8d5110886de06633ccfe1e52935e19dbeec6bf60d3be81c4ddd539a465f234fb`.
At `08:44Z`, every live input's bytes and mode still matched, with no added
input, before these three implementation-status documents were updated.

- Node: 329 passed; no failures, skips or todos (184.19 seconds).
- Bun: 4,801 passed, 30,927 assertions across 234 files (482.10 seconds).
  The only skip is the explicitly credentialed live-model call; no failure or
  todo is hidden by that allowance.
- Go: 4,484 tests/subtests passed, no failures or skips; compiler package
  428.421 seconds.
- Corpus: SDK 553 + 1 declared expected failure; Go 540 + 14 declared expected
  differences, each covering all 554 cases, plus six plain-TypeScript interop
  cases. No unexpected divergence. The CLI differential matches exactly its
  unchanged 20-case baseline: zero product-only acceptances, two product
  refusals and eighteen diagnostic/code-position differences.
- Installed Node/Bun consumers and two-build reproducibility pass: 559 package
  files, 528 generated files, 24 exports. Archive and inventory hashes match
  the final focused API 45 checkpoint above.
- Docs build 81 files. Build and both native TypeScript typechecks pass too.

The read-only upstream check at `08:44Z` still matches the exact pinned Go
TypeScript `7.1.0-dev` revision. The wrapper-regression follow-up also passes
all 73 invocation-form tests with 137 assertions. Evidence is under
`/tmp/smithers-alpha0-verification.Wa6A93/`: `snapshot-release-76.log` and its
true exit record, `snapshot-76.json`, `snapshot-76-live-audit.json`,
`snapshot-76-upstream-pin.log`, and `keyed-check-wrapper-regressions.log`.
This certifies the compiler/source-checking checkpoint, not the unfinished
Plan scheduler, approval, journal or crash/restart alpha-0 acceptance path.

## Source child Flows in fan-out — API 46, full release green

A compiler-bound source Flow may now be a final or propagated intermediate
`fanOut` callback step. The Go compiler shares ordinary child-Flow resolution,
arity/type checks, depth limits, Action closure registration and conflicting
contract checks with this per-item form. No source callback or module is run to
discover work. Opaque legacy Plan bindings do not acquire this source authority.

Each child is expanded beneath its stable per-item/step address, such as
`fanout/0/<item-key>/0/action/0`. Nested source Flow and fan-out scopes compose.
Reordering items preserves child addresses/content keys while changing result
order and the approval digest. Independent work stays independent; consuming a
child result still joins all its declared work, including unused Actions and
children that return known data. Pure children add values, not fake execution
nodes. The shared 10,000-node, traversal, serialization and seven-child-boundary
limits apply to expansion, including children inside fan-out.

The retained-body checking profile also gives static fan-out callbacks a
success-or-Result value view. This keeps child `.run` results and explicit `!`
well typed without erasing their separately checked nominal failure rows. The
private helper is not a runtime export and the profile remains query-only.
Ordinary callbacks, runtime lowering and compatibility Plan templates retain
their existing contracts. Mutable/opaque children, wrong input/projection
types, unused invalid declarations, recursive source composition, missing
providers and omitted imported failure rows are refused without partial Plans.

The data interpreter validates the new nested address grammar with the same
ordinal/step/depth bounds; rekeying cannot admit malformed or over-deep paths.
Signing and fresh-process restoration use the existing authenticated source
path, not a new structural proof. Focused verification passes:

- Native keyed/Plan/child/fan-out/durable group: 713 tests/subtests, compiler
  package 103.860 seconds.
- SDK graph, interpreter, source module and signed deployment group: 170 tests,
  535 assertions across five files (23.57 seconds).
- Build and both native TypeScript typechecks pass.
- Upstream comparison: 141 protocol cases, seventeen source-produced Plans and
  six value controls agree, with empty stderr.
- Installed Node/Bun consumers and reproducibility pass: 559 package files,
  528 generated files, 24 exports. The installed typed child collection feeds
  per-item child Flows; real Deno providers return `[42,3]`.

The API 46 native executable SHA-256 is
`f64cbe3a2de26968f2742543b4396f54c20b286d5723cde8b962f87aca0681f1`.
Its Go TypeScript `7.1.0-dev` revision remains
`1f70213d4922b434345f639b441681e470c7cfc1`.
Package archive SHA-256:
`8e00c38293207621f18185d7785b471b2b1b483b973b68c6734ccb34e4b93a9c`;
inventory SHA-256:
`091d64b2e07c109cc9862e361019efca8eb3fc6a029c667cd0c836ac1f0bcf8f`.

Evidence under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`fanout-child-final-go.log`, `fanout-child-fourth-bun.log`,
`fanout-child-build.log`, `fanout-child-types.log`,
`fanout-child-compat-types.log`, `fanout-child-oracle.json` and
`fanout-child-package.log`, each with its true exit record. The initial refusals
and intermediate test failures remain recorded; the new Go test was corrected
to assert authored result-dependency order, and two new SDK negative tests now
name the module-initializer refusal they actually reach. No corpus expectation
or product differential baseline was changed. The complete frozen serial gate
below certifies this source checkpoint. These tests do not claim scheduler
admission, Control approval, journal execution or crash/restart acceptance.

### Complete serial release checkpoint — snapshot 77

API 46 passes `release:verify` with exit zero, from
`2026-09-08T09:14:10.099Z` to `2026-09-08T09:34:06.788Z`.
The frozen source is `/tmp/vibelang-alpha0-release.px0HSo`; its 2,279-input
manifest SHA-256 is
`3bab04e768ac8bdbbb4bdb4a6a755cfcf35e88d79f03d3e9b5d994a06b4c9db2`.
At `09:34Z`, all live input bytes/modes still matched and there were no added
inputs. These three implementation-status documents were updated afterward.

- Node: 329 passed, no failures/skips/todos (183.99 seconds).
- Bun: 4,827 passed, 30,997 assertions across 234 files (483.48 seconds).
  Its sole skip remains the explicitly credentialed live-model call; no todo.
- Go: 4,489 tests/subtests passed, no failures/skips; compiler package
  429.428 seconds.
- Corpus: SDK 553 + 1 declared expected failure; Go 540 + 14 declared expected
  differences, covering all 554 cases, plus six plain-TypeScript interop
  controls. No unexpected divergence. The CLI matches exactly its unchanged
  20-case difference register: no product-only acceptance, two product refusals
  and eighteen diagnostic/code-position differences.
- Installed Node/Bun consumers and reproducibility pass, with the same 559
  files, 528 generated files, 24 exports and archive/inventory hashes recorded
  in the focused checkpoint above.
- Build, both native TypeScript typechecks and the 81-file docs build pass.

The post-gate upstream check at `09:34Z` still matches the pinned Go TypeScript
`7.1.0-dev` revision. Evidence under the verification directory above:
`snapshot-release-77.log` and its true exit record, `snapshot-77.json`,
`snapshot-77-live-audit.json`, and `snapshot-77-upstream-pin.log`.
This is a complete compiler/delivery checkpoint, not an alpha-0 completion
claim; scheduler admission, approval and journal crash recovery remain open.

## Enclosing values in static fan-out — API 47, full release green

Static fan-out bodies may now refer to the enclosing Flow input and earlier
checked `const` bindings. Captures are private compiler value IR, not JavaScript
closures or snapshots of module state. Expansion substitutes each composed
Flow's own input and node scope. The captured value may be known ordered data,
an Action result, a child Flow result or a previous fan-out result. No callback,
Flow or provider is evaluated to discover work.

Shared captured results retain data dependencies without sequencing independent
items. Consuming a child or fan-out group still joins every declared child,
including unused work when its returned data is known. Empty fan-out keeps the
enclosing work and still checks its body. Object construction order and duplicate
Ref projection slots remain explicit. Changing a captured input changes consumed
material/content keys while preserving the stable item addresses.

Capture resolution uses native lexical symbols. Only the static fan-out body
opts in: keys must still directly project the current item, and compatibility
loop/fan-out templates keep their previous capture rules. Module state, `let`,
mutation, future declarations, incompatible Action inputs and unproven optional
fields/array indices are refused without partial graphs. Descriptor derivation
preserves the strict presence policy through earlier aliases and aggregates.
A captured alias DAG is bounded before descriptor derivation or serialization.

The alias stress test also exposed avoidable work in asset provenance. With no
registered asset imports, the native asset walk now returns immediately; both
its direct lookup and re-export search can find assets only through that table.
The same refusal test fell from 63.54 seconds to 0.24 seconds. The expanded native
suite includes existing asset and foreign-boundary regression tests.

Focused verification passes:

- Go keyed/Plan/child/fan-out/durable/asset/foreign group: 1,130 tests/subtests,
  compiler package 81.565 seconds.
- SDK graph, interpreter, source modules and signed deployment: 190 tests,
  597 assertions across five files (29.55 seconds). A fresh process reauthenticates
  the captured-source profile and reconstructs identical graph bytes.
- Build and both Go-backed TypeScript typechecks.
- Upstream comparison: 141 protocol cases, nineteen source-produced Plans and
  six value controls; the protocol/value baselines are unchanged.
- Installed Node/Bun consumers and reproducibility: 559 files, 528 generated
  files, 24 exports. Real Deno providers pass the captured child result onward
  and return `[43,43]`; the prior `[42,3]` fan-out and `43` composition controls
  are retained. Direct provider execution is not scheduler admission or recovery.

Native API 47 executable SHA-256:
`1fd8898c2f4330821e23acdab2b6f32a669b5d94869452809429d0e30d9fc6cb`.
The Go TypeScript `7.1.0-dev` revision remains
`1f70213d4922b434345f639b441681e470c7cfc1`.
Package archive SHA-256:
`e2c34277e18478581c6bfd8339280a395a12ed0bd512f4fe5c754f7a6494b3ec`;
inventory SHA-256:
`d15b6f1de911f8892cff8b1dfb9d6c63b4ba9898ae16c18c85706f0258524ec5`.

Evidence under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`fanout-capture-before.log` records the five initial accepted-profile gaps;
`fanout-capture-final-go-2.log`, `fanout-capture-final-bun.log`,
`fanout-capture-build.log`, `fanout-capture-types.log`,
`fanout-capture-compat-types.log`, `fanout-capture-oracle.json` and
`fanout-capture-package.log` have actual zero-exit records. The earlier Go run
records the slow alias test. No corpus expectation or product differential
baseline changed. The complete frozen release below certifies this source
checkpoint; the scheduler, Control and journal acceptance path is still unfinished.

### Complete serial release checkpoint — snapshot 78

API 47 passes `release:verify` with exit zero, from
`2026-09-08T09:58:18.634Z` to `2026-09-08T10:17:34.615Z`.
The frozen source is `/tmp/vibelang-alpha0-release.Z99cCG`; its 2,280-input
manifest SHA-256 is
`0c512f6e72f9398ff3df128dc64fddb98a1186fa51c2f41a5d2b72e4484afd4f`.
At `10:17:56Z`, all live input bytes/modes still matched, with no added inputs.
These three implementation-status documents were updated afterward.

- Node: 329 passed, no failures/skips/todos (184.37 seconds).
- Bun: 4,847 passed, 31,059 assertions across 234 files (487.32 seconds).
  Its sole skip is the explicitly credentialed live-model call; no todo.
- Go: 4,491 tests/subtests passed, no failures/skips; compiler package
  383.468 seconds.
- Corpus: SDK 553 + 1 declared expected failure; Go 540 + 14 declared expected
  differences, covering all 554 cases, plus six plain-TypeScript interop
  controls. No unexpected divergence. The CLI matches its unchanged 20-case
  difference register exactly: no product-only acceptance, two product refusals
  and eighteen diagnostic/code-position differences.
- Installed Node/Bun consumers and reproducibility pass, with 559 package files,
  528 generated files, 24 exports and the archive/inventory hashes above.
- Build, both Go-backed TypeScript typechecks and the 81-file docs build pass.

The post-gate upstream check at `10:17:57Z` still matches the pinned Go TypeScript
`7.1.0-dev` revision. Evidence under the verification directory above:
`snapshot-78.json`, `snapshot-release-78.log`, `snapshot-78-live-audit.json` and
`snapshot-78-upstream-pin.log`, with actual zero-exit records. This checkpoint
does not implement or claim the remaining scheduler/approval/journal acceptance
path, bounded rounds or runtime packaging, and does not mark alpha-0 complete.

### Runtime packaging decision pending

Read-only npm lookups on September 8 at `13:00:26Z` return 404 for the reviewed
`@smthrs/control@1.0.0-rc.0` and `@smthrs/engine-store@1.0.0-rc.0` packages.
The upstream test checkout and its exact dependencies remain isolated; no new
product dependencies, vendored runtime, or replacement scheduler were added.
The owner has been asked whether alpha-0 should vendor the reviewed revision,
require an explicit local checkout, or implement a compatible runtime. This
choice affects product packaging/architecture, not the completed Go migration.
The latest lookup is recorded in `snapshot-81-runtime-registry.json` beside the
release evidence, with its actual HTTP statuses and command exit record.

## Authenticated node worker — API 47, full release green

`createAuthenticatedKeyedNodeWorker` is now public on the Node-safe
`vibelang/durable` surface and the Bun durable surface. It resolves the exact
locally issued invocation, source and Deno runtime proofs. Requests must carry
the complete authenticated node, a positive attempt number, the exact Ref-only
input handoff and an empty hard filesystem boundary. Changed nodes, unknown
authority, getters, proxies and copied proof-shaped objects are refused before
provider execution. Request data is snapshotted before the first await.

The worker selects signed provider bytes itself and executes them through the
captured runtime; callers cannot supply replacement code or host functions.
Success and typed failure payloads are checked against their declared codecs;
ordered objects survive transport. Defects retain their name, message and
optional stack. Unknown/malformed exits become protocol defects, never success
or declared failure. Local cancellation remains interruption, including when it
races a runtime error. No compiler library, runtime dependency or alternate
scheduler was added.

This is the **worker side** of the NodeExecutor seam, not an admission API. An
authenticated source/graph proves neither approval nor run ownership. The host
must obtain admission and supply committed predecessor data, then retain
readiness, attempts, retries, cache policy, fencing, journal commits and terminal
run lifecycle. Filesystem/capability adapters and appended generations are still
outside this worker profile.

The explicit `scripts/keyed-worker-oracle.mjs` composes the public built worker
with the unmodified reviewed upstream SQL Control, PlanScheduler, StepSandbox,
StepBoundary, RunStore and journal. Its test-store composition runs production
SQLite services/migrations against a named file and a real jj workspace. Node
22.19 type-strips the upstream sources; Effect `4.0.0-rc.112` and reference
revision `6bcbaa2d03a10afe8fe59934dabe262f55f012e7` remain isolated and explicitly
selected. It is not bundled runtime delivery and is not silently added to the
default release gate.

The measured integration establishes:

- Go source/provider compilation, signing, fresh authentication and complete
  invocation approval. Pending launch parks; an unauthorized principal and a
  bare graph-digest approval refuse without a grant. The exact approval applies
  once, and a repeated approval is idempotent.
- Independent nodes overlap under the real scheduler and return ordered
  `{"z":42,"a":3}` through actual Deno providers. Two fresh-process passes
  reuse every settled node without another worker call.
- A second source Plan is SIGKILLed on the journal's committed
  `flows.engine.node-settled` event for its first Action. A test-only suspension
  before dispatch of the second Action leaves work pending without changing
  provider code or the approved graph. A fresh process reauthenticates persisted
  bytes, recompiles/restores the graph and reaches `43`, without calling the
  committed Action again. The next fresh-process pass calls no worker.
- Recovery waits for the **actual** 30-second lease cutoff and verifies the old
  pid is absent on the same host. Fresh-heartbeat takeover refuses even with
  death evidence; expired takeover without evidence also refuses. No clock,
  stored heartbeat or ownership policy is modified to make the test pass.

Two complete integrations pass: `keyed-node-worker-oracle-fourth.json` and
`keyed-node-worker-oracle-final.json` in the verification directory above.
The final rebuilt-worker run exits zero from `10:51:09Z` to `10:53:13Z`.
Earlier failures record an incorrect Bun-only test import, a missing host
Crypto layer and an attempted takeover before lease expiry; each was corrected
in the composition rather than bypassing the runtime checks. The focused
worker/value/signing group passes 86 tests and 275 assertions across three
files (`keyed-node-worker-final-bun.log`); both Go-backed TypeScript typechecks
pass after adding a literal annotation to one test expectation.

The installed-package phase also passes (`keyed-node-worker-package-final.log`),
including Node/Bun execution, generated declarations and reproducibility.
The installed child/capture cases now use the authenticated worker itself;
the prior direct-bundle controls remain. Negative declaration checks prevent a
plain graph from satisfying the issued invocation type and a raw object from
masquerading as the ordered wire codec. There are 562 package files, 531
generated files and 24 exports. Archive SHA-256:
`323de2e2860097330cd29dcc89b6c36a7f799199324546313dbb8177dbd5502f`;
inventory SHA-256:
`74a2dd8186c0045fed26baf8d3a699747035f91e4908e1fa7d072eda57e45359`.

This narrows obligations 3–5 below with real integration evidence; it does not
complete the packaged production host, its terminal lifecycle or the remaining
alpha-0 contract. The full release below certifies this worker checkpoint.

### Complete serial release checkpoint — snapshot 79

API 47 passes `release:verify` with exit zero, from
`2026-09-08T10:55:40.073Z` to `2026-09-08T11:14:55.427Z`.
The frozen source is `/tmp/vibelang-alpha0-release.bnBaKT`; its 2,283-input
manifest SHA-256 is
`ea7e1b4195475c18393d3677cbaa6ee6c634a5d0cc3f18a5233e3b000b2f681b`.
At `11:15:27Z`, all live input bytes/modes still matched, with no added inputs.
These three implementation-status documents and the stale compiler-migration
opening in `poc/src/language/README.md` were corrected afterward; no code,
dependencies, test expectations or fixtures changed after measurement.

- Node: 329 passed, no failures/skips/todos (184.26 seconds).
- Bun: 4,880 passed, 31,109 assertions across 235 files (487.24 seconds).
  Its sole skip is the explicitly credentialed live-model call; no todo.
- Go: 4,491 tests/subtests passed, no failures/skips; compiler package
  383.243 seconds.
- Corpus: SDK 553 + 1 declared expected failure; Go 540 + 14 declared expected
  differences, covering all 554 cases, plus six plain-TypeScript interop
  controls. No unexpected divergence. The CLI matches the unchanged 20-case
  difference register exactly: no product-only acceptance, two product refusals
  and eighteen diagnostic/code-position differences.
- Installed Node/Bun consumers and reproducibility pass, with the same 562
  package files, 531 generated files, 24 exports and archive/inventory hashes
  recorded above. Build, both Go-backed TypeScript typechecks and the 81-file
  docs build pass.

The upstream main check at `11:15:27Z` still matches the Go TypeScript
`7.1.0-dev` pin `1f70213d4922b434345f639b441681e470c7cfc1`. Native API and
executable bytes are unchanged by the worker addition. Evidence in the
verification directory: `snapshot-79.json`, `snapshot-release-79.log`,
`snapshot-79-live-audit.json`, `snapshot-79-upstream-pin.log` and their actual
zero-exit records. The separate real-runtime integration passed twice above.
This is a complete compiler/worker/delivery checkpoint, not an alpha-0 completion
claim or resolution of the runtime-packaging decision.

## Pure planned-value computations — API 48, full release green

Native Go now lowers arithmetic, bitwise operators, scalar comparisons and pure
logical/nullish selections in checked keyed-source Flows. They are closed
`compute` data expressions in the existing ordered-value ABI, not callbacks or
JavaScript source passed to an evaluator. Go still owns syntax, checking,
contract derivation and graph extraction; the TypeScript host interprets only
validated operator data. No TypeScript compiler library, new dependency or
parser extension was introduced.
The exact compiler/API identity participates in source and invocation evidence;
API 47 artifacts are not silently accepted as API 48 declarations.

For example, the following `.vibe` body describes two Action nodes and a result
join. The first input calculation is part of its Action's material; the second
retains its data edge to the first result. Neither is computed to discover work.

```ts
import { Action, durable } from "vibelang:flows";
class Work extends Action<(n: number) => Result<number, never>> {}
export const Flow = durable((n: number) => {
  const first = Work.run(n + 1)!;
  return Work.run(first * 2);
});
```

The checked subset supports numeric `+ - * / % **`, unary `+ - ~`, numeric
bitwise/shift operators, scalar `=== !== == !=`, number/string ordering,
string concatenation with scalar operands, and `! && || ??` over inert durable
values. Objects cannot participate in arithmetic, coercion or identity
comparisons: serialization must not turn reference equality into value equality.
Noncanonical numeric literals and durable input values remain refused.
Accepted arithmetic keeps intermediate IEEE values and JavaScript bitwise/
conversion semantics; a nonfinite or negative-zero value that reaches a node
boundary is an execution **defect**, not a typed Action failure or a successful
JSON-normalized value.

Logical right operands are evaluated only when needed. Already-declared Actions
remain in the Plan and must settle even if their values are later unused by a
pure selection. A right operand that *declares* an Action, child Flow or fan-out
is refused (`VIBE4199`) rather than publishing conditional work as unconditional
nodes. Source helpers, mutation and arbitrary callback execution remain outside
this profile. Checked computations also bind through child-Flow results and
enclosing captures in static fan-out input templates. Computed fan-out sizes or
keys are not constant-folded by this extension and still require explicit
statically known data or the future bounded-round adapter.

The distinction is required by the reviewed runtime: `Node.branch`/`Graph` can
describe both arms, but the Flow `Interpreter` chooses which arm to demand;
the generic `PlanScheduler` alone does not implement that selection. This
extension therefore does not claim source branch or bounded-round execution.

The interpreter validates exact operator fields/arity and consumes each declared
slot once. Every resolved Ref subtree is checked against its **producer's**
projected success contract before computation; a wrong numeric result cannot be
hidden by a comparison that happens to yield a valid boolean. Duplicate Ref
consistency and ordering checks remain. Native alias expansion is bounded before
descriptor derivation, and concatenations share a per-node 4,194,304 produced
UTF-16-unit work budget, charged before allocation. The existing 4 MiB encoded
value, traversal and graph budgets are unchanged. Protocol/evidence refusals
remain rejected requests; pure-value evaluation defects become explicit worker
defect exits, with cancellation retaining its separate interruption channel.

Focused evidence: 33 Go tests/subtests; 288 computation, worker, signing,
interpreter, child-Flow and fan-out tests (763 assertions); build and both
Go-backed typechecks; 141 unchanged upstream protocol measurements, 22
source-produced Plans and six value/cache controls. The real-provider tests
exercise calculation before and after an authenticated Deno Action and confirm
that an invalid computed input does not dispatch its looping provider. Rekeying
an altered operator changes graph identity but cannot restore the signed source
invocation or substitute its worker node.

Installed Node/Bun package checks pass: 565 files, 534 generated files and 24
exports. Archive SHA-256
`fc79335bb15ca0bf636296b3b2729e5af10184880cf7ec6308f79a1997b97cd5`;
inventory SHA-256
`aa309d16de6843181545def6f710fcf40078c7a085c04abe752701ae47e8c7a3`.
The actual reviewed SQL Control/scheduler/journal oracle passes four scenarios
from `2026-09-08T11:58:15.139Z` to `12:02:21.529Z`: the two original controls
and independent/kill-restart computation variants. Computation results are
`{"z":86,"a":4,"ok":true}` and `86`. Each crash occurs after the first committed
Action; the fresh process runs only the remaining Action and result, and a
further restart performs zero invocations. All exact-approval, ownership,
lease-expiry and plan-change refusals remain. Artifacts are in
`/var/folders/qy/8f0_qzms1vzd_00lv3pp30yw0000gn/T/vibelang-keyed-worker-oracle.qX8k4u`.
The oracle is still an explicit external composition, not the packaged runtime.

The verification directory contains `keyed-computation-go.log`,
`keyed-computation-final.log`, `keyed-computation-oracle.json`,
`keyed-computation-worker-oracle.json`, `keyed-computation-package.json` and their
actual zero-exit records. Earlier failed test-authoring runs are retained, not
counted as green: the first fixture expected sorted dependencies instead of the
established Ref-first order, and one child fixture misspelled `Child.run(n)`.
The complete serial release below certifies this additional computation profile.
No corpus marker, product difference baseline or runtime dependency was changed
to obtain these results.

### Complete serial release checkpoint — snapshot 80

API 48 passes `release:verify` with exit zero, from
`2026-09-08T12:07:27.298Z` to `12:26:58.124Z`. The frozen source is
`/tmp/vibelang-alpha0-release.BGGjfT`; its 2,286-input manifest SHA-256 is
`74aec579cd67576869c9374a2f148e6bc6044b58b3843f0d718dc15dc4c63bb2`.
At `12:28:34Z`, every live input still matched its tested bytes and mode, with
no added inputs. This certificate and the two other implementation-status
documents were updated afterward; code, dependencies, fixtures and expectations
were not changed after measurement.

- Node: 329 passed, no failures/skips/todos (183.38 seconds).
- Bun: 4,951 passed, 31,245 assertions across 236 files (498.42 seconds).
  The only skip is the explicitly credentialed live-model call; no todo.
- Go: 4,524 tests/subtests passed, no failures/skips; compiler package
  387.223 seconds.
- Corpus: SDK 553 + 1 declared expected failure; standalone Go 540 + 14
  declared expected differences over all 554 cases, with six plain-TypeScript
  interop controls per profile. No unexpected divergence. The CLI differential
  exactly matches the unchanged 20-row register: zero product-only accepts,
  two product refusals and eighteen diagnostic/code-position differences.
- Installed Node/Bun consumers and reproducible archives pass: 565 package
  files, 534 generated files, 24 exports, and the same archive/inventory hashes
  recorded above. Build, both Go-backed typechecks and the 81-file docs build
  pass. Existing experimental-glob and bundle-size advisories remain; this is
  not a warning-free build claim.

Native executable SHA-256:
`0ec318df6b01d5284f631afb605d086ff903196baf1406d7940c65834a0dde0b`.
Compiler patch-series identity:
`59107c300e383aa8fdea1e7f0e33ec430deb6657e95b0544286181cb62bcdf48`.
The exact upstream `main` checks at `12:10:13Z` and `12:28:35Z` still match
Go TypeScript `7.1.0-dev` pin
`1f70213d4922b434345f639b441681e470c7cfc1`.

Evidence in the verification directory: `snapshot-80.json`,
`snapshot-release-80.log`, `snapshot-80-live-audit.json`,
`snapshot-80-upstream-pin.log` and their actual zero-exit records. The separate
four-scenario actual-runtime integration is recorded above. This is a complete
compiler/computation/worker/delivery checkpoint, **not alpha-0 completion**:
the production host, branch/round adapters, product-default/spec reconciliation
and the runtime-packaging decision remain unfinished.

## Keyed CLI inspection — API 48, full release green

`vibe plan` now defaults to the Go-derived keyed graph. It requires a source
entry, exact input JSON, explicit provider declarations and a Plan id. Source
module discovery is bounded by a canonical root, 257 files and 2 MiB total;
each data file is limited to 16 MiB. Entry-export, Flow-id and Flow-version
options reach the same native source endpoint used by authenticated invocation
issuance. Neither the CLI nor that endpoint runs the authored module or Flow.

The CLI preserves raw JSON until Go validates duplicate fields, numbers,
Unicode, provider policy and input schemas. Source BOMs remain bound to source
identity while BOM-prefixed JSON refuses. It publishes the native canonical
Plan bytes plus a newline only after success; source, discovered dependency,
input and provider files cannot be overwritten, including hard-link aliases.
Output symlinks, including dangling ones, refuse. Bounded regular-file reads
also reject streams/devices before opening them and use nonblocking/no-follow
flags for the final-component open on hosts supporting those flags.

Historical Manifest inspection is retained only under the explicit
`--profile manifest-compat --bindings ...` CLI profile. Its previous regression
assertions remain; no default failure silently selects that model, and mixed
profile options refuse. Public Manifest serialization APIs remain compatible.
The CLI reference now distinguishes this shipped command from target deployment
commands and the still-historical `compile`/`run` body path.

Provider declarations on the inspection command are **claims**, not authenticated
code or approval. Installed Node/Bun consumer checks invoke the actual CLI,
compare the resulting artifact byte-for-byte with authenticated SDK issuance,
restore it against signed source/provider/runtime artifacts and feed that proof
to the real worker. A structurally valid CLI Plan naming fabricated provider
bytes still fails restoration. This does not replace Control admission or the
unfinished production scheduler host, and adds no runtime dependency.

The first 21 new CLI regressions failed 20/21 before implementation and passed
21/21 afterward. Expanded file tests exposed a real dangling-symlink overwrite
gap, now guarded. Two other expanded-test failures were fixture assumptions:
the root-discovery control used an unsupported module-level value capture, and
the ambiguity assertion expected the wrong existing diagnostic wording. Those
controls now use a declared Action and the actual ambiguity diagnostic without
loosening product acceptance. Logs are `keyed-cli-before.log`,
`keyed-cli-after-first.log`, and `keyed-cli-file-guards-before.log` under the
verification directory. The subsequent successful measurements are recorded
below; alpha-0 is not complete.

The focused `keyed-cli-final.log` run passes all 89 then-current CLI tests
(including every compatibility assertion) in 50.11 seconds. After five schema
controls were added, `keyed-cli-schema-final.log` passes all 44 keyed CLI tests
in 8.75 seconds, with no skips/todos. Both Go-backed typechecks and the build
pass. `keyed-cli-fifo.json` records a macOS named-pipe refusal with no writer,
no timeout and exit 2; it is a platform-specific probe, not a skipped suite case.

`keyed-cli-package.json` passes the complete installed Node/Bun consumers and
reproducibility check: 565 files, 534 generated files and 24 exports. Archive
SHA-256 `e95648397405f0880c8f363b5e330c91ed65e60cfff33ac7eb40b2821b69a998`;
inventory SHA-256
`d5cbaa97513decf28b1d9ffc7638fb7fb5bdef95e681877f31bd643c453863e5`.
The upstream `main` check at `12:56:35Z` still matches the pinned Go compiler.
These focused measurements precede the separate frozen full release run.

### Complete serial release checkpoint — snapshot 81

The full `release:verify` run exits 0, from
`2026-09-08T12:58:53.653Z` to `13:18:25.818Z`, against
`/tmp/vibelang-alpha0-release.NAvOPe`. Its 2,287-input manifest SHA-256 is
`6efb1a9e2fd434d3ff5fa691cc7a38837e1bfe05ca1e6ec0c9aa6adea7a5cc71`.
The live audit at `13:18:51Z` finds no changed contents/modes or added inputs.
Only this certificate and the two implementation-status records are updated
afterward; implementation, dependency, fixture and acceptance bytes stay frozen.

- Node: 373 passed, no failures/skips/todos (184.38 seconds), including all 44
  keyed CLI controls and every retained Manifest compatibility assertion.
- Bun: 4,951 passed, 31,245 assertions across 236 files (498.84 seconds).
  The single existing credentialed live-model call is skipped; no todos.
- Go: 4,524 tests/subtests passed, no failures/skips; compiler package
  385.341 seconds.
- Corpus: SDK 553 + 1 declared expected failure; standalone Go 540 + 14
  declared expected differences, across all 554 cases and six plain-TypeScript
  interop controls per profile. No unexpected divergence. The product
  differential still matches exactly the unchanged 20-row register: zero
  product-only accepts, two product refusals and eighteen diagnostic/code-position
  differences. Both delivery profiles use the same Go compiler.
- Installed Node/Bun consumers, two reproducible archives, 565 package files,
  534 generated files and 24 exports pass. Archive and inventory hashes match
  the focused package check above. The 81-file docs build passes with the
  existing experimental-glob and bundle-size advisories.

Native API 48, TypeScript `7.1.0-dev`, revision
`1f70213d4922b434345f639b441681e470c7cfc1` and patch-series identity
`59107c300e383aa8fdea1e7f0e33ec430deb6657e95b0544286181cb62bcdf48`
are unchanged. Native executable SHA-256:
`0ec318df6b01d5284f631afb605d086ff903196baf1406d7940c65834a0dde0b`.
The post-release upstream `main` check at `13:18:53Z` still matches that pin.

Evidence in the verification directory: `snapshot-81.json`,
`snapshot-release-81.log`, `snapshot-81-live-audit.json`,
`snapshot-81-final-upstream-pin.log` and their actual zero-exit records.
The registry check still refuses the unpublished reviewed runtime versions;
the delivery-model question has been presented to the owner and is unanswered.
This is an inspected-Plan CLI/worker delivery checkpoint, **not alpha-0
completion**: production host packaging, actual branch/round execution,
remaining product-default/spec reconciliation and cleanup-completion precedence
remain open. The earlier isolated scheduler/crash measurements are retained,
not represented as new executions during this CLI-only change.

## Current durable documentation and executable examples — full release green

The main durable specification and guide now state the September 6 owner Plan
contract. They distinguish graph construction, authenticated artifact build,
exact invocation approval, admission, resume and non-executing history replay.
The key/approval/frame identities, bounded rounds, independent readiness,
recovery tiers and fork reuse limitation follow the reviewed concept pages and
the already-inspected runtime interfaces. The new text does not ratify general
cleanup precedence, claim a packaged host or pretend branch/round support exists.

The former specification and guide are preserved under their respective
`history/durable-replay.mdx` routes, with prominent non-current labels. The old
complete body program remains unchanged, except for explicit `legacy-body`
documentation-gate metadata. SA-2/SA-8, the effects-page boundary warning and the
older durable draft now identify the replaced model. Other detailed references
still need reconciliation; this is the central contract and guide, not a claim
that every older page has been rewritten.

The corpus coverage ledger explicitly retains body/Manifest expectations as
compatibility evidence. No fixture, expected failure or differential allowance
changes. Current keyed tests and isolated runtime measurements are separately
identified; this does not invent a new corpus driver or make the old corpus
prove the new durable contract.

A gate defect was reproduced while adding current examples: an unsuccessful
compiler process returning JSON without `files` could be reported as a successful
documentation program. The initial seven controls measured six failures in
`docs-plan-gate-before.log`. The checker now validates process completion,
status/envelope agreement, every required file report and the delivery profile.
It rejects malformed/duplicate metadata, uncontained filenames, incomplete
fences and graph-shaped or Manifest fallbacks. File-like fences inside a longer
fragment fence do not create spurious programs.

`plan=<id>` examples run the actual default `vibe plan` command with their exact
`input.json` and `providers.json`; successful graphs also pass the Go verifier
with identical canonical bytes. A documented refusal requires native source
diagnostics and no artifact. The docs gate now measures two ordinary checks,
three keyed examples (two successes and one refusal), and the retained body
example under explicit historical classification. A body check cannot certify
a Plan example.

The 30-test focused gate group passes, followed by the 50-test combined
documentation/protocol/package-link/gate-composition group in 5.08 seconds,
with no skips/todos (`docs-plan-final-focused.log`). The initial docs build
passes with 85 generated files and the existing toolchain advisories
(`docs-plan-build-first.log`); subsequent boundary warnings are covered by the
fresh full release below. All evidence is in the same verification directory.
Native API, compiler pin, runtime implementation and dependencies are unchanged.
Runtime packaging remains an unanswered owner choice; alpha-0 is not complete.

### Complete serial release checkpoint — snapshot 82

The complete `release:verify` run exits 0 from
`2026-09-08T13:59:44.914Z` to `14:19:16.204Z`, against
`/tmp/vibelang-alpha0-release.LOfOcd`. Its 2,290-input manifest SHA-256 is
`bb9c7f38ddda0977194b18435da863f8af442735c76b3f217f7476b3e55dd0c5`.
The live audit at `14:19:32Z` finds no changed contents/modes or added inputs.

- Node: 402 passed, no failures/skips/todos (185.40 seconds).
- Bun: 4,951 passed, 31,245 assertions across 236 files (495.28 seconds), with
  only the existing explicitly credentialed live-model skip and no todos.
- Go: 4,524 tests/subtests passed, no failures/skips; compiler package
  386.734 seconds.
- Corpus: SDK 553 + 1 declared expected failure; standalone Go 540 + 14
  declared expected differences across 554 cases, with six interop controls
  per profile. The differential exactly matches the unchanged twenty-row
  register: zero product-only accepts, two product refusals and eighteen
  diagnostic/code-position differences. Both profiles use the same Go compiler.
- Installed Node/Bun consumers, two reproducible archives, 565 package files,
  534 generated files and 24 exports pass. Archive SHA-256 remains
  `e95648397405f0880c8f363b5e330c91ed65e60cfff33ac7eb40b2821b69a998`;
  inventory SHA-256 remains
  `d5cbaa97513decf28b1d9ffc7638fb7fb5bdef95e681877f31bd643c453863e5`.
- The docs build generates 85 files. The existing experimental-glob and
  bundle-size advisories remain; six rendered-content checks confirm the
  current-versus-historical contract boundary.

The post-release upstream `main` lookup at `14:19:59Z` still matches
`1f70213d4922b434345f639b441681e470c7cfc1`. Native API 48, compiler version,
patch series and executable SHA-256 are unchanged from snapshot 81 above.
No runtime composition or upstream oracle was rerun during this docs-only work;
their earlier measured certificates remain the evidence for those paths.

The rendered review found a presentation-only issue in four new warnings:
space-delimited titles displayed as ordinary directive text instead of callout
boxes. `snapshot-82-warning-callouts-before.json` measures all four failures.
After the live audit, those four directive lines were changed to bracketed
titles. A fresh build at `14:20:34Z` generates 85 files; the 50-test focused
group passes in 5.36 seconds, all six rendered-content checks pass, and all four
warnings render as actual warning callouts. The archived original text and its
complete source example remain preserved, independently rechecked afterward.

Evidence: `snapshot-82.json`, `snapshot-release-82.log`,
`snapshot-82-live-audit.json`, `snapshot-82-final-upstream-pin.log`,
`snapshot-82-rendered-docs.json`, `snapshot-82-warning-docs-build.log`,
`snapshot-82-docs-followup-focused.log`, `snapshot-82-warning-callouts-after.json`,
`snapshot-82-followup-rendered-docs.json` and
`snapshot-82-followup-history-preserved.json`, with their actual exit records.
The final certificate audit permits exactly those four one-line presentation
corrections and the three implementation-status records; no product, dependency,
fixture or acceptance bytes changed after the frozen release.
Its first attempt also detected two trailing blank lines removed by the edit
tool from the archived pages. Those bytes were restored, not waived; the strict
`snapshot-82-certificate-audit-final.json` verifies the exact intended changes.

This is a current-contract documentation and checking checkpoint, not alpha-0
completion. Runtime packaging is still an unanswered owner choice; the host,
branch/round drivers, remaining defaults/adapters and cleanup precedence remain
unfinished obligations below.

## Short-circuit Action work — API 50, full release green

The Go source lowerer now expresses Action-bearing `&&`, `||` and `??` using the
complete branch representation and authenticated demand worker introduced in
API 49. The right operand is compiled in its own graph scope, even when input
makes the choice obvious. Left-side Actions are outer references, not copies.
Pure left computations can be reconstructed as data without introducing a new
durable boundary for discarded IEEE intermediates. Selection preserves the
original operand and its structural contract, including falsy zero/empty-string
values and `null` removal from a coalesced result. Only the selected path runs;
failure, defect and cancellation are never reinterpreted as operand values.

Both paths retain their provider/failure contracts, source child/fan-out scopes,
explicit sequencing and cross-arm effect protections. The worker adds only a
closed unary `is-null` data operation; no source evaluator, runtime dependency
or substitute scheduler is introduced. API 50 and the native patch identity
bind the source semantics; the keyed wire contract and source ABI are unchanged.
General must-use classification now retains the obligation of a scalar/Result
union while recognizing that already-propagated logical successes are plain.

Focused measurements on September 8:

- Native ownership, logical-work and retained-refusal tests pass: 108 tests and
  subtests, no skips. The new union-ownership tests include ordinary functions
  and already-propagated controls; the complete existing ownership matrix stays
  green.
- The three-file source/computation/authenticated-worker group passes 200 tests
  and 1,227 assertions, including child/fan-out composition, precise annotations,
  skipped providers, real selected failures, cancellation, falsy operands,
  discarded IEEE intermediates and hostile re-keyed condition expressions.
- All 51 keyed CLI tests pass. Installed Node and Bun consumers issue each
  logical graph through the real CLI, compare it byte-for-byte to the signed
  source's native invocation, restore it and execute only the selected provider.
  The package-content/reproducibility check passes; whole-POC Go typechecking
  also passes.
- The reviewed reference verifies all 141 wire cases and 32 source-produced
  Plans; six ordered-value comparisons pass. The nineteen actual-Interpreter
  control comparisons also pass. These tests do not claim a branch journal.
- Four actual SQL Control/scheduler/journal scenarios pass, including real
  SIGKILL after commit followed by fresh-process recovery and another resume
  without re-invoking committed work. They remain nonbranch compatibility
  evidence, not proof of durable branch hosting.

Logs are under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`keyed-logical-choice-go-first.log`, `keyed-logical-sdk-second.log`,
`keyed-logical-cli-first.log`, `keyed-logical-package-first.json`,
`keyed-logical-poc-typecheck-first.log`, `keyed-logical-plan-oracle-first.json`,
`keyed-logical-control-oracle-first.json` and
`keyed-logical-worker-oracle-first.json`. The first SDK measurement exposed the
mixed-Result must-use hole and an obsolete refusal assertion; neither failure
was waived. The former has a general native checker fix and ordinary-function
regressions; the latter is replaced by positive graph and execution tests.

### Full release checkpoint — September 8, snapshot 84

API 50 passes `release:verify` serially from `2026-09-08T16:17:18.621Z` to
`2026-09-08T16:37:29.580Z`, exit 0. No source or test files changed during the
run. Snapshot `/tmp/vibelang-alpha0-release.SIFq67` contains 2,298 inputs;
manifest SHA-256 is
`798e62b78295b34659f8fe9d9aacf7eac2539dddc4ef8e6fc98d43de624ff261`.

- Node: 409 passed, no skips/todos, 184.812 seconds.
- Bun: 5,111 passed, the one named credentialed live-model skip, no failures or
  todos; 32,548 assertions across 238 files, 518.07 seconds.
- Go: 4,556 tests/subtests passed, no skips; compiler package 392.494 seconds.
- Corpus: SDK 553 passed plus one declared expected failure; standalone Go
  540 matches plus fourteen declared expected failures. All 554 cases and six
  ordinary TypeScript interop controls are measured, with no unexpected failure.
- Product differential: the same twenty recorded differences—zero product-only
  acceptances, two product refusals and eighteen diagnostic/position differences.
  The record matches exactly; no fixture expectation or marker was changed.
- Package: 568 files, 537 generated files, 24 exports. Installed Node and Bun
  consumers pass CLI-issued logical graph restoration and real selected-provider
  execution. Reproducible archive SHA-256 is
  `690b18b17a721e8ee4b0930474f152f12ab063d91428f4fa6949b8bdf922d25f`;
  inventory SHA-256 is
  `7935fd72fe88255cc8dcb62efb4c04c0722a026dcadc10cf9bcab56341486c80`.
- Docs build: 85 generated files. The example check passes eight complete
  programs: five keyed, two ordinary checks and one explicitly historical body
  example. The compiler POC README now labels its old hoisting/refusal discussion
  as historical rather than presenting it as current behavior.

Native compiler version is `7.1.0-dev`, API 50, pinned revision
`1f70213d4922b434345f639b441681e470c7cfc1`, patch digest
`9b58575c10eaf3d004a9e2de0ed93979dc9233a02df1ba3de42e18df411a3ff6`,
and binary SHA-256
`a81119d658ace2912acc850f13bbb03f56faabc070ecaffec6ef377d0a992106`.
The live-input audits during and after the gate report no changed, missing or
added inputs. Fresh upstream `main` checks before and after the run match the
pin, last measured at `2026-09-08T16:38:02Z`. Only the three status records are
amended after that final audit; no source, test, fixture or dependency changes
are covered up by this certificate update.

Evidence: `snapshot-release-84.log`, `snapshot-84.json`,
`snapshot-84-mid-input-audit.json`, `snapshot-84-final-input-audit.json`,
`snapshot-84-upstream-before.log`, `snapshot-84-upstream-after.log` and
`keyed-logical-docs-snippets-first.json` in the verification directory above.
API 49's certificates below remain historical. This closes a source adapter gap,
not packaged durable branch hosting, runtime packaging, ordinary `if`, bounded
rounds, default migration or cleanup-completion precedence. The alpha-0 goal
remains active; the runtime-packaging choice is still unanswered.

## Conditional source graphs and local demand — API 49, full release green

Go now derives complete conditional-expression graphs. A condition is a checked
boolean producer, including a propagated Action success; both arms, their work
and completion joins are published before execution. Native expansion preserves
enclosing planned captures, nested conditionals, source child Flows, static
fan-out children, ordinary independent readiness and explicit `sequential`
barriers. Returning a constant does not erase selected declared work. All
providers and failure contracts are checked, including the untaken alternative.
This is still data extraction, never execution of a Flow, callback or predicate.

The source ABI adds pure `value` nodes and exact `branch` control references.
Its version remains `vibelang/keyed-source/v2`; native API 49 and the compiler
patch identity bind the new source semantics. Prior compiler artifacts do not
silently acquire those semantics. Native publication and imported-source
interpretation reject cross-arm dependencies that bypass a selected join.
This includes generic filesystem-conflict ordering that would otherwise demand
an untaken Action. Such effects need their conditional adapter; the compiler
does not delete approval-relevant edges or alter generic upstream Plan rules.

`KeyedSourceInterpreter.createControl()` supplies local, data-only demand state.
The authenticated worker creates invocation-bound instances and exposes
`executeControlled(control, ticket, work)`. Only a live local reservation can
select runtime prerequisites; eager `execute` refuses an entire branch graph.
Copies, proxies, foreign owners, replayed completions, concurrent use of one
reservation and work from another node refuse. Cancellation invalidates active
reservations, reports running work for the host to interrupt/drain and suppresses
late successful worker exits. Shared work has one demand owner. Selected failure,
defect, interruption, blocked work and branch skip remain distinct.

These are not scheduler leases, approvals or journal receipts. The admitted host
still owns durable attempts, commit/adoption, retries, caches, fencing and
cancellation. It must acknowledge only committed or restored outcomes. No Effect
dependency was added, no runtime was vendored, and no replacement durable
scheduler was introduced. The generic upstream `PlanScheduler` does not provide
a branch-selection hook: its eager dependency sweep must not be used for these
graphs. Packaged durable branch hosting remains open, as does the runtime
packaging choice. Ordinary `if`, conditional Action operands of logical/nullish
operators and bounded rounds still require their source/runtime adapters.

Focused measurements on September 8:

- Go branch publication, reconstruction, failure-closed effect ordering and
  read-only controls pass: eleven tests/subtests, no skips.
- The six-file source/interpreter/control/worker/composition group passes
  280 tests and 1,122 assertions. It includes real Deno provider execution of
  both selections, typed failure, cancellation, forged requests, a 10,000-node
  chain and hostile complete-graph validation.
- Whole-POC Go-backed typechecking and both package build stages pass. The
  installed Node/Bun fixture now covers signed branch restoration and actual
  selected provider execution; both consumers pass in the full release below.
- All 141 generic upstream wire comparisons remain exact. Twenty-six native
  source Plans, including four new conditional/composition cases, pass actual
  upstream `Plan.verify`; modified approval targets refuse. Six existing
  ordered-value comparisons pass unchanged.
- Nineteen independent comparisons with the actual reviewed Flow interpreter
  agree on demanded/settled/skipped nodes, nested branches, shared work and
  sequencing. These comparisons use reference-observed outcomes, not a mock
  claim that the generic scheduler implements conditional journaling.
- The four existing actual-runtime SQL Control/worker/journal scenarios pass
  again, including independent execution and real SIGKILL/fresh-process resume,
  with and without pure computations. They remain nonbranch host tests; they do
  not certify conditional journaling. The final control-only review additionally
  found and fixed failure-cone nodes being mislabeled cancelled when the root
  observed failure before its deeper consumers.

Evidence under `/tmp/smithers-alpha0-verification.Wa6A93/`:
`keyed-branch-native-third.log`, `keyed-branch-sdk-final.log`,
`keyed-branch-poc-typecheck-second.log`,
`keyed-branch-build-final-second.log`, `keyed-branch-plan-oracle-first.json` and
`keyed-branch-control-oracle-final.json`, `keyed-branch-worker-oracle-final.json`
and `keyed-control-failure-cone-before.log`, with their actual exit records.
`keyed-branch-control-oracle-certified.json` repeats the nineteen comparisons
after the failure-cone correction; `keyed-branch-prefreeze.log` verifies both
Go-backed typechecks, branding and all seven documentation programs (four keyed,
two ordinary, one explicitly historical).
Earlier failed attempts are retained: an omitted explicit native embed entry,
two incorrect new test assumptions (arm-local ordinals and `sequential` arity),
a misplaced public re-export, and a mutable/readonly test-type mismatch were
corrected rather than waived. Corpus markers and acceptance baselines did not
change. The frozen serial release certificate follows.

### Full release checkpoint — September 8, snapshot 83

API 49 passes `release:verify` serially from `2026-09-08T15:23:50.299Z` to
`2026-09-08T15:43:22.426Z`, exit 0. Snapshot
`/tmp/vibelang-alpha0-release.1Kkzxy` contains 2,296 inputs with manifest SHA-256
`84810f00d2012d9fdf135507235c08c56f80db84f9fedcb6435b1d794e14d64e`.
The final audit at `15:43:46Z` finds no live content/mode changes, missing files
or additions. No source edits were made during the release run.

- Node: 402 passed, no skips or todos, 185.31 seconds.
- Bun: 5,053 passed, 31,899 assertions across 238 files, 495.62 seconds. The one
  pre-existing credentialed live-model skip remains explicit; no unexpected
  failures, skips or todos were introduced.
- Go: 4,535 tests/subtests passed, no skips; compiler package 385.702 seconds.
- Corpus: SDK 553 pass / 1 expected failure; standalone Go 540 match / 14 expected
  failures across 554 cases, with six ordinary TypeScript interop cases per
  delivery profile. Both profiles use the same Go engine.
- Product differential remains exactly the reviewed twenty rows: zero
  product-only accepts, two refusals and eighteen diagnostic/position differences.
  No fixture, marker or divergence baseline changed.
- Package: 568 files, 537 generated, 24 exports; installed Node/Bun consumers,
  signed branch restoration, actual selected worker execution and reproducibility
  pass. Archive SHA-256:
  `6b930e6c99465cfd2f6ca544773b76a543620ee0f1bdc3581fd3fdf5549d0a64`.
  Inventory SHA-256:
  `35610b18f2edf56e3defc4cdb8ddd403932e7d82a6c9aa2d9a6508b008991aa5`.
- Docs: 85 generated files. The existing experimental-glob and bundle-size
  advisories remain; this is not a warning-free-build claim.

Native patch identity:
`0eeeb1dc272215db4f810ad208286ad677ba6424c01d69e89bddcb0d44a63fc2`.
Packaged native executable SHA-256:
`5d4bc83e5d9880e1ce24a91b07b9c783b2ea71aacf500e3e5e011d914ff0546c`.
It reports Go TypeScript `7.1.0-dev`; upstream `main` still equals the pinned
`1f70213d4922b434345f639b441681e470c7cfc1` at `15:43:46Z`.
Evidence: `snapshot-release-83.log`, `snapshot-83.json`,
`snapshot-83-midrun-audit.json`, `snapshot-83-final-input-audit.json` and
`snapshot-83-upstream-pin.log`, with their actual exit records, under the
verification directory above. Only this record, `IMPLEMENTATION-PLAN.md` and
`GO-MIGRATION.md` are updated afterward to record the completed measurement.

This completes conditional source/worker delivery, not the production durable
branch host or alpha-0. Runtime packaging remains an unanswered owner choice;
bounded rounds, conditional effects, remaining adapters/defaults and cleanup
precedence remain unfinished obligations.

## Remaining implementation obligations

API 52 corrects the native source type-fact seam. The fully checked retained
body supplies nullable success facts with exact source-token and declaration
anchors, instead of trusting TypeScript non-null assertion semantics during
extraction. Facts are bounded data and cannot be supplied by a caller. Null
comparisons observe no transported object identity. Focused native checks, 313
SDK tests, 59 CLI tests, 39 upstream-verified source Plans and installed Node/Bun
consumers pass. The old snapshot 87 demonstrably accepts a null success return
and then refuses it against an erroneous `never` arm contract. The current
regression checks both the null and non-null answers. This extension does not
settle the host-packaging choice or the obligations below. Snapshot 88 passes
the full frozen serial release for these changed inputs, on the recorded
`1f70213d4922b434345f639b441681e470c7cfc1` compiler revision. Upstream advanced
during the run; updating the pin requires a separate qualification.

1. Keep source parsing, checking, codec derivation and static graph extraction
   in Go. Reuse the checked native Plan IR where sound; do not introduce a new
   JavaScript source compiler or execute a Flow to discover its graph.
2. Extend the checked source profile above to the remaining symbolic graph
   patterns and explicit module/Flow bindings. Do not promote a successful
   straight-line extraction into support for unimplemented control-flow nodes.
3. Deliver the authenticated source/provider/runtime artifacts and worker above
   through a packaged executor and Control transaction. Extend authority only
   with real boundary adapters; do not infer effects or tiers from abstract Actions. Keep full
   invocation approval separate from graph identity and artifact signatures.
4. Complete the production host around the measured scheduler/executor seam and
   journal wire contract. Preserve fencing, retries, typed outcomes, cancellation
   and atomic adoption. Plan keys and ordinal execution keys are not cache keys;
   journal sequence and lineage are not a source-site occurrence counter.
5. Promote the native-source → approved Plan → independent-node execution →
   process crash → fresh-process resume integration above to packaged delivery
   and its acceptance gate, preserving changed-plan and changed-approval refusals.
   Inspection must not load executable code or invoke Action implementations.
6. Reconcile product defaults, spec pages and the corpus against the owner
   decision. Preserve the withdrawn body behavior behind explicitly identified
   compatibility APIs while it is retained; do not silently fall back to it when
   static Plan extraction fails. The native-source contract and its diagnostic
   expectations must change together, after reviewing the affected cases.

These are unfinished obligations. The measured data boundary and external
runtime composition do not authorize an execution or declare alpha-0 done.
The independent `finally`-completion precedence question also remains open.
<!-- brand-gate: allow-end -->

## Scoped statements — API 51, full release green

The Go source pass now represents ordinary `if`, lexical blocks, immutable
bindings, consumed Action/Flow expression statements and early returns. A
compile-time syntax continuation places subsequent work only on fallthrough
paths; it does not execute authored source. Fallthrough-only branches keep
unrelated following work independent. Explicit ordering barriers cross scope
through the selected branch join, never a direct dependency on an untaken arm.
Both alternatives are bounded and published before execution.

Native descriptor lookup now indexes a node at declaration, including work in
still-open ancestor arms. This fixes nested conditions and arguments referring
to an enclosing Action. The input descriptor adapter retains native Go checker
narrowing only when its declared TS value and lowered semantic value have equal
structural contracts. A propagated Result's upstream object type cannot grant
success-value narrowing authority. Private checked facts are erased on graph
expansion; selected own-data field projections use a closed data operation, not
source evaluation. Wrong-arm inputs, assertions, lost Results and incomplete
statement paths still refuse.

The focused 270-test SDK group passes, including real authenticated providers,
failure from a consumed statement, early return before a nonterminating provider,
null/discriminated inputs, aliases, shadowing, conditional declarations, child
Flows and fan-out. The 435-test/subtest native keyed group passes; a subsequent
47-test/subtest statement group also includes deep-syntax and expanding-
continuation budget refusals. All 57 CLI tests and the full POC type check pass.
The pinned upstream comparisons agree on 141 protocol cases, 38 source-produced
Plans and six value cases, and verify the Go-produced bytes. Nineteen control
comparisons and all four real SQL Control/scheduler/journal composition cases
pass, including fresh-process recovery with and without pure computations.
Those four are independent-work host-seam evidence, not durable branch hosting.
Nine documentation programs compile as written (six keyed, two ordinary, one
explicit legacy body), and the brand gate is green.

Installed Node/Bun consumers verify CLI issuance, exact authenticated source
restoration and real selected provider execution for early returns, null guards
and discriminated inputs. The package has 568 files, 537 generated files and 24
exports. Archive SHA-256 is
`766bbb048f09928e17364db9f53214a61f5c29bf6a9023d17d29e4fe0efb6aee`;
inventory SHA-256 is
`6d8d8eaee0b9516715302e6827fd4bfb72f647cd3cd984ef09d4ca8bf6329745`.

Evidence is recorded under `/tmp/smithers-alpha0-verification.Wa6A93/` in <!-- brand-gate: allow historical verification directory -->
`keyed-statements-go-fourth.log`, `keyed-statements-budgets-first.log`,
`keyed-statements-sdk-fifth.log`, `keyed-statements-typecheck-second.log`,
`keyed-statements-plan-oracle-first.json`,
`keyed-statements-control-oracle-first.json`,
`keyed-statements-worker-oracle-first.json`, `keyed-statements-cli-first.log`,
`keyed-statements-package-first.json` and `keyed-statements-docs-first.json`.
Earlier red runs remain recorded: the ancestor-node lookup, input/alias
narrowing and test-only `toSorted` compatibility defects were corrected, not
masked. The second SDK attempt was terminated after a native build spelling
error and is not counted as evidence. API 50 snapshot 84 was the prior complete
release measurement; the new complete certificate follows below.
Snapshot 85 stopped in the Node phase (414 passing, one naming-audit failure)
because the literal historical verification path above lacked its deliberate-
mention marker. Its 2,300 inputs still matched the live tree. The record is
corrected and the naming audit is rerun before a fresh complete release; no
source, test, corpus, package or dependency behavior changes for that correction.
Snapshot 86 passed all 415 Node tests, then stopped with 5,180 Bun passes, the
same credentialed skip and one stale deployment assertion that still expected
ordinary `if` source to refuse. Its 2,300 inputs matched the live tree. The exact
old source is retained as a positive signed-restoration/demand test; the negative
fixture now uses unsupported `switch`. No implementation or marker was weakened.
All 43 deployment tests pass after that correction, followed by clean whole-POC
type and naming checks. Evidence: `keyed-statements-deployment-first.log`.

### Full release checkpoint — September 8, snapshot 87

The complete serial `release:verify` run passes from
`2026-09-08T17:55:45.307Z` to `2026-09-08T18:16:26.380Z`, exit 0. Its immutable
snapshot is `/tmp/vibelang-alpha0-release.BWZvLc`, with 2,300 input files and
manifest SHA-256
`b7f633db3e51e731bba82a1bac108bd46cdf6c77d4dbb888fe923244c80706d4`.
The full log is `snapshot-release-87.log` in the verification directory above.

- Node: 415 passing, no skipped/todo cases; 184.645 seconds.
- Bun: 5,182 passing, the same one named credentialed live-model skip, no
  failures; 33,397 assertions across 238 files; 536.80 seconds.
- Go: 4,603 passing tests/subtests, no skips; compiler package 396.940 seconds.
- Corpus: 553/554 SDK cases plus one expected failure; 540/554 standalone-Go
  matches plus fourteen expected failures, and all six ordinary-TypeScript
  interoperability cases. No unexpected failure, unsupported, divergent or
  unmeasured corpus case is introduced.
- Product differential: 554 cases, the same twenty recorded differences—zero
  product-only acceptances, two product refusals and eighteen code/position
  differences. The measured record matches the existing baseline exactly.
- Installed Node/Bun consumers and reproducibility pass. The archive/inventory
  digests and 568/537/24 file/generated/export counts match the focused package
  measurement above, including the new source-to-selected-worker paths.
- The docs build generates 85 files. The nine documented programs are checked
  as written; legacy-body evidence remains explicitly separate from keyed Plans.

The `snapshot-87-final-input-audit.json` audit at `2026-09-08T18:17:03Z` finds
no changed, missing, added or mode-different input. The fresh post-run upstream
measurement (`snapshot-87-upstream-after.log`) still reports
`1f70213d4922b434345f639b441681e470c7cfc1` for `main`.
Native compiler version is `7.1.0-dev`, API 51; patch series is
`15d07f739b117fbba224ae8f6cf0878e58ec3901eeb494cc53959371f37c866c` and the
packaged native executable SHA-256 is
`ecb94613602303a515273bcf0c1a233b809bf5b5c662f387a54b8df1ebd1e672`.
Only the three implementation-status records are updated after this full run;
their allowed-only follow-up is recorded in `snapshot-87-certificate-audit.json`.

No runtime dependency, host vendoring or replacement durable scheduler was
introduced. The packaging decision remains unanswered. The production durable
host, conditional effect adapters, bounded rounds, history and default migration
remain unfinished; this source extension does not establish alpha-0 completion.

### Full release checkpoint — September 8, snapshot 88

The complete serial `release:verify` run passes from
`2026-09-08T18:54:10.957Z` to `2026-09-08T19:15:04.230Z`, exit 0. Its immutable
snapshot is `/tmp/vibelang-alpha0-release.8pBu2r`, with 2,302 input files and
manifest SHA-256
`538588799a6ccceb3061a1c1461b10ebe1fd843f78f315ebc9afaead1a828166`.
Evidence is `snapshot-release-88.log`, its exit record and `snapshot-88.json`
under the verification directory above.

- Node: 417 passing, no skipped/todo cases; 184.595 seconds.
- Bun: 5,225 passing, the same one named credentialed live-model skip, no
  failures; 33,805 assertions across 238 files; 542.38 seconds.
- Go: 4,631 passing tests/subtests, no skips; compiler package 399.249 seconds.
- Corpus: 553/554 SDK cases plus one expected failure; 540/554 standalone-Go
  matches plus fourteen expected failures, and all six ordinary-TypeScript
  interoperability cases. No unexpected, unsupported, divergent or unmeasured
  corpus case is introduced.
- Product differential: the same twenty recorded differences among 554 cases—
  zero product-only acceptances, two product refusals and eighteen code/position
  differences. The measured record matches the existing baseline exactly.
- Installed Node/Bun consumers, including nullable-record Action results,
  authenticated restoration and actual worker execution, and reproducibility pass.
  Archive SHA-256 is
  `d5ec03394c84a033174d5781e23cf3c2815334c414d11df8f433aae285537793`;
  inventory SHA-256 is
  `8d5813ffd89c958e1e56e33b4a4a0b528bb6fd9c0142cf9b5087982719d6c168`.
  The package contains 568 files, 537 generated files and 24 exports.
- Docs: 85 generated files and nine checked programs, including six keyed Plans,
  two ordinary checks and one explicitly historical body example.

The final input audit at `2026-09-08T19:15:19Z` finds no changed, missing,
added or mode-different input. Native compiler version is `7.1.0-dev`, API 52;
patch identity is
`fe857d05b297fc35d0260248da41b916c60a5e2b2f99f8632d574ba474a6b341`, and the
packaged native executable SHA-256 is
`d3fc9f2d5a558bc50c7c0d6aedf1bd9650f5204a6a55772b159bcd263010becd`.

The upstream check at that same time reports
`d0ac85d8eab09e06376390c9352d07c8a8c00aa8`, not the certificate's
`1f70213d4922b434345f639b441681e470c7cfc1` pin. A successful `git ls-remote`
exit is not evidence of revision equality. The new revision changes validation
tasks and repository guidance, not compiler files; its pin/capsule update and
release qualification remain separate work. Only the three implementation-status
records change for this certificate; their follow-up audit is
`snapshot-88-certificate-audit.json`.

No runtime dependency or replacement durable scheduler was introduced. Host
packaging, bounded rounds, history and the remaining default migration are still
unfinished, and this green compiler/worker checkpoint is not alpha-0 completion.

### Upstream compiler refresh — September 8, full release green

The Go compiler pin and verified offline capsule now identify
`d0ac85d8eab09e06376390c9352d07c8a8c00aa8`. Its parent is snapshot 88's pin;
the single commit changes `Herebyfile.mjs` and repository guidance, not compiler
semantics. The clean new source object database is complete, and a fresh
checkout is materialized from the capsule without a network fetch. Only the
source bundle payload changes: all 22 Go dependency modules remain exact.
Re-recording all five patches changes only the series revision, with identical
patches and all 24 pre-image/27 post-image hashes. Both pristine and patched
upstream compiler/project/language-service health selections pass (21 packages,
with the binder package containing no runnable tests). All eight generated files
reproduce exactly with the pinned Node 22.18.0/Go 1.26.0/dprint 0.56.1 tools.
The first regeneration attempt selected system Go 1.24.6 and failed the explicit
local-toolchain requirement; its log remains recorded, and the corrected explicit
Go 1.26.0 invocation passes. Patch reversal restores a clean upstream checkout
after removing the test-only generator dependency symlink; reapplication verifies
all post-images.

The native package builds and reports API 52, Go TypeScript `7.1.0-dev`, patch
identity `ccaea6d64bbfb2d66b58c78bf559775418ffe9a24732d120c4510090dc9e96d4`
and executable SHA-256
`00e66c591f6f79239199f9d2bb6906740b821e2a81758e5663065e2a67def5b2`.
The 141 pinned Plan-data comparisons, 39 upstream-verified source Plans, six
ordered-value comparisons and nineteen control/interpreter comparisons pass.
All four actual external SQL Control/scheduler/journal scenarios pass from
`2026-09-08T19:31:44.260Z` to `2026-09-08T19:35:50.826Z`, including two real
SIGKILL-after-commit/fresh-process variants. Reattachment executes no committed
node again. This is the existing isolated composition, not packaged production
hosting, conditional-effect scheduling or a runtime-vendoring decision.
The shipped architecture guide now describes the Go-only compiler, actual source
capsule, static Plans and unfinished host/default migration accurately. Full
package/release qualification passes in snapshot 89 below, not inherited from
the previous green snapshot. Evidence uses the `upstream-d0ac85-*` logs under
the verification directory above.

### Full release checkpoint — September 8, snapshot 89

The complete serial `release:verify` run passes from
`2026-09-08T19:37:00.804Z` to `2026-09-08T19:58:20.276Z`, exit 0. Its immutable
snapshot is `/tmp/vibelang-alpha0-release.uxYquc`, with 2,302 inputs and manifest
SHA-256 `e9a7f1267a4c5b97ae662ca24845105d76c6e2e9778715e03e026b43e8e56ef0`.
Evidence: `snapshot-release-89.log`, its actual exit record and `snapshot-89.json`
under the verification directory above.

- Node: 417 passing, no skipped/todo cases; 185.684 seconds.
- Bun: 5,225 passing, the same one named credentialed live-model skip, no
  failures; 33,805 assertions across 238 files; 544.96 seconds.
- Go: 4,631 passing tests/subtests, no skips; compiler package 421.864 seconds.
- Corpus: 553/554 SDK cases plus one expected failure; 540/554 standalone-Go
  matches plus fourteen expected failures, and all six ordinary-TypeScript
  interoperability cases on each profile. No unexpected failure, unsupported,
  divergent or unmeasured corpus case is introduced. Both delivery profiles
  use the same Go compiler; this is not an independent JavaScript compiler oracle.
- Product differential: the same twenty recorded differences among 554 cases—
  zero product-only acceptances, two product refusals and eighteen code/position
  differences. The measured record matches the existing baseline exactly.
- Installed Node/Bun consumers and reproducibility pass, including source-to-Plan
  compilation, signed restoration and real selected-worker execution. Archive
  SHA-256 is `88f29e619e559b1bdc089f76f3af0d5a5dee8052ace1fabefddbdb589b34de6f`;
  inventory SHA-256 is
  `84c5f8c46e3aa7ffd868d224609b2a1c60783ec68cb71fec456be7c41e65feff`.
  The package contains 568 files, 537 generated files and 24 exports.
- The docs build generates 85 files. The separate post-run
  `upstream-d0ac85-docs-examples.log` check passes at `19:59:48Z` for all nine
  complete documented programs: six keyed, two ordinary and one explicitly
  historical body example. This is separate evidence, not a claim that the
  full release command itself invokes the documented-program gate.

The final input audit at `2026-09-08T19:58:50Z` finds no changed, missing,
added or mode-different input. The native snapshot executable matches its
recorded SHA-256, API 52 and the new source pin. The fresh upstream output is
compared with that pin, not merely checked for a successful command exit:
`main` still equals `d0ac85d8eab09e06376390c9352d07c8a8c00aa8`.
Only this record, `IMPLEMENTATION-PLAN.md` and `GO-MIGRATION.md` are updated
afterward. Their allowed-only audit is `snapshot-89-certificate-audit.json`.

The direct npm registry recheck at `2026-09-08T19:55:46Z` still returns 404 for
both reviewed `@smthrs/control@1.0.0-rc.0` and
`@smthrs/engine-store@1.0.0-rc.0`; the exact results are retained in
`snapshot-89-runtime-registry.json`. No runtime dependency or replacement
scheduler was introduced. Production host packaging, conditional effect
adapters, bounded appended rounds, history, default migration and the separate
cleanup-completion decision remain unfinished. The latest-Go compiler priority
is qualified; the overall alpha-0 goal is not complete.

### Compiler preparation ownership — September 8, focused checks green

The review's stale preparation-lock finding is reproduced: a real killed owner
leaves the old mkdir lock behind, and a fresh process cannot acquire it. Two more
ownership regressions are independently reproduced: a pre-cancelled request
acquires a free lock, and repeated release can delete the successor's lock.
The old-code results remain in `preparation-lock-before.log`.

Preparation now holds an OS file lock, keeps its path/inode in place, observes
cancellation before granting ownership, and closes its descriptor exactly once.
Waiters cannot unlock another handle's lock. A separate `v2` cache layout leaves
all old cache bytes and legacy ownership evidence untouched. Mixed source
checkouts still refuse; this is not automatic repair after interrupted patching,
a distributed lease, or a replacement durable scheduler. Compiler ABI 52, its
native source pin and compiled language behavior are unchanged.

All eighteen focused tests/subtests pass under `-race`: cancellation, repeated
release, file preservation, independent locks, 96 contended acquisitions,
invalid/special paths, normal and killed owners followed by another process,
the real native cache migration, overlap refusal and existing same-cache cold
builders. The first expanded run's sole failure was a test assertion comparing
macOS `/var` and `/private/var` path spellings; canonicalizing the assertion's
cache root fixes it without changing production path handling. Windows/amd64
and Linux/arm64 test binaries cross-compile. A Docker client is installed but
its local daemon is absent; no Linux/Windows execution result is inferred from
those compile checks, and no VM/container runtime was started or installed.

Evidence: `preparation-lock-first.log`, `preparation-lock-second.log`,
`preparation-lock-third.log`, `preparation-lock-windows-cross.log` and
`preparation-lock-linux-cross.log` under the verification directory above,
with actual exit records. No runtime dependency, conformance expectation or
known-difference baseline changed. Five repeated race-detector runs also pass
(`preparation-lock-repeat.log`, 20.158 seconds), followed by the package rebuild
(`preparation-lock-build.log`). Its native executable SHA-256 remains
`00e66c591f6f79239199f9d2bb6906740b821e2a81758e5663065e2a67def5b2`, identical
to snapshot 89's qualified artifact. The fresh upstream output still matches
the pin at `2026-09-08T20:30:50Z`. Snapshot 89 remains historical; full release
qualification is still required for this preparation change.

### Snapshot 90 refusal and native request transport — September 8

Snapshot `/tmp/vibelang-alpha0-release.4Smv90` has 2,308 inputs, digest
`1095471351678d2d2b3a76cebd9a68aee1e27d2df6c4e77c41cc47fceeb860bd`.
Its serial release runs from `20:31:50.918Z` to `20:52:35.537Z` and exits **1**.
The main suites pass: 417 Node (zero skips/todos), 5,225 Bun (the one existing
credentialed live-model skip), and 4,647 Go (zero skips). The unchanged 554-case
CLI differential also passes its exact recorded baseline. The installed Node
consumer then times out in `restoreAuthenticatedKeyedInvocation` while verifying
a Plan. Packaging is not qualified and the docs build is not reached. The final
input audit finds no changed, missing or added input. Evidence remains in
`snapshot-release-90.log`, its actual result record and
`snapshot-90-final-input-audit.json`.

A focused package diagnostic reproduces the timeout on the same 11,058-byte
request, while two later focused package measurements pass. These are diagnostic
results, not a repair or a replacement release certificate. Standalone native
verification of the captured input succeeds, including 300 synchronous calls.
Mixing real Deno sandbox completion with the same calls reproduces the stall.
Live samples and descriptor tables show Go sleeping in its stdin socket read
while Node waits in its synchronous process loop; the parent still owns the
input socket's write endpoint. Deferring the call with `setImmediate` still
fails. A newer Node 22.19 control passes, but no specific upstream fix is claimed.

The SDK now stages a complete private request file, opens it read-only and
passes that finite descriptor as stdin. Non-Windows hosts unlink the file and
directory before spawning; Windows cleans up after completion. Every ordinary
exit path closes the descriptor, including timeout, backend failure and thrown
spawn errors. Staging errors do not spawn a child or invoke a fallback. The
protocol, native executable and deadlines do not change. On the failing Node
22.12 runtime a raw file-backed control passes 500 real sandbox executions and
5,000 native calls with 256 KiB padding. The first twelve built-SDK transport
checks pass; the eleven new transport-property checks fail against the previous
build, while the large-response control passes. Expanded regressions, an actual
SDK stress measurement and a fresh full release remain required.

Diagnostic evidence is in the verification directory's `preparation-lock-mixed-*`
logs and `native-file-transport-*` logs. The captured request, process samples and
descriptor tables are under `/tmp/vibelang-native-timeout-diagnostic.1raGk7`.
The first transport-test draft used the wrong transpile request shape; that
test-only mistake was corrected before the old/new comparison and is retained
in `native-file-transport-before.log`. The corrected comparison is
`native-file-transport-before-second.log`, and the rebuilt twelve-check pass is
`native-file-transport-after.log`. This changes neither durable scheduling nor
the unresolved runtime-packaging decision.

The expanded transport set passes all fifteen tests, including a real child
timeout/kill, preparation failures and mixed Deno/SDK work
(`native-file-transport-expanded.log`). The first actual-SDK 500-round stress
attempt stops on `SandboxProtocolError: Sandbox exited without a result`, not a
native request timeout (`native-file-transport-sdk-stress.log`). This run did not
capture the sandbox exit status and its cause remains unclassified. A traced
500-round run then passes all 5,000 SDK calls; a later traced run with the runner
fix below does too (`native-file-transport-sdk-stress-traced.log` and
`native-file-transport-final-stress.log`). All native calls retain their original
deadline. No request is retried in those measurements.

Review of the runner independently finds a deterministic framing defect:
[`Deno.stdout.write`](https://docs.deno.com/api/deno/io/#Deno.stdout) may consume
only part of a buffer, but the runner assumed every call completed its whole
JSON-line message. The runner now drains each frame before advancing its write
queue and rejects nonpositive, fractional, nonfinite or excessive progress.
Real Deno fixtures with forced short writes preserve UTF-8, ordered logs, a host
RPC, success and failure frames. Eight regression cases fail with the original
runner while the full-write control passes; all nine now pass. The initial
fixture mistakenly expected an ordinary-prototype object instead of the
boundary's null-prototype record; that test assertion was corrected, and the
old/new comparison rerun without changing the boundary representation.
Evidence: `runner-short-write-before-second.log` and
`runner-short-write-after-second.log` (24 combined Node tests). The separate
171-test native Bun group passes in `native-file-transport-bun.log`. The short-
write fix is not claimed to establish the cause of the earlier uninstrumented
sandbox exit.

### Current upstream refresh — September 8, qualified by snapshot 91 below

The current revision is `10404f71a8675a010ca6431698c8d7ee80bbcd39`, measured
from `microsoft/TypeScript` at `21:36:44Z`. Compared with snapshot 89's pin,
[`ee72eb0`](https://github.com/microsoft/TypeScript/commit/ee72eb0e4)
adds TS1558 in the native grammar checker for readonly ambient import attributes;
[`10404f7`](https://github.com/microsoft/TypeScript/commit/10404f71a8675a010ca6431698c8d7ee80bbcd39)
extends upstream's JavaScript API generator helper. This project uses the Go
compiler, not that API helper. No VibeLang parser patch changes.

The source manifest, Go constant, series manifest and verified offline capsule
agree. All five patch contents, 24 pre-images, 27 post-images and 22 Go dependency
versions are unchanged. Pristine and patched compiler/project/language-service
health selections pass (21 packages each; binder has no runnable tests).
The exact new upstream baseline and all six of its child checks pass on both
trees. All eight generated files reproduce, and reversing the patches leaves a
clean checkout before successful reapplication. An attempted redundant apply
correctly refuses because `record` already applied the series; that diagnostic
is preserved, not counted as successful application.

Source: `/tmp/vibelang-upstream-10404f.PeR0C6/typescript`; patched checkout:
`/tmp/vibelang-upstream-10404f.PeR0C6/compiler/10404f71a8675a010ca6431698c8d7ee80bbcd39`.
Evidence is in the verification directory's `upstream-10404f-*` logs. The
native rebuild and added delivery-profile regression are recorded below; a
fresh frozen full release is still required. This pin refresh and the transport fixes do not settle
production durable-host packaging, rounds, history or the remaining defaults.

The first build correctly refuses an untracked `node_modules` symlink used only
for regeneration. After verifying its exact target, only that temporary link
is removed; its dependency directory remains intact. Patch reversal then leaves
an entirely clean Git checkout and reapplication succeeds. The final native
build passes with Go TypeScript `7.1.0-dev`, API 52, executable SHA-256
`59f96841c16c6ef7f4b73bcd175ac86e687cd2e81886769c10bb73faf7f5ce8f`.

The added upstream diagnostic regression initially used a module option outside
the VibeLang profile and then omitted its default declaration-checking exemption.
After correcting those fixture settings, explicitly requesting `skipLibCheck:
false` exposes a real Go adapter defect: its permitted-options table includes
the option but compilation rejects it as VIBE6003. The compatibility specification
requires that option to remain configurable. The native adapter now accepts
both boolean values and preserves its existing `true` default. Eighteen Go
tests/subtests pass across both delivery profiles, the new TS1558 behavior,
other malformed modifiers, valid controls, explicit/default declaration checking
and five malformed option values. No new parser rule, diagnostic code or default
is introduced by this adapter fix. The initial failures remain in the numbered
`upstream-10404f-delivery-diagnostic*` logs; the fourth run is the passing one.

The final package rebuild and focused installed Node/Bun verification pass
(`upstream-10404f-build-final.log`, `upstream-10404f-package-final.log`), with
568 files, 537 generated files and 24 exports. Package SHA-256 is
`858de42d9b7c80fd4fe32448c654b4e71404136115a2419f9213bbb080403a2a`;
inventory SHA-256 is
`3340efacf1f66e0b41dabb4189239e9bb3a28b42f9aaf505f321c1e37c504328`.
The new pin also passes all 24 combined transport/runner checks. A fresh upstream
measurement still matches at `2026-09-08T21:59:54Z`. These focused results do not
reclassify snapshot 90's failed release or qualify a different frozen input set.

The final native SDK/configuration selection passes 175 Bun tests with no skips
or failures. The pinned upstream comparison passes all 141 data cases, 39 source
Plans and six ordered-value cases. All nine documented programs also pass
(six keyed Plans, two checker examples and one explicitly historical body).
Evidence: `upstream-10404f-bun-final.log`, `upstream-10404f-oracle-final.log` and
`upstream-10404f-docs-final.log`, each with its actual zero-exit record. No corpus
expectation or known-difference baseline was changed for this qualification.

### Full release checkpoint — September 8, snapshot 91

The serial `release:verify` run exits **0**, from `22:02:31.722Z` to
`22:23:56.743Z`. Snapshot `/tmp/vibelang-alpha0-release.8jiO9i` contains 2,311
inputs with manifest SHA-256
`b9fe709f8763e940db0fe29825b6990a13e3e3fba1ce0c65096eb1d35bcfa56d`.
Every live input still matches at completion, with no additions, deletions or
content/mode changes. Only the three implementation-status records change
after that audit.

- Node: 441 pass, zero failures/skips/todos, 187.205 seconds.
- Bun: 5,225 pass, zero failures/todos, the one existing credentialed live-model
  skip; 33,805 assertions across 238 files, 547.33 seconds.
- Go: 4,665 tests/subtests pass, zero failures/skips; compiler package 423.104
  seconds, all four packages pass.
- Shared corpus: native SDK 553/554 with one expected failure; standalone
  540/554 with fourteen expected failures; six ordinary TypeScript interop
  cases pass in each profile. No unexpected failure or fail-open allowance.
- CLI differential: all 554 cases measured, with exactly the existing twenty
  differences (zero product-only acceptance, two refusals, eighteen diagnostic
  differences). No baseline or expectation was weakened.
- Package: deterministic clean rebuilds and fresh installed Node/Bun consumers
  pass, including the previously failing Plan restoration path. The archive has
  568 files, 537 generated files and 24 exports. Its SHA-256 and inventory
  SHA-256 exactly match the focused package result above.
- Docs: production build passes, 85 files generated. All nine complete programs
  already passed separately against these unchanged compiler/docs inputs.

Evidence: `snapshot-release-91.log`, its actual result record,
`snapshot-91.json` and `snapshot-91-final-input-audit.json` in the verification
directory. The source pin still equals upstream `main` at
`2026-09-08T22:24:10Z`. The native artifact is Go TypeScript `7.1.0-dev`, API 52,
with the executable digest recorded above. Snapshot 90 remains failed; a green
run does not establish the cause of the earlier uninstrumented sandbox exit.

A read-only dependency audit also distinguishes the product from the separate
website toolchain. No compiler-library import remains in our implementation;
the matching `require("typescript")` source text is a negative asset fixture.
The docs project retains TypeScript 6 as a Vocs/Twoslash dependency and a
transitive optional TypeScript 5 dependency in Alchemy's tooling. The site has
no Twoslash blocks; Vocs' compiler load is lazy. Those third-party tools were
not ported or removed, and no blanket claim that every development dependency
is Go-only is made. The language and documented-program checker use the native
compiler; the installed product has no TypeScript compiler dependency.

The reviewed `@smthrs/control` and `@smthrs/engine-store` packages still return HTTP 404 at
`2026-09-08T22:23:44Z` (`snapshot-91-runtime-registry.json`). No runtime was
vendored and no production dependency was added. Production durable-host
packaging, conditional effect hosting, bounded rounds/re-approval, history,
remaining defaults and cleanup-completion precedence remain open. The
latest-Go compiler priority is qualified; the end-to-end alpha-0 goal is not
marked complete.

### API 53 bundler delivery and newer upstream — focused, qualified by snapshot 93 below

The shared Go-backed CLI pipeline now supports an in-memory publication sink
and the single `vibelang/unplugin` factory. Its nine real host adapters compile
and execute a multi-module propagation program. Watch tests cover changing
callee requirements, comptime inputs, missing asset/embed/package-declaration
creation and Vite declaration refusal/recovery. Native analysis and generated
checking expose bounded, opt-in disk dependency inventories. Failed host reads
are observable for rebuilding without changing cache identity or granting new
sandbox authority. Successful ancestor-directory probes do not become recursive
watch roots. Vite polls only the bounded dependency inventory, invalidates the
checked graph and requests full reload; this does not promise state-preserving HMR.

The upstream pin is now `bf7f49d6f5ad3254d03ed83dd07ab510ae4e582a`, measured
at `2026-09-09T00:01:28Z`. The one added commit separates upstream VS Code
extension releases. Compiler sources, Go dependencies and generator inputs are
unchanged. All five patch contents, 24 pre-images and 27 post-images remain
identical; all eight generated files reproduce exactly. Pristine and patched
health selections pass, patch reversal leaves a clean checkout, and reapplication
and the native package build pass. Only the TypeScript bundle changed among the
capsule payloads. No upstream release/publish workflow was executed.

Focused refreshed-pin verification passes 120 Node tests, including 58 new
pipeline/plugin/actual-host tests, 187 SDK/build tests with 633 assertions,
and 84 Go tests/subtests. No selected test is skipped. The package's public
plugin handles no longer import all optional hosts' declaration trees; the
earlier API 53 strict installed Node/Bun consumer check passes. At this focused
checkpoint a full release was still necessary for the final bytes. The all-nine-host
assignability fixture excludes third-party declaration defects only; our
installed declaration closure is still checked with `skipLibCheck:false`.

Intermediate failures remain evidence, not green runs: webpack's canonical-ID
recursion, overbroad directory watches, Farm's load-map transport, Vite's browser
URL and negative-probe handling were repaired and rerun. Farm 1.7.11 library
mode still omits final maps even for an ordinary-JavaScript control; its normal
Node mode retains the authored maps. Esbuild's omitted/false bundling modes
first failed two refusal regressions by silently publishing uncompiled module
imports. Both now refuse explicitly; `vibe compile` owns unbundled emission.
The new-pin checkout/vendor race, missing generator-tool run and temporary
generator-symlink build refusal are also retained; subsequent clean runs pass.

The rebuilt compiler is Go TypeScript `7.1.0-dev`, API 53, executable SHA-256
`4452cdfbd2f602f28aa3498a622f7f43fff6091bc0bf831b8de02a9de30aaaf5`, patch-series
digest `5315e3d454d9a7c5237ec0077f039ebffd9a5d6efd06f83c49bc1a3f632328db`.
Evidence is the `upstream-bf7f49-*` and `plugin-*` logs with actual result
records in the verification directory recorded above.

Node's minimum is 22.12.0 and Bun's plugin/CI minimum is 1.2.22. The runtime
dependency is unplugin 3.3.0; actual hosts are pinned development-only tests.
Browser runtime support and production durable Plan hosting are not implied.
The new plugin refuses `vibelang:flows` rather than emitting the withdrawn
ordinary-body profile. Snapshot 91 still qualifies only its own API 52 inputs;
this complete changed input set required its own frozen serial release certificate.

Snapshot 92 fails its full release at the Node gate: 498 pass, one brand-gate
failure, zero skips/todos. Its new status note repeated the historical temporary
directory spelling without identifying it as historical. The redundant path is
now replaced by a reference to the already recorded directory; no brand rule or
test allowance changed. All 2,323 live inputs match the failed snapshot before
this correction. Evidence: `snapshot-release-92.log` and
`snapshot-92-final-input-audit.json`. The later suites did not run and are not
reported as passing. A fresh complete release was required for the correction.

### Full release checkpoint — September 9 UTC, snapshot 93

The complete serial `release:verify` exits **0**, from `00:26:59.919Z` to
`00:49:01.840Z`. Snapshot `/tmp/vibelang-alpha0-release.tXysyx` contains 2,323
inputs with manifest SHA-256
`f1d24f0c6ef8cb7563c3e9226c27c1c165df6460b51ba2a2aae0e1aae3e4c3a7`.
All live inputs match at `00:49:21Z`, with no additions, deletions, content or
mode changes. Only the three implementation-status records change after that
audit. Snapshot 92 differs only in those records and remains a failed release.

- Node: 499 pass, zero failures/skips/todos, 193.429 seconds.
- Bun: 5,279 pass, zero failures/todos, the one existing credentialed live-model
  skip; 33,901 assertions across 240 files, 565.21 seconds.
- Go: 4,691 tests/subtests pass, zero failures/skips; compiler package 428.662
  seconds, all four packages pass.
- Shared corpus: native SDK 553/554 with one expected failure; standalone Go
  540/554 with fourteen expected failures; six ordinary TypeScript interop
  cases pass in each profile. No unexpected failure, unmeasured case or
  fail-open marker.
- CLI differential: 554 measured cases, exactly the existing twenty differences:
  zero product-only acceptance, two refusals and eighteen diagnostic differences.
  No expectation or baseline changed.
- Package: two deterministic clean rebuilds and fresh installed Node/Bun
  consumers pass, including strict public plugin declarations. The archive has
  578 files, 545 generated files and 25 exports. SHA-256:
  `ad877fd2ad35242f3f2d529b4c154bc643c8c271e7e367a916cacb0971a59544`.
  Inventory SHA-256:
  `b0f43d38c1ee2e1beaca56831c56159a1ac7e25bf06aca195918586497abf5d0`.
- Docs: production build passes, 87 files generated. This is build evidence,
  not a claim of new browser-runtime support or durable-host completion.

Evidence: `snapshot-release-93.log`, its actual result record, `snapshot-93.json`
and `snapshot-93-final-input-audit.json` in the recorded verification directory.
The qualified native artifact remains Go TypeScript `7.1.0-dev`, API 53, with
the executable and patch-series digests above. Failed intermediate runs and the
earlier uninstrumented sandbox exit retain their original status.

The post-run upstream measurement at `00:49:22Z` finds one newer commit,
`fe5d056f0cb291a8552081f8407abe0455b5be8f`. Its nine files change TypeScript
API generator support and benchmarks only; this product uses none of that API.
The complete changed-path inventory and a separate zero-difference check confirm
that `tsc/`, the compiler's generator inputs, generated AST/protocol files, Go
workspace and dependency/build metadata are unchanged. Evidence:
`snapshot-93-upstream-pin.log`, `upstream-fe5d05-delta.log` and
`upstream-fe5d05-compiler-inputs.log`, with actual command results. The qualified
pin remains `bf7f49d6`, not the newer repository HEAD. This preserves the exact
tested artifact while retaining the newest measured Go compiler sources.

The runtime registry still returns 404 for both reviewed packages at
`2026-09-09T00:31:44Z` (`snapshot-93-runtime-registry.json`). No production runtime
was vendored. Production Control/scheduler/journal delivery, conditional effect
hosting, bounded rounds/re-approval, history, remaining defaults and the
independent cleanup-completion precedence decision remain unfinished. The
compiler migration and this bundler delivery are qualified; alpha-0 is not
marked complete.
