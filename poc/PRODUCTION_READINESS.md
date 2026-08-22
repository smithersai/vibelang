# Production-readiness contract

This file is the executable scope and release audit for the second VibeLang
prototype. The decision ledger wins over older specification prose when they
conflict. A checked box requires direct evidence from source, tests, emitted
artifacts, or a real process boundary; a plausible implementation is not enough.

## Release definition

The prototype is release-ready as architectural evidence when one
coherent toolchain can compile and run representative `.vibe` applications,
reject unsafe or unsupported programs deterministically, and exercise the
highest-risk runtime boundaries with restart and adversarial tests. It does not
claim native-code, distributed-cluster, or full TypeScript-corpus conformance
until those backends exist.

Every intentionally deferred surface must fail closed with a stable diagnostic;
it must not silently emit code with different semantics.

## Required executable surfaces

### Compiler and compatibility

- [x] Parse `.vibe` with the current TypeScript-derived grammar and preserve
  unchanged shared TypeScript syntax.
  Evidence: `language.test.ts` checks byte-for-byte passthrough for an unchanged
  TypeScript function and deterministic migration errors for every retired
  spelling represented in the current frontend.
- [ ] Keep imported `.ts`, `.tsx`, `.js`, and `.mjs` syntax and runtime behavior
  at an explicit interop boundary.
  Open: the root project graph now recursively stages `.ts`/`.tsx`/`.mts`/
  `.cts`/`.js`/`.jsx`/`.mjs`/`.cjs`, rewrites static imports/re-exports and
  allowed literal dynamic/`require` edges, erases checker-resolved type-only
  closure, preserves ESM/CJS outputs by the bounded extension policy, and emits
  optional declarations/maps without executing the graph during build. Root,
  UTF-8/size/count, real-file identity, ambiguity, unsupported edge, collision,
  and no-write gates have an execution matrix. Full conformance remains unmet:
  `.js`/`.jsx`/`.ts`/`.tsx` are deliberately ESM in this POC, JSX/CJS
  declaration inference uses a provisional facade, bare packages remain
  external, rewritten foreign columns are conservative, and no upstream
  TypeScript/Node package-mode corpus has been run.
- [x] Lower compiler-created `Result` and `Optional` variants, propagation, and
  control-flow exits without executing user code during compilation.
  Evidence: the language suite checks Result/Optional lifting, explicit failure
  and success constructors, Result and Optional unwrap early returns (including
  outside-in `Result<Optional<T>, E>` owners), JavaScript `try` preservation,
  recursive loop-body lowering, and hard errors for unsafe placements. An
  independent red-team found `Optional.unwrap()` and `Result.expect()` were
  previously recognized but silently unlowered/uncharged; Optional unwrap now
  lowers through `__vsInspectOptional` in the same statement-safe placements as
  Result unwrap, `expect` charges the distinguished Panic row, and unsupported
  placements fail with `VIBE1206`/`VIBE1205`.
- [x] Infer recoverable Error unions and nominal Context requirements through
  local and cross-module calls; preserve them in diagnostics/declarations.
  Evidence: one Program propagates concrete rows through relative imports,
  aliases, namespaces, and cycles. Declaration emission retains Result contracts
  and appends strict versioned `@vibeEffects` metadata decoded by the public
  language API. Generic success values now cross modules when their failure and
  requirement rows are concrete; type-parameter-dependent failure rows still
  fail closed. The tag remains an explicitly unstable interchange experiment.
- [ ] Reject discarded Results, unconsumed Promises, Promise instance chaining,
  ambient host authority, unsatisfied Contexts, and unsafe native pins.
  Open: Result/Promise consumption, Promise chaining, common host globals,
  missing Contexts, and project portability/native pins have focused
  diagnostics before emit. Must-consume analysis is conservative rather than a
  path-sensitive ownership proof. Checker-resolved ambient clock and entropy
  operations are handled differently by the two analyzers, and the difference is
  deliberate: the target classifier reports them as `Clock`/`Random`
  requirements, while the language frontend rejects them outright with
  `VIBE1602`/`VIBE1603` and leaves the row empty. Lexical shadows remain
  ordinary values in both. Nominal `Capability.context()` rows now agree
  exactly between the frontend and the classifier — the classifier previously
  reported no requirement at all for a capability read, which under-reported
  `vibe inspect` portability and native-pin dependency paths. A complete host
  API classification table is still open, as are higher-order, method, and
  generic capability receivers, which both analyzers under-report.
- [ ] Treat every untrusted JS/TS runtime call as checked `panic` unless trusted
  `@throws {never}` or more precise `@throws {T}` metadata says otherwise.
  Open: direct/aliased/namespace calls, methods, immutable literal storage, and
  explicitly unwrapped factory results have checker-resolved tests, including
  contract-violation `Panic`. Unannotated accessors and constructors, raw
  method extraction, nested factory calls, mutable/opaque stores, and escaping
  callbacks now fail closed with `VIBE1504`/`VIBE1506`-`VIBE1509`. Complete
  arbitrary-heap and higher-order provenance is still not proved, so “every”
  remains an intentionally unmet soundness claim. Static foreign module
  initialization cannot be caught by a call wrapper, so runtime imports now
  fail closed with `VIBE1510` unless the target begins with JSDoc containing
  both `@module` and `@throws {never}`. Type-only/compiler-intrinsic imports are
  exempt; a trusted async foreign adapter can defer dynamic loading into the
  ordinary checked rejection boundary. This is a provisional trust claim, not
  proof that arbitrary module initialization is safe.
- [x] Emit valid TypeScript/JavaScript, declarations, source maps, deterministic
  diagnostics, and collision-free helper imports.
  Evidence: the no-write project compiler shares semantic models, rewrites
  `.vibe` module edges, stock-checks the whole generated project, emits `.mjs`
  plus `.d.mts`, composes JavaScript maps to authored source, tests helper/output
  collisions, and stages the complete validated file set before commit. Version-3
  maps preserve exact UTF-16 positions for unchanged text, conservative
  token/AST provenance for transformed text, explicit unmapped generated spans,
  embedded authored content, and multi-source composition under deterministic
  size/work bounds. Final project commit rejects a pre-existing symbolic-link
  ancestor beneath `--outDir`, so a nested source path cannot redirect emitted
  bytes outside the requested output tree.
- [ ] Fail closed for every current grammar/checker surface that cannot yet be
  lowered correctly.
  Open: retired syntax, unsupported expression control flow, unsafe unwraps,
  repeated loop headers, imported constructors, unsafe deferred cleanup, and
  opaque Layers fail closed. A bounded executable `defer`/`errdefer` lexical-tail
  lowering now exists, including provisional LIFO behavior and narrow async
  cleanup. A red-team pass closed several previously silent surfaces: top-level
  `throw` (`VIBE1511`), class `static {}` blocks (`VIBE1107`), panic/unwrap
  inside a JavaScript `catch` scope (`VIBE1205`), a missing-parse-diagnostics
  internal seam (`VIBE1002`), and prefix-based `vibelang*` specifier trust (now
  exact `vibelang`, `vibelang/`, or `vibelang:` only); the retired-syntax
  scanner no longer rejects member-access `Result.try(...)`. Ambient ECMAScript
  builtins that can throw (`JSON.parse`, `new RegExp`) remain classified with
  the open host-API table, and the unresolved foreign-provenance and
  whole-program gaps above still prevent a complete fail-closed claim.

### Runtime

- [x] Provide hardened `Result` and `Optional` values with non-forgeable local
  identity, complete combinators, immutable variants, and explicit wire codecs.
  Evidence: frozen WeakSet/WeakMap-backed variants and the accepted POC
  combinator set have adversarial tests. Strict canonical, size/depth-bounded
  Result and Optional envelopes use compiler-supplied value codecs and validate
  decoded Error channels. Additional convenience methods remain API direction.
- [x] Provide stable nominal Error identity and exhaustive-shaped matching
  without trusting `_tag`, constructor names, or mutable payload fields.
  Evidence: runtime tests cover constructor/prototype registration, forged tags,
  names, symbols, hostile `Symbol.hasInstance`, strict codecs, and exact decoded
  prototypes; language tests cover nominal exhaustive lowering.
- [x] Provide checked `panic` construction, foreign sync/async boundary
  adapters, propagation, explicit recovery, and cause preservation.
  Evidence: runtime tests exercise sync and async foreign adapters, mapper
  validation, distinguished-panic-only recovery, ordinary exception escape, and
  cause/root-cause behavior.
- [x] Provide typed `Context.context()` lookup and async-safe nested Layer
  environments with deterministic merge/override behavior.
  Evidence: overlapping asynchronous scopes remain nominally isolated; forged
  Layers, duplicate merges, and unspecified nested overrides fail closed.
- [x] Keep Layers lean: they own neither resources nor child work, remain active
  only through the returned body Promise, and expose no implicit detach path.
  Evidence: the base public type is only `Layer<Provides>` and runtime values
  contain only capability implementations; duplicate
  merge/override semantics fail closed; Node uses a synchronous V8 Promise
  settlement hook so earlier-registered reactions cannot observe stale
  authority; pre-existing Promises fail closed; detached callbacks cannot look
  up capabilities after the returned boundary. Hosts without an exact
  settlement hook, including the current Bun runtime, reject async
  `Layer.provide` rather than approximating the lifetime. Authored `.vibe`
  separately rejects evident detached Promise work.
- [ ] Require every Promise started by authored `.vibe` to be consumed directly
  by `await` or by a recognized combinator whose returned Promise is consumed.
  Open: obvious calls, variables, `new Promise`, and recognized combinators are
  checked, but the analysis is single-file and not path-sensitive or an
  ownership proof.
- [x] Provide cancellation and bounded join/iteration helpers that clean up
  their own work without introducing a universal fiber runtime.
  Evidence: seven concurrency tests cover nominal cancellation transport,
  tuple joins, bounded unordered mapping, early-break cleanup, mapper failure,
  parent cancellation, and cancellation of a pending async iterator pull.

### Comptime, assets, and targets

- [x] Resolve compiler intrinsics by imported symbol identity rather than local
  spelling; uncompiled virtual-module execution must fail before evaluating
  arguments.
  Evidence: `compileComptimeIntrinsics` builds one checker Program, recognizes
  direct/aliased/namespace compiler imports across files, statically decodes a
  bounded canonical subset without module evaluation, rejects spelling-only or
  higher-order uses, and publishes a top-level-throw runtime guard. The root CLI
  runs this pass before every project command, composes its maps, retains
  provenance, remaps later diagnostics, and emits nothing on failure.
- [x] Execute comptime and third-party loaders in a deterministic, bounded,
  authority-controlled process rather than a trusted ambient callback.
  Evidence: sandbox factories have entropy, filesystem, timeout, memory,
  request, output, and RPC tests. `AssetCompiler.register` now authenticates
  custom loaders created by `createSandboxedLoader` by default, while compiler-
  owned built-ins remain in process. An explicitly unsafe test/migration option
  is retained and is not used by the production-facing examples; Deno process
  isolation is not claimed to be container/VM attestation.
- [x] Support JSON, const JSON, text/Markdown, MDX, and custom loader output with
  checked module IR and source-located diagnostics.
  Evidence: built-in loaders cover those formats (plus bytes); the agent demo
  consumes the MDX loader; custom output is stable-cloned and its module shape,
  TypeScript/declaration syntax, diagnostic offsets, and span bounds are
  validated before caching.
- [x] Compile static attributed source-asset imports into trusted runtime modules
  without evaluating authored code, and use the same graph in every project CLI
  command.
  Evidence: `compileSourceAssetModules` bounds authored input before parsing;
  rejects missing/legacy/dynamic/type-only/re-export import shapes,
  root/symlink/hard-link/code-identity aliases, attribute conflicts,
  prototype-mutating literals, and executable/generated allocation output; and
  reconciles the canonical device/inode/size/timestamps after loader execution
  before granting nominal compiler provenance. `compile`, `check`, `inspect`,
  `run`, and `test` consume that exact
  issued module set; generated JavaScript gets deterministic paths, declarations,
  maps, cache replay, and compiler-mapped AST attribute removal. Failed batches
  commit no project files and `--noEmit` creates no output tree. General asset
  re-exports, dynamic imports, nested loader module graphs, and unified
  incremental scheduling remain deferred.
- [ ] Key every build node by compiler/loader artifact, immutable options,
  target, source bytes, real-path authority, transitive dependencies, and
  verified output digest.
  Open: AssetCompiler and ComptimeCompiler have cache-poisoning, option-snapshot,
  real-root, dependency, implementation, and output-digest tests. AssetCompiler
  additionally uses one immutable canonical-file snapshot per top-level build,
  rejects mid-read changes and hard-link aliases, applies explicit per-file,
  graph-file, graph-byte, and cache-entry limits during both execution and
  cache validation, carries the source snapshot's inode ownership through cache
  checks, rejects noncanonical/cache-owned dependency metadata, excludes its
  cache from loader authority, and declines oversized cache writes without
  changing a valid build result. The foreign node now independently snapshots
  an authorized bounded source tree, keys explicit sanitized environment and
  compiler executable content/version/build profile, and treats bounded
  no-follow cache objects as untrusted. These remain separate implementations
  rather than one compiler-owned graph.
- [x] Derive durable Action and static Flow validators/codecs from
  compiler-owned structural descriptors and reject unsupported or non-durable
  types explicitly.
  Evidence: `compileActionContract` resolves compiler-owned `Action` and
  `Result` symbols before erasure, emits type-sensitive canonical descriptors,
  and generates checked virtual Action declarations. Input, success, Error
  payload, worker-exit, replay, and cache boundaries are independently
  validated. The bounded descriptor supports scalars/literals, arrays, tuples,
  exact optional objects, unions, and nominal Error payloads; functions,
  capabilities/classes, `any`, `unknown`, nested Promises, generics, recursion,
  indexes, and budget excesses fail closed. Static Plan IR also carries derived
  Flow input, projected success, and reachable Action-error schemas; the engine
  validates them before execution creation, terminal commit, and replay. The
  Error envelope and descriptor format are explicitly provisional, and a
  shared descriptor across every compiler subsystem is still future work.
- [ ] Build real Zig/Rust source to typed Wasm artifacts with toolchain and full
  discovered dependency identity represented in the graph.
  Open: ten tests build and instantiate real Zig/Rust Wasm, verify caching and
  snapshot isolation, invalidate Rust and Zig embedded dependencies, separate
  explicit-environment and executable-content identities, reject source-root
  and file-count excesses, treat symlinked/oversized cache state as a miss, and
  kill a timed-out process group. ABI and dependency discovery remain
  regex-based; compiler standard-library/resources and subordinate tools are
  trusted rather than fully content-snapshotted, so complete toolchain metadata
  is deliberately not claimed.
- [ ] Classify TypeScript-only, portable, and forbidden operations using checked
  symbols/data flow, including transitive native-pin diagnostics.
  Open: checker-symbol tests prove lexical shadowing, type/runtime imports,
  `any`, `eval`, host modules/globals, and cross-module direct-call propagation.
  Project `check`/`compile`/`run`/`test` now invoke the analysis and reject an
  unsafe native pin before emit. The analyzer still covers only top-level
  functions and direct-call set propagation, not complete data flow, provider
  closure, or the still-open full feature table.

### Durable execution

- [x] Compile statically resolvable `durable(function)` bodies into standalone,
  versioned Plan IR without invoking the function or Action implementations.
  Evidence: `compileDurableSource` resolves `vibelang:flows` and Action aliases by
  checker identity, lowers a bounded const/literal/projection/Action subset plus
  conditional, timer, provisional typed external-signal, stable-key fan-out
  (single-Action or a bounded block sequence of at most 16 steps), provisional
  `sequential(...)` control edges, attached child Flows with embedded
  digest-pinned Plans under a depth budget of 8, and provisional
  `loopWhile(...)` round templates under a static literal budget, produces
  stable semantic node IDs and canonical artifacts emitted at the minimal Plan
  format version, and
  executes through supplied providers while top-level authored throws and Action
  implementations remain untouched during compilation. Unsupported control
  flow fails with `VIBE41xx` diagnostics. Action descriptors are supplied
  through an explicit compiler binding seam. Separately,
  `compileActionImplementationContract` checks a closed `.vibe` implementation
  project, derives transitive `E`/`R`, and pins checked source/project identity;
  `provideChecked`, deployment, and manifest loading require both the exact
  inferred capability grant and exact nominal Action failure schema. `Panic`
  remains a separate defect bit rather than a typed failure. Legacy providers
  cannot receive authority, and legacy Action descriptors authenticate only an
  empty typed row. Opaque in-process callback pairing does not attest lexical
  closures or a remote emitted bundle. The child boundary is bounded further:
  signals inside a child Plan are not addressable through the parent executor's
  delivery handle, child deployments derive from the parent's pools at build
  time and are not separately signed, and loop-budget exhaustion is a modeled
  terminal defect rather than a nominal Error-row failure. This is programmatic
  POC evidence; final counts pending the wave gate.
- [x] Validate canonical inputs, Plan IR, manifests, schemas, provider policy,
  and all persisted/wire values before use.
  Evidence: artifact and durable tests reject aliases, accessors, hidden data,
  noncanonical bytes, incompatible contracts/routes/policies, invalid worker
  values, and persisted digest corruption. New Action contracts use checked
  structural schemas, and compiler-produced Plans include structural Flow
  input/success/reachable-error schemas. Legacy `Flow.define`/`Action.define`
  artifacts retain explicit generic JSON stubs only as a compatibility path.
- [x] Persist lifecycle and journal transitions atomically in SQLite; adopt all
  terminal outcomes and cache hits into run-local state before exposure.
  Evidence: the store co-commits node/cache state and journal entries; focused
  tests cover post-commit coordinator loss, cache adoption, and a losing final
  compare-and-swap adopting the persisted winner.
- [x] Preserve deadlines, retry/backoff state, attempts, leases, fencing,
  cancellation, and pinned artifact/policy digests across restart.
  Evidence: restart, manual recovery, persisted backoff/deadline, busy leases,
  fencing, cooperative abort, cancellation races, and immutable Plan/manifest/
  policy digest tests cover this state.
- [x] Suspend for one schema-checked external signal without holding a worker
  lease, and converge across restart and delivery/coordinator races.
  Evidence: compiler-owned provisional `waitSignal<Payload>("literal.id")`
  emits a statically named Plan node with a compiler-derived structural schema
  and contract digest. Execution initialization pins that contract in SQLite.
  The external POC delivery surface requires exact execution, node, signal, and
  idempotency identity; canonical delivery and consume transitions co-commit
  journal evidence. Tests cover delivery-before-wait, restart, duplicate and
  conflicting deliveries, invalid payloads, deadline/cancellation, skipped
  branches, two coordinators, and forged/corrupt Plan, schema, inbox, and
  delivery evidence. Requests also enforce byte-bounded identities, a 100,000
  durable-JSON node/field traversal budget before canonicalization, and the
  independent 8 MiB canonical wire ceiling before SQLite. The API spelling,
  sender authentication/authorization,
  remote transport, wakeup service, queues/broadcast, and migration remain open.
- [x] Keep run node, downstream idempotency, memo generation, and deterministic
  content identities distinct; detect corrupt or unequal content entries.
  Evidence: the durable demonstration and adversarial tests exercise distinct
  keys, first-success memo, verified content reuse, unequal-content defects,
  corrupt execution/node/journal rows, and fenced cache publication.
- [x] Prove crash/restart and two-coordinator races at every material commit
  boundary with stale-worker publication rejected.
  Evidence: a post-COMMIT fault injector covers execution initialization, node
  claim, retry scheduling, success/failure, memo/content publication, cache-hit
  adoption, branch skip, completion, failure, cancellation, and deadline
  fencing. Restart reopens the SQLite file; independent connections exercise
  two-coordinator/losing-CAS races; stale attempts cannot publish reuse. One
  real subprocess test sends `SIGKILL` immediately after a node-success COMMIT;
  a fresh process adopts the result without invoking a poison provider and
  passes SQLite integrity checking. A red-team pass additionally found that
  DEFERRED read-then-write transactions turned real cross-connection contention
  into unretried `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` throws (reproduced 5/5)
  that the engine recorded as permanent defects; all nineteen store
  transactions now use `BEGIN IMMEDIATE`, verified by a two-connection
  interleaved contention/fencing suite. The rest is deterministic injection,
  not exhaustive OS/database-fault or multi-host chaos testing.
- [x] Emit an inspectable deployment artifact and route through the same worker
  protocol for in-process and isolated implementations.
  Evidence: Plan/manifest/pool artifacts and the exact worker envelope are
  validated for both `LocalWorker` and `DenoIsolatedWorker`. The latter executes
  a digest-pinned artifact in a fresh no-authority process, rejects sandbox or
  artifact identity drift, and persists timeout/hostile-protocol failures as
  defects without cache publication. There is still no tree-shaken bundle
  attestation, authenticated remote transport, or multi-machine worker.
- [x] Authenticate local coordinator admission before any worker construction.
  Evidence: a canonical, domain-separated Ed25519 envelope covers the exact
  validated Plan and manifest, including their pinned coordinator, pool,
  implementation, policy, schema, and grant digests. Verification keys come
  only from an out-of-band trust set. An opaque nominal proof is tied to the
  exact `Deployment.build` object, and the authenticated executor consumes it
  before worker creation. Only `in-process-poc` receives an implicit local
  worker; every other signed sandbox requires an opaque host-issued transport
  token bound to the exact sandbox, and the complete routing set is validated
  before any factory call. Adversarial tests reject raw/mismatched/forged
  factories without invoking them, recomputed unkeyed
  digests, wrong domains/keys/encodings, structural proof/deployment forgeries,
  duplicate or rotated-out trust roots, and oversized envelopes. This is local
  provenance evidence, not lexical-closure/bundle attestation, key custody,
  freshness/anti-rollback, online revocation, remote transport, or sandbox
  attestation; token issuance still trusts the host factory to enforce the
  sandbox it declares.

### Coding-agent boundary

- [x] Render asset-backed prompts, compile generated TypeScript against a
  generated callable surface, and return structured diagnostics for repair.
  Evidence: the end-to-end agent test loads MDX through AssetCompiler, feeds a
  typed diagnostic into a repair turn, compiles the corrected callable surface,
  executes it, and records the turn.
- [x] Run accepted code in a fresh no-authority process with strict JSON RPC,
  bounded input/output, timeout, cancellation, and transport backpressure.
  Evidence: Deno starts with explicit deny flags and a V8 memory limit; tests
  cover timeout, pre/in-flight cancellation, total/concurrent call limits,
  pre-base64 source bytes, JSON depth/node traversal, output/transport limits,
  host-call abort, stdin drain backpressure, and an in-place runner rewrite
  with restored size/mtime. Deno and runner canonical paths, content digests,
  and filesystem identity (including ctime) are pinned before launch. Child
  stdout is additionally metered as raw transport bytes before protocol
  framing, closing a red-teamed host-buffering vector where one enormous
  newline-free protocol line bypassed the per-line output limit until timeout.
- [x] Prevent imports, ambient host access, realm creation, unawaited calls,
  non-JSON values, forged protocol messages, and post-close calls.
  Evidence: compiler-policy and runner tests cover import forms, dynamic import,
  eval/Function/Worker, hidden ambient globals, frozen protocol intrinsics,
  real-clock recovery, non-JSON values, fire-and-forget RPC, malformed/duplicate
  messages, and late completion after close.
- [x] Bind only explicitly passed functions and journal model/source/compiler/
  sandbox/function-surface identities when durable hooks are enabled.
  Evidence: function tables are snapshotted/frozen; turn journals pin full turn,
  model, compiler, sandbox/runner/config, and callable-surface identities with
  SHA-256 artifact/config digests. The journal is now a real SQLite database
  with digest-checked, hash-chained rows and one `BEGIN IMMEDIATE` transaction
  per committed boundary, and a restarted process replays a turn without
  invoking the model or any host function. It remains local to the agent
  library rather than the durable executor's execution store, its rows are
  neither signed nor redacted, and the model behind the typed `ModelAdapter`
  seam is still scripted. This is programmatic POC evidence; final counts
  pending the wave gate.

### Delivery and operations

- [x] Expose the working implementation through the root package and `vibe`
  CLI rather than requiring imports from historical spike internals.
  Evidence: package subpaths export language/runtime/build/target/agent/
  concurrency/durable surfaces; root tests compile, check, inspect, and run a
  `.vibe` fixture through `bin/vibe.js`.
- [x] Keep raw TypeScript CLI/API compatibility paths passing unchanged.
  Evidence: root tests cover CommonJS/ESM TypeScript API identity, aliases,
  tsserver/plugin compatibility, raw `vibec` flags, and TypeScript checking.
- [x] Provide check, compile, run, test, inspect/plan, doctor, and machine-readable
  diagnostics suitable for CI.
  Evidence: `vibe test` compiles real project graphs and executes exported
  `test*` functions in a timeout/output-bounded child with a validated protocol;
  JSON output remains uncontaminated. `vibe plan` emits/returns canonical static
  Plan IR without author evaluation. Other listed commands and stable diagnostic
  codes have root integration tests.
- [x] Ship deterministic package contents with no undeclared runtime files,
  stale placeholders, or examples that claim unsupported behavior.
  Evidence: `verify-pack` cleans both output trees; rejects missing/extra,
  colliding, mis-cased, wrong-mode, or debris files; packs across independent
  clean rebuilds and byte-compares tarballs; checks every export/type/bin
  target; and installs the actual tarball into fresh Node/npm and Bun
  consumers. The 2026-08-21 settled run recorded `vibelang-0.0.1.tgz` with
  SHA-256
  `c6dead3636a67dd37a8b8a487197e321ceeb357c81917e38844797e2dbf658eb`,
  inventory SHA-256
  `0077e1421236482337e2e3ea5661c5b9ebdaec1bf2118f63904f4dea620359d9`,
  332 files (286 generated), and 39 exports, with Node and Bun consumers and
  the no-`skipLibCheck` public type consumer green. A release audit of the
  verifier itself first fixed a macOS-fatal tmp-workspace realpath mismatch, an
  unenforced copy-overwrite guard, an unreachable `npm audit` failure message,
  and a consumer `lib` missing `ESNext.Disposable` that the packaged
  TypeScript 7 unstable declarations require; any later source or script edit
  supersedes this hash. Earlier checkpoints are superseded and must not be
  cited.
- [ ] Pass typecheck, unit, adversarial, end-to-end, restart, package-install,
  and documentation build gates from a clean temporary project.
  Open: after the 2026-08-21 red-team fix wave settled, every listed gate was
  rerun green the same day: POC typecheck and full suite, root check/test, Go
  tests, documentation build, demo suite, and the deterministic package
  verifier with installed Node/Bun and public-type consumers. Broader
  OS-process crash/database-fault injection plus a
  Windows/Linux/architecture/version CI matrix remain open, so this item stays
  open on those grounds alone.

## Specification conformance snapshot

This table is an audit against every page under `docs/src/pages/specification/`
and the locked entries in `docs/DECISIONS.md`. “Bounded” means the POC executes
the stated slice and rejects its known unsupported forms; it does not mean the
full normative requirement is implemented.

| Audited source surface | Current evidence | Major remaining conformance gap |
| --- | --- | --- |
| [Status/index](../docs/src/pages/specification/index.mdx) | **Accurate scope marker:** the repository identifies the checked frontend and bounded single-module portable backend as bounded evidence and makes no conforming-release claim | The grammar, conformance corpus, full Go compiler contract, LLVM/general Wasm backends, and resolution of open grammar/ABI decisions remain incomplete |
| [Compatibility](../docs/src/pages/specification/compatibility.mdx) | **Bounded:** unchanged shared syntax, checker-backed `TypeScript`/panic/host rows, fail-closed static module-initialization trust, native-pin diagnostics, a recursively staged TS/TSX/MTS/CTS/JS/JSX/MJS/CJS graph, and a canonical single-module IR (scalars, intra-module calls, locals, fuel-bounded loops, scalar error payloads, interned ASCII string literals) with TypeScript-host/real-Wasm wire-hash agreement execute | Complete package/module-mode behavior, representative upstream corpus, full dynamic-feature table, standardized module-init trust metadata/tooling, Context/heap and cross-module call lowering, general string operations, and VibeLang LLVM/general Wasm backends are absent |
| [Type system](../docs/src/pages/specification/type-system.mdx) | **Bounded:** eager Result/Optional representations, outside-in lifting, concrete cross-module `E`/`R` propagation, foreign rows, must-use diagnostics, and structural durable descriptors execute | Generic/higher-order rows, complete async ownership/data flow, stable `R` declaration encoding, nested Optional policy, and shared compiler reification remain |
| [Failures](../docs/src/pages/specification/failures.mdx) | **Bounded:** Error-to-Result lifting, unwrap propagation, nominal errors/matching, default foreign panic plus trusted call/module JSDoc, runtime adapters, Promise restrictions, and bounded cleanup execute | Complete overload/generic foreign provenance, final panic-recovery API, cross-realm Error codec, standardized module-init trust metadata, and general cleanup composition remain |
| [Requirements](../docs/src/pages/specification/requirements.mdx) | **Bounded:** nominal `Context` lookup, concrete transitive rows, known Layer subtraction, scoped nested/overlapping provision, and exact Node/V8 settlement revocation execute | Generic/callback/cross-module Layer closure, portable environment lowering, stable declarations, complete promise ownership, explicit merge precedence, and unsupported-host async provision remain |
| [Control flow](../docs/src/pages/specification/control-flow.mdx) | **Bounded:** TypeScript statements, Result exits, unwrap, lexical-tail `defer`/`errdefer`, and nested `if`/`switch` expression plans lower with typed joins, checked evaluation order, and unsafe exits rejected | Block/`while`/`for` expression forms, labeled values, loop `else`, closed-union exhaustiveness, generators, and one general checked IR remain |
| [Comptime](../docs/src/pages/specification/comptime.mdx) | **Bounded:** resolved intrinsic identity, static values, immediate/private-const compile-time functions, target-selected branch erasure, tracked text embed, value-derived deep literal types, static attributed asset-module imports across the root CLI, pure-data generated modules, deterministic declarations/maps/cache, built-in assets, and sandbox-authentic custom loaders execute without author-module evaluation | General evaluation, loops/mutation, arbitrary type-valued bindings, asset re-export/dynamic/nested graph forms, and one compiler-owned incremental graph remain |
| [Durable execution](../docs/src/pages/specification/durable-execution.mdx) | **Bounded:** static Flow lowering with conditional, timer, typed single-delivery external-signal, stable-key fan-out with bounded multi-step bodies, explicit `sequential(...)`, attached child Flows under a depth budget, and budgeted `loopWhile(...)` round nodes; structural Action/Flow/signal contracts; exact implementation `E`/Action-schema and grant closure; canonical plans/manifests/protocols; SQLite recovery/reuse; crash injection; signed local deployment envelopes; and isolated Deno execution | General unbudgeted loops and nested fan-out, lexical-closure/bundle attestation, detached children and queues, signals addressable inside a child Plan, separately signed child manifests, final signal handle and authenticated sender/transport design, explicit codecs/migration, tree-shaken worker bundles, authenticated remote worker transport, and multi-host coordination are absent |
| [Decision ledger: compiler and delivery](../docs/DECISIONS.md) | **Partial:** public package/CLI surfaces, target classification, TypeScript compatibility APIs, an explicitly selected exact-revision Go bridge, foreign Zig/Rust Wasm builds, a bounded checker-authored single-module Vibe-to-Wasm backend, and clean-package gates have executable evidence | The Go bridge accepts externally lowered TypeScript and composes non-identity maps, but is still externally overlaid rather than a reviewed vendored/fork-owned VibeLang extension; LLVM and general Wasm emit, shared heap/Context ABI, LSP, formatter, and a multi-platform release matrix are absent |
| [Decision ledger: libraries and agents](../docs/DECISIONS.md) | **Architecture evidence:** structured concurrency, hardened runtime values, passed-function confinement, bounded RPC, prompt assets, and provenance execute | The model behind the typed `ModelAdapter` seam remains scripted; a durable SQLite turn journal with restart replay and tool-to-Action adapters now exist as programmatic POC evidence, while MCP adapters, joining the durable executor's execution history, audited hostile-code isolation and attestation, and the locked standard-library breadth target are not implemented |

The bounded `if`/`switch` slice reduces the expression-control-flow risk, but
block/loop/labeled values still require the same checked evaluation-order IR as
general unwrap/defer lowering and durable symbolic branches. The exact pinned
Go process/content-mapper/check/emit seam now executes for multi-file identity
projects and for externally lowered input whose authored source maps it
composes; the highest-risk remaining delivery surface is moving real VibeLang
lowering, rows, and declarations into reviewed fork-owned hooks rather than the
JavaScript POC frontend.

## Explicit non-claims for this pass

These remain roadmap items unless evidence is added above: a production LLVM
backend and GC, a multi-machine coordinator, signed remote worker deployment,
container/VM-grade sandbox attestation on every OS, the complete TypeScript
conformance corpus, and a final stable language grammar/ABI for open decisions.
The prototype must model their contracts and fail honestly; it must not report
them as implemented.

## Evidence log

These commands are verification checkpoints from 2026-08-21. Final release
claims must still satisfy every clause in their checklist item; a green focused
suite does not erase an explicitly listed integration gap or replace the final
combined gate after parallel work settles.

| Date | Evidence | Result and limitation |
| --- | --- | --- |
| 2026-08-21 | Full POC gate after the red-team fix wave settled: `cd poc && bun run check && bun test` | `tsc --noEmit` clean; **314 passed, 0 failed, 2,962 assertions across 27 files**, stable across five additional consecutive full-suite runs after fixing load-induced orphaned-subprocess and tight-tool-deadline test flakes. Includes the hardened foreign suite (21 tests with real Zig 0.15.2 and Rust 1.90.0 to Wasm), the durable suite with new two-connection contention tests, the red-teamed language fail-closed additions, and the agent raw-output metering tests. |
| 2026-08-21 | Red-team fix verification (focused) | Language: **66 passed, 522 assertions** (Optional-unwrap propagation lowering, `expect` Panic charging, `VIBE1002`/`VIBE1107`/`VIBE1205`/`VIBE1206`/`VIBE1511`, exact `vibelang` specifier trust, accepted `Result.try`). Durable: **109 passed, 748 assertions** after converting all nineteen store transactions to `BEGIN IMMEDIATE`; the deferred-transaction contention failure reproduced 5/5 pre-fix. Agent: **24 passed, 129 assertions** after raw stdout-byte metering; ~153 MiB host buffering measured pre-fix. |
| 2026-08-21 | Root gates: `npm run check` then `npm test` | Both passed: poc/dist rebuild, root and compat typechecks (including 13 new falsifiable `@ts-expect-error` public-type-strength checks), **53 Node tests passed, 0 failed** (CLI suite grown to 32 with mixed-input, `lsp`, and option-conflict rejection coverage plus exact JSON-code assertions), and `go test ./compiler ./cmd/vibec-go` passed. |
| 2026-08-21 | Exact pinned Go bridge and CLI checkpoint (rerun) | `VIBELANG_TYPESCRIPT_FORK=/private/tmp/vibelang-ts-fork.CHRNsk go test ./compiler -run TestPinnedFork -count=1` (four tests) and `go test ./cmd/vibec-go -run TestPinnedCLIProcessCompilesDiskRoots -count=1` all passed against revision `c087644e82dc3d48cf87e4c5519eeaaea9daf35c`. This proves the identity content-mapper/check/declaration/runtime-emit/source-map route, not real Vibe lowering, package hosting, a vendored fork, or binary provenance. The temporary sparse checkout was later lost to a machine restart; re-running requires `scripts/prepare-typescript-fork.mjs --fetch`. |
| 2026-08-21 | `npm run build` in `docs/` | Passed; 73 files generated with internal links validated. |
| 2026-08-21 | `cd poc && bun run demo` | All demo surfaces completed end to end, including the language runtime executing its async Layer scope under Node (Bun transpiles the bundle; direct Bun execution demonstrates the documented fail-closed rejection), real Zig/Rust imports, durable execution, and the confined coding agent. |
| 2026-08-21 | `npm run verify:pack` (settled tree) | Passed: `{"ok":true,"tarball":"vibelang-0.0.1.tgz","sha256":"c6dead3636a67dd37a8b8a487197e321ceeb357c81917e38844797e2dbf658eb","inventorySha256":"0077e1421236482337e2e3ea5661c5b9ebdaec1bf2118f63904f4dea620359d9","files":332,"generatedFiles":286,"exports":39,"consumers":["node","bun"]}`. Any later source/script edit supersedes this identity. |
| 2026-08-21 | `git diff --check` | Passed; no whitespace-error gate failures in the shared working tree at the final audit. |
