# Production-readiness contract

> [!IMPORTANT]
> **Specification drift — read `docs/DECISIONS.md` and
> `docs/src/pages/specification/**` first.**
> This document records implementation and measurement history. On 2026-08-23 the
> specification was substantially reduced and the code has not caught up, so parts
> of this document describe obligations the language no longer has:
>
> - the expression-form control-flow grammar, `defer`/`errdefer`, labeled value
>   breaks and loop `else` — grammar is now one form, `if (const x = f(); cond)`
> - `Optional<T>` — absence is now `T | undefined`
> - `.unwrap()` — propagation is now postfix `!`, and the TypeScript non-null
>   assertion is removed from `.sm`
> - the near-native/LLVM and Wasm compilation targets, the `TypeScript`
>   requirement, the portable/required/forbidden classification, and the
>   portability (native) pin — TypeScript is the only target
>
> Retained and unaffected: the checked `panic` channel on unannotated foreign
> calls, and Zig/Rust imports through generated Wasm bindings. Where this document
> and the specification disagree, the specification wins.

> **SPECIFICATION WITHDRAWAL, 2026-08-23 — read before trusting anything below.**
> The specification was substantially reduced today, and a large share of this
> document describes machinery the language no longer defines.
> `docs/src/pages/specification/index.mdx:42-64` lists what the implementation
> now carries in excess of the spec and marks it **pending removal**: eight of
> the nine fork grammar patches, `Optional<T>` and its lifting, `.unwrap()` as
> the propagation spelling (now postfix `!`), the TypeScript non-null assertion,
> and **the portable Wasm backend, the `TypeScript` requirement, feature
> classification, and the portability pin**. The near-native/LLVM target and the
> Wasm compilation target are withdrawn.
>
> That invalidates the *scope*, not the *findings*, of roughly ten lanes recorded
> below. Every entry about the native-pin certification — module-level
> initializers, immediately-invoked functions, binding laundering through
> re-exports, the module load graph, `Layer.provide` subtraction, and value flow
> through visible callees — describes real defects that were really fixed in
> machinery that is now scheduled for deletion. The same applies to
> `poc/src/targets/native-backend.ts`. Those entries are kept rather than deleted
> because they are the accurate record of what the code does *today*, and because
> whoever performs the removal needs to know how much surface there is: this
> session substantially extended it. `poc/src/targets/classify.ts`'s header hazard
> log is the only accurate description of what that machinery actually does, and
> should be read before any of it is deleted.
>
> What survives the withdrawal unaffected: `Result<A, E>`, the checked `panic`
> channel on unannotated foreign calls, typed asset imports and their five
> built-in loaders, comptime, durable execution, Context/Layer capabilities, the
> gate-integrity work, and every methodological finding in this document — the
> recurring defect shapes, the tests that asserted bugs as correct behaviour, the
> coverage claims that concealed unmeasured rules, and the accepted-surface census
> technique. Those are independent of which language features the spec defines.
>
> The conformance corpus also encodes withdrawn rules as contract: area
> `21-native-pin` and nine further portability cases assert the withdrawn
> classification, and four are currently `xfail go` for defects that are now moot.
> Removal must retire those cases as well as the code, or the harness will fail on
> correct post-removal behaviour.

> **Compiler-migration status (2026-08-22).** The semantics described in this
> document are implemented twice, and as of this date the two AGREE. The
> TypeScript analysis instrument under `poc/src/language` is the reference
> implementation; a real Go implementation inside the pinned TypeScript fork is
> the migration target. **These corpus numbers are stale in both directions and
> are kept only as the dated record of that day.** They read 92 cases; the corpus
> later reached 260, and as of the specification withdrawal it is being reduced
> again — 231 at the time of writing, with the whole `21-native-pin` area
> deleted. Any figure in this document is a measurement with a date on it, not a
> current fact; re-measure with `find conformance/corpus -name '*.expected.json'
> | wc -l` and the runner rather than quoting one. On the `conformance/` corpus
> both scored, **on 2026-08-22**, 92/92
> with 92/92 identical observations, zero divergences, zero unsupported, plus
> 6/6 interop files on each backend. All nine Smithers surface-grammar forms
> parse, type-check, and lower in the fork, landed through the digest-gated
> `compiler/forkpatch` series with upstream health identical to a pristine
> tree: 62/62 packages, 130,743 subtests.
>
> What that number does and does not claim. It means the Go compiler produces
> the same observable behavior as the reference on every case in a 92-case
> corpus spanning 15 semantic areas, with emitted JavaScript executed under
> Node for output cases. It does NOT mean the language is finished: the corpus
> is a contract, not a census; the root `smithers` CLI still drives the TypeScript
> instrument rather than the Go compiler; the `smithers:comptime` and
> `smithers:flows` intrinsics have no Go lowering; the formatter and language
> server run on the instrument; there is no native or general Wasm backend; and
> the fork patches are neither vendored nor distributed. `.sm` remains a
> content-mapper extension — the project's one genuine point of no return has
> not been crossed.
>
> Two corrections belong in the record. An earlier "surface syntax complete"
> claim was measured against `poc/examples` rather than the corpus and was
> wrong. And the corpus itself was, until the oracle was hardened, never
> type-checking emitted TypeScript — one case passed on false pretenses, and
> one Go divergence (a value-`switch` clause silently dropping the statements
> before its final expression) stayed hidden behind three reporting bugs. Both
> are fixed, and a self-test now fails if the emitted-output check is removed
> again.
>
> **Release gate, 2026-08-23.** All gates green on a quiescent tree: POC
> typecheck clean and 1,076 pass / 0 fail; root check (including `go test`)
> pass; root suite 101 pass / 0 fail; docs build 75 files with links validated;
> conformance both backends with zero divergences; and the deterministic
> package verifier `ok:true` — `smthrs-0.0.1.tgz`, SHA-256
> `ed34686798e36149068e86290b58c54d068c47caa0fb306c819808a241c1b329`,
> inventory SHA-256
> `d8a8db67df3b6a57a30d216664d2e9347f74da87804968a1be91c42ecdd1bf73`,
> 524 files (475 generated), 44 exports, installed Node and Bun consumers.
> That verifier run found four defects no source-tree gate could see, because
> it is the only gate that exercises a real installed tarball: a packaged
> runtime edge escaping the package, two README links to unshipped files, and
> a public-API shape assertion that was simply wrong. Any later source or
> script edit supersedes this hash.
>
> **The version in that artifact is wrong, 2026-08-23.** `package.json` declares
> `0.0.1`, but `npm view smthrs version` returns **0.35.0** — the package is
> already published and well past this repository's declared version. So the
> verifier's `ok:true` is evidence about the tarball's *contents*, its inventory,
> and its installability under Node and Bun; it is **not** evidence that
> `smthrs-0.0.1.tgz` is a publishable release. It is not: `0.0.1` is behind the
> live registry state, and any real release must resolve that discrepancy first.
> Nothing about this was caught by the source-tree gates or by the verifier,
> because neither of them consults the registry — a gate can only measure what it
> is pointed at. This also affects the removal now in progress: withdrawing the
> `./targets` and `./optional` subpath exports is a breaking change to a **live**
> published package rather than a pre-release adjustment.
>
> **Correction to that gate, same day.** "Root check (including `go test`) pass"
> claims more than it measured. Seven Go test sites call `t.Skip` when
> `SMITHERS_TYPESCRIPT_FORK` is unset — `compiler/fork_integration_test.go:36,115,138`,
> `compiler/fork_lowering_integration_test.go:16`, and
> `cmd/smithersc-go/integration_test.go:23,92,162` — and neither the `check` nor
> the `test` script in `package.json` sets that variable. Those are precisely the
> tests that exercise the executable pinned-fork route, the lowering integration,
> and the Go CLI process. They skipped, `go test` printed `ok`, and the gate
> reported success. The Go portion of both root gates therefore covered only the
> tests that need no fork checkout. A lane is making the gate resolve the pinned
> checkout and **fail closed** when it cannot, and print a run/skip census so
> coverage is visible from gate output alone.
>
> **Resolved, same day.** `scripts/go-test-gate.mjs` now backs both root scripts,
> resolves the pinned checkout, refuses to pass when any checkout-backed test
> skips, and prints its census. Measured directly on the current tree:
> `Go test census: ran 322 (passed 322, failed 0), skipped 0; skip reasons: none`,
> exit 0, compiler suite 330.759s. The previously-skipping tests pass —
> `TestPinnedForkParsesChecksEmitsAndMapsSmithers`,
> `TestPinnedForkConcurrentColdCachePreparation`, and
> `TestPinnedForkRejectsCacheInsideCheckoutBeforeWrite` among them. So the fork
> path was in fact working; what was broken was the gate's ability to say so. The
> defect was that success and silence were indistinguishable, which is the reason
> to fix it even when the hidden answer turns out to be good.
>
> The full before/after is worse than first measured and better than first
> feared. Old direct Go step with the environment cleared: **69 ran, 143
> skipped** — 138 of them "exact pinned checkout required". Final `npm run check`
> and `npm test`: **350 ran, 350 passed, 0 skipped**, with the fork preflight and
> tests like `TestPinnedCLIProcessCompilesInternallyLoweredRequest` visible in
> gate output. The gate proved its worth on its first real run: with the Go
> fail-open fixes in flight it failed with three records, and both causes were
> **stale test assumptions** rather than regressions — one artifact-count
> assertion that predated the CLI's move to internal lowering, and one positive
> fixture that had been relying on a module-level `@module @throws {never}` header
> accidentally certifying a function, which the tightened trust grammar correctly
> stopped. Neither test was weakened; the owning lane corrected both.
>
> A second silent gate was found in the same pass: `node --test test/*.test.mjs`
> **exits 0 when the glob matches nothing** — measured directly as `1..0`,
> `# tests 0`, `exit=0`. Both gates now run through preflight scripts that refuse
> an empty set, use `-count=1` so a cached Go result cannot masquerade as
> execution, and print a deterministic census line.
>
> Two weaknesses remain reported rather than fixed. `test/conformance.test.mjs`
> deliberately makes the Go conformance run **report-only**: it measures every
> case but does not fail on a divergent or unsupported verdict, so a green root
> test is not a claim that all 211 are ordinary Go passes. And
> `test/cli.test.mjs:1331` returns from its symlink test on Windows instead of
> marking it skipped, which Node counts as a pass.
>
> **A differential census of both implementations, 2026-08-23.** The
> zero-divergence result was audited by comparing the full accepted surface of
> the two backends — module specifiers, file extensions, import attributes,
> diagnostic codes, environment and flags, and trust escape hatches — rather than
> by running more cases. It found **ten fail-opens that no corpus case can
> observe**, six in the Go backend and three in the reference, plus one shared.
> The most severe is not a rule gap at all: the Go CLI's **default lowering mode
> runs no Smithers checks**. `cmd/smithersc-go/main.go` builds its compile request
> with no `Lowering` field, which selects the identity route — the TypeScript
> checker only — while rows, must-consume, comptime, durable, assets, native pin,
> and foreign trust all live on the `internal` route, and `NoEmitOnError` is
> forced off. No corpus case can see it because the conformance runner always
> asks for `"internal"` explicitly. Until that default changes, "the Go backend
> passes" is ambiguous about which compiler ran.
>
> The census also corrected the headline itself: the honest reading is not
> "211/211 identical" but "**backend agreement 209/211, with zero cases in the
> narrowest of three buckets**". And a corpus grown alongside two implementations
> converges on their intersection — the oracle is strongest where it is least
> needed, and blind at the edges where the two disagree.
>
> Treat every claim below as describing the reference implementation unless it
> explicitly says otherwise.

This file is the executable scope and release audit for the second Smithers
prototype. The decision ledger wins over older specification prose when they
conflict. A checked box requires direct evidence from source, tests, emitted
artifacts, or a real process boundary; a plausible implementation is not enough.

## Release definition

The prototype is release-ready as architectural evidence when one
coherent toolchain can compile and run representative `.sm` applications,
reject unsafe or unsupported programs deterministically, and exercise the
highest-risk runtime boundaries with restart and adversarial tests. It does not
claim native-code, distributed-cluster, or full TypeScript-corpus conformance
until those backends exist.

Every intentionally deferred surface must fail closed with a stable diagnostic;
it must not silently emit code with different semantics.

## Required executable surfaces

### Compiler and compatibility

- [x] Parse `.sm` with the current TypeScript-derived grammar and preserve
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
  placements fail with `SMITHERS1206`/`SMITHERS1205`.
- [x] Infer recoverable Error unions and nominal Context requirements through
  local and cross-module calls; preserve them in diagnostics/declarations.
  Evidence: one Program propagates concrete rows through relative imports,
  aliases, namespaces, and cycles. Declaration emission retains Result contracts
  and appends strict versioned `@smithersEffects` metadata decoded by the public
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
  `SMITHERS1602`/`SMITHERS1603` and leaves the row empty. Lexical shadows remain
  ordinary values in both. Nominal `Capability.context()` rows now agree
  exactly between the frontend and the classifier — the classifier previously
  reported no requirement at all for a capability read, which under-reported
  `smithers inspect` portability and native-pin dependency paths. A complete host
  API classification table is still open, as are higher-order, method, and
  generic capability receivers, which both analyzers under-report.
- [ ] Treat every untrusted JS/TS runtime call as checked `panic` unless trusted
  `@throws {never}` or more precise `@throws {T}` metadata says otherwise.
  Open: direct/aliased/namespace calls, methods, immutable literal storage, and
  explicitly unwrapped factory results have checker-resolved tests, including
  contract-violation `Panic`. Unannotated accessors and constructors, raw
  method extraction, nested factory calls, mutable/opaque stores, and escaping
  callbacks now fail closed with `SMITHERS1504`/`SMITHERS1506`-`SMITHERS1509`. Complete
  arbitrary-heap and higher-order provenance is still not proved, so “every”
  remains an intentionally unmet soundness claim. Static foreign module
  initialization cannot be caught by a call wrapper, so runtime imports now
  fail closed with `SMITHERS1510` unless the target begins with JSDoc containing
  both `@module` and `@throws {never}`. Type-only/compiler-intrinsic imports are
  exempt; a trusted async foreign adapter can defer dynamic loading into the
  ordinary checked rejection boundary. This is a provisional trust claim, not
  proof that arbitrary module initialization is safe.
- [x] Emit valid TypeScript/JavaScript, declarations, source maps, deterministic
  diagnostics, and collision-free helper imports.
  Evidence: the no-write project compiler shares semantic models, rewrites
  `.sm` module edges, stock-checks the whole generated project, emits `.mjs`
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
  `throw` (`SMITHERS1511`), class `static {}` blocks (`SMITHERS1107`), panic/unwrap
  inside a JavaScript `catch` scope (`SMITHERS1205`), a missing-parse-diagnostics
  internal seam (`SMITHERS1002`), and prefix-based `smithers*` specifier trust (now
  exact `smithers`, `smthrs/`, or `smithers:` only); the retired-syntax
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
  `Layer.provide` rather than approximating the lifetime. Authored `.sm`
  separately rejects evident detached Promise work.
- [ ] Require every Promise started by authored `.sm` to be consumed directly
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
  Evidence: `compileDurableSource` resolves `smithers:flows` and Action aliases by
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
  flow fails with `SMITHERS41xx` diagnostics. Action descriptors are supplied
  through an explicit compiler binding seam. Separately,
  `compileActionImplementationContract` checks a closed `.sm` implementation
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

- [x] Expose the working implementation through the root package and `smithers`
  CLI rather than requiring imports from historical spike internals.
  Evidence: package subpaths export language/runtime/build/target/agent/
  concurrency/durable surfaces; root tests compile, check, inspect, and run a
  `.sm` fixture through `bin/smithers.js`.
- [x] Keep raw TypeScript CLI/API compatibility paths passing unchanged.
  Evidence: root tests cover CommonJS/ESM TypeScript API identity, aliases,
  tsserver/plugin compatibility, raw `smithersc` flags, and TypeScript checking.
- [x] Provide check, compile, run, test, inspect/plan, doctor, and machine-readable
  diagnostics suitable for CI.
  Evidence: `smithers test` compiles real project graphs and executes exported
  `test*` functions in a timeout/output-bounded child with a validated protocol;
  JSON output remains uncontaminated. `smithers plan` emits/returns canonical static
  Plan IR without author evaluation. Other listed commands and stable diagnostic
  codes have root integration tests.
- [x] Ship deterministic package contents with no undeclared runtime files,
  stale placeholders, or examples that claim unsupported behavior.
  Evidence: `verify-pack` cleans both output trees; rejects missing/extra,
  colliding, mis-cased, wrong-mode, or debris files; packs across independent
  clean rebuilds and byte-compares tarballs; checks every export/type/bin
  target; and installs the actual tarball into fresh Node/npm and Bun
  consumers. The 2026-08-21 settled run recorded `smithers-0.0.1.tgz` with
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
| [Compatibility](../docs/src/pages/specification/compatibility.mdx) | **Bounded:** unchanged shared syntax, checker-backed `TypeScript`/panic/host rows, fail-closed static module-initialization trust, native-pin diagnostics, a recursively staged TS/TSX/MTS/CTS/JS/JSX/MJS/CJS graph, and a canonical single-module IR (scalars, intra-module calls, locals, fuel-bounded loops, scalar error payloads, interned ASCII string literals) with TypeScript-host/real-Wasm wire-hash agreement execute | Complete package/module-mode behavior, representative upstream corpus, full dynamic-feature table, standardized module-init trust metadata/tooling, Context/heap and cross-module call lowering, general string operations, and Smithers LLVM/general Wasm backends are absent |
| [Type system](../docs/src/pages/specification/type-system.mdx) | **Bounded:** eager Result/Optional representations, outside-in lifting, concrete cross-module `E`/`R` propagation, foreign rows, must-use diagnostics, and structural durable descriptors execute | Generic/higher-order rows, complete async ownership/data flow, stable `R` declaration encoding, nested Optional policy, and shared compiler reification remain |
| [Failures](../docs/src/pages/specification/failures.mdx) | **Bounded:** Error-to-Result lifting, unwrap propagation, nominal errors/matching, default foreign panic plus trusted call/module JSDoc, runtime adapters, Promise restrictions, and bounded cleanup execute | Complete overload/generic foreign provenance, final panic-recovery API, cross-realm Error codec, standardized module-init trust metadata, and general cleanup composition remain |
| [Requirements](../docs/src/pages/specification/requirements.mdx) | **Bounded:** nominal `Context` lookup, concrete transitive rows, known Layer subtraction, scoped nested/overlapping provision, and exact Node/V8 settlement revocation execute | Generic/callback/cross-module Layer closure, portable environment lowering, stable declarations, complete promise ownership, explicit merge precedence, and unsupported-host async provision remain |
| [Control flow](../docs/src/pages/specification/control-flow.mdx) | **Bounded:** TypeScript statements, Result exits, unwrap, lexical-tail `defer`/`errdefer`, and nested `if`/`switch` expression plans lower with typed joins, checked evaluation order, and unsafe exits rejected | Block/`while`/`for` expression forms, labeled values, loop `else`, closed-union exhaustiveness, generators, and one general checked IR remain |
| [Comptime](../docs/src/pages/specification/comptime.mdx) | **Bounded:** resolved intrinsic identity, static values, immediate/private-const compile-time functions, target-selected branch erasure, tracked text embed, value-derived deep literal types, static attributed asset-module imports across the root CLI, pure-data generated modules, deterministic declarations/maps/cache, built-in assets, and sandbox-authentic custom loaders execute without author-module evaluation | General evaluation, loops/mutation, arbitrary type-valued bindings, asset re-export/dynamic/nested graph forms, and one compiler-owned incremental graph remain |
| [Durable execution](../docs/src/pages/specification/durable-execution.mdx) | **Bounded:** static Flow lowering with conditional, timer, typed single-delivery external-signal, stable-key fan-out with bounded multi-step bodies, explicit `sequential(...)`, attached child Flows under a depth budget, and budgeted `loopWhile(...)` round nodes; structural Action/Flow/signal contracts; exact implementation `E`/Action-schema and grant closure; canonical plans/manifests/protocols; SQLite recovery/reuse; crash injection; signed local deployment envelopes; and isolated Deno execution | General unbudgeted loops and nested fan-out, lexical-closure/bundle attestation, detached children and queues, signals addressable inside a child Plan, separately signed child manifests, final signal handle and authenticated sender/transport design, explicit codecs/migration, tree-shaken worker bundles, authenticated remote worker transport, and multi-host coordination are absent |
| [Decision ledger: compiler and delivery](../docs/DECISIONS.md) | **Partial:** public package/CLI surfaces, target classification, TypeScript compatibility APIs, an explicitly selected exact-revision Go bridge, foreign Zig/Rust Wasm builds, a bounded checker-authored single-module Smithers-to-Wasm backend, and clean-package gates have executable evidence | The Go bridge now performs real Smithers lowering itself rather than only accepting externally lowered TypeScript, and its upstream modifications are carried as an ordered, digest-gated `compiler/forkpatch/` diff series that unapplies to a byte-identical tree, with fork-owned Go files injected via `go build -overlay` instead of loose checkout edits. Still absent: the patch series is neither vendored into the distribution nor signed; LLVM and general Wasm emit, a shared heap/Context ABI, and a multi-platform release matrix do not exist. The LSP and formatter are implemented, but both drive the TypeScript instrument's language service, not the Go compiler |
| [Decision ledger: libraries and agents](../docs/DECISIONS.md) | **Architecture evidence:** structured concurrency, hardened runtime values, passed-function confinement, bounded RPC, prompt assets, and provenance execute | The model behind the typed `ModelAdapter` seam remains scripted; a durable SQLite turn journal with restart replay and tool-to-Action adapters now exist as programmatic POC evidence, while MCP adapters, joining the durable executor's execution history, audited hostile-code isolation and attestation, and the locked standard-library breadth target are not implemented |

The bounded `if`/`switch` slice reduces the expression-control-flow risk, but
block/loop/labeled values still require the same checked evaluation-order IR as
general unwrap/defer lowering and durable symbolic branches. The exact pinned
Go process/content-mapper/check/emit seam now executes for multi-file identity
projects and for externally lowered input whose authored source maps it
composes; the highest-risk remaining delivery surface is moving real Smithers
lowering, rows, and declarations into reviewed fork-owned hooks rather than the
JavaScript POC frontend.

## Explicit non-claims for this pass

These remain roadmap items unless evidence is added above: a production LLVM
backend and GC, a multi-machine coordinator, signed remote worker deployment,
container/VM-grade sandbox attestation on every OS, the complete TypeScript
conformance corpus, and a final stable language grammar/ABI for open decisions.
The prototype must model their contracts and fail honestly; it must not report
them as implemented.

### What "feature complete" would still require, on the specification's own terms

A triage against every locked obligation, run on 2026-08-23, produced four
conclusions that this ledger records rather than softens.

**1. `compatibility.mdx` locks that Smithers MUST support a near-native target
through LLVM. A bounded LLVM backend now exists; the obligation is NOT
discharged.** `poc/src/targets/native-backend.ts` emits LLVM IR text for the
whole validated portable IR surface — all nine expression kinds and all twelve
statement kinds — compiles it through `clang -x ir`, and executes it. It is a
third consumer of the same digest-bound IR the Wasm backend uses, and it is held
to three-way differential agreement: **111 scenarios × 3 runtimes = 333
executions** across 13 natively compiled modules, plus 19 rejection-parity cases
× 3, with both canonical defects agreeing at the exact boundary (`countTo`
999,999 against a 1,000,000-step budget; `growLength` 18 against 19). Bit-exact
float cases (subnormal, max-finite, `1e21`) are included. Determinism is proven
across *processes*: a fresh interpreter re-deriving the module from artifact
bytes must reproduce the same IR digest. No `target triple` or `datalayout` is
emitted, so the text stays machine-independent and the host toolchain supplies
both. A missing or failing toolchain produces one of six distinct diagnostics and
never a skip — the harness positively asserts that a real compile happened.

What this does not establish, stated by the lane that built it: the supported
subset is a fraction of the documented language; "near-native" is **unmeasured**,
since nothing was benchmarked and `-O0` was used for predictability; the trust
story is weaker than the Wasm path's, because an executable cannot be
structurally re-inspected the way a Wasm module can; and it is a `poc/` backend
not wired into `compiler/`. The honest statement is that this moves the
obligation from *entirely unimplemented* to *implemented for the portable IR
subset with three-way differential proof*. Reporting it as met would be
overclaiming. The
bounded portable Wasm backend in `poc/src/targets/portable-backend.ts` is real
(~4,180 lines, 65 `SMITHERS50xx` diagnostics, a 1,000,000-step fuel budget, and
exact canonical-exit and wire-digest agreement required between the TypeScript
evaluator and the Wasm runtime) but it is a different target and does not
discharge the LLVM requirement. The corpus pins zero of its 65 codes. A lane is
building a third consumer of that same validated IR — an LLVM emitter compiled
through `clang -x ir` — held to three-way agreement between the evaluator, the
Wasm runtime, and a native binary.

**2. Seven rejection rules exist in the TypeScript reference, are absent from the
Go fork's diagnostic-code set, and are probed by no corpus case:**
`SMITHERS1105` (constructors and accessors cannot carry a Result channel),
`SMITHERS1106` (fallible generators deferred), `SMITHERS1502` (non-reifiable
foreign `@throws`), `SMITHERS1507`, `SMITHERS1508`, `SMITHERS1704`, and
`SMITHERS1706`. Every one is a *rejection*. A rejection rule that one
implementation lacks and no case probes is a silent fail-open by construction,
and the zero-divergence result cannot see it, because a divergence is only
observable where a case exists. These are unmeasured, not known-broken — the
honest statement is that nobody currently knows.

The count was first recorded here as four. That was wrong in the direction that
flatters the project, and the correction has its own lesson: `SMITHERS1507` and
`SMITHERS1508` were missed because `conformance/COVERAGE.md` asserted they were
"observed in the corpus as cascade members". Neither appears anywhere under
`conformance/corpus/`, and `conformance/runner/judge.mjs:209` requires the
observed and declared diagnostic lists to be the same length — so no cascade
member could have ridden along inside another case. A false coverage claim in the
audit concealed two unmeasured rejection rules, which is precisely why the audit
itself had to be re-derived from source rather than trusted.

**3. The audit document was itself materially wrong, and has been corrected.**
`conformance/COVERAGE.md` stated that no Wasm backend exists while a substantial
one ships publicly as `smthrs/targets`; assigned no status to any of the 74
comptime and durable obligations; never mentioned the CLI contract, the
`smithers:schema` compiler-owned virtual module, or the host-sensitive global
classification table; claimed two rejection codes were observed in the corpus
when neither appears in it; and marked a documentation conflict resolved that is
still live. It now carries per-sentence verdicts for comptime (34 rows) and
durable (40 rows, of which **31 are uncovered** — three of the four
specification compilation phases have no channel through this harness at all),
sections for the previously unmentioned surfaces, a dedicated section on the
reference-only rejection rules with re-runnable commands, and a closing claim
rescoped explicitly to `conformance/corpus/` with an eight-item exclusion list.

Seven claims from the triage that produced this list did **not** survive
re-verification and were not written down: comptime and durable alias
preservation are in fact pinned; `SMITHERS1603` does come from the host-global
area; `--timeoutMs` is tested; no corpus case contains a generator; and two
counts were overstated. A triage finding that does not survive re-derivation
matters as much as one that does, and requiring each lane to re-verify rather
than inherit is what kept these out of the record.

**4. Three documentation conflicts need a human with authority to settle them,**
and each currently makes a conformance case unwritable or wrong: `DECISIONS.md`
still locks `while` and `for` as expressions while both implementations reject
them (and `specification/index.mdx` says the ledger wins on conflict);
`control-flow.mdx` contradicts itself on whether a loop `else` is required or
optional; and `failures.mdx` promises a trusted adapter that translates `Panic`
out of `E`, which the shipped `Result.try` conservatively declines to do.

## Evidence log

These commands are verification checkpoints from 2026-08-21. Final release
claims must still satisfy every clause in their checklist item; a green focused
suite does not erase an explicitly listed integration gap or replace the final
combined gate after parallel work settles.

| Date | Evidence | Result and limitation |
| --- | --- | --- |
| 2026-08-21 | Full POC gate after the red-team fix wave settled: `cd poc && bun run check && bun test` | `tsc --noEmit` clean; **314 passed, 0 failed, 2,962 assertions across 27 files**, stable across five additional consecutive full-suite runs after fixing load-induced orphaned-subprocess and tight-tool-deadline test flakes. Includes the hardened foreign suite (21 tests with real Zig 0.15.2 and Rust 1.90.0 to Wasm), the durable suite with new two-connection contention tests, the red-teamed language fail-closed additions, and the agent raw-output metering tests. |
| 2026-08-21 | Red-team fix verification (focused) | Language: **66 passed, 522 assertions** (Optional-unwrap propagation lowering, `expect` Panic charging, `SMITHERS1002`/`SMITHERS1107`/`SMITHERS1205`/`SMITHERS1206`/`SMITHERS1511`, exact `smithers` specifier trust, accepted `Result.try`). Durable: **109 passed, 748 assertions** after converting all nineteen store transactions to `BEGIN IMMEDIATE`; the deferred-transaction contention failure reproduced 5/5 pre-fix. Agent: **24 passed, 129 assertions** after raw stdout-byte metering; ~153 MiB host buffering measured pre-fix. |
| 2026-08-21 | Root gates: `npm run check` then `npm test` | Both passed: poc/dist rebuild, root and compat typechecks (including 13 new falsifiable `@ts-expect-error` public-type-strength checks), **53 Node tests passed, 0 failed** (CLI suite grown to 32 with mixed-input, `lsp`, and option-conflict rejection coverage plus exact JSON-code assertions), and `go test ./compiler ./cmd/smithersc-go` passed. |
| 2026-08-21 | Exact pinned Go bridge and CLI checkpoint (rerun) | `SMITHERS_TYPESCRIPT_FORK=/private/tmp/smithers-ts-fork.CHRNsk go test ./compiler -run TestPinnedFork -count=1` (four tests) and `go test ./cmd/smithersc-go -run TestPinnedCLIProcessCompilesDiskRoots -count=1` all passed against revision `c087644e82dc3d48cf87e4c5519eeaaea9daf35c`. This proves the identity content-mapper/check/declaration/runtime-emit/source-map route, not real Smithers lowering, package hosting, a vendored fork, or binary provenance. The temporary sparse checkout was later lost to a machine restart; re-running requires `scripts/prepare-typescript-fork.mjs --fetch`. |
| 2026-08-21 | `npm run build` in `docs/` | Passed; 73 files generated with internal links validated. |
| 2026-08-21 | `cd poc && bun run demo` | All demo surfaces completed end to end, including the language runtime executing its async Layer scope under Node (Bun transpiles the bundle; direct Bun execution demonstrates the documented fail-closed rejection), real Zig/Rust imports, durable execution, and the confined coding agent. |
| 2026-08-21 | `npm run verify:pack` (settled tree) | Passed: `{"ok":true,"tarball":"smithers-0.0.1.tgz","sha256":"c6dead3636a67dd37a8b8a487197e321ceeb357c81917e38844797e2dbf658eb","inventorySha256":"0077e1421236482337e2e3ea5661c5b9ebdaec1bf2118f63904f4dea620359d9","files":332,"generatedFiles":286,"exports":39,"consumers":["node","bun"]}`. Any later source/script edit supersedes this identity. |
| 2026-08-21 | `git diff --check` | Passed; no whitespace-error gate failures in the shared working tree at the final audit. |
| 2026-08-23 | Typed asset imports made observable for the first time, then fixed on both sides | The conformance harness gained an asset-staging mechanism, and the first measurement found a **locked-rule violation present in both implementations**: `docs/ASSET_LOADERS.md` locks that loading "does not add `FileSystem` or another runtime platform requirement", but the shared portability analyzer charged every attributed asset import a runtime `TypeScript` requirement, so **no function reading any asset could be certified native-portable** (`SMITHERS3001`). Fixed in `poc/src/targets/classify.ts` by recognising an attributed asset import as a compile-time edge at one call site; `requirementForModule` is untouched, so an ordinary relative TypeScript import still charges. The off-state was re-measured by removing the single fix line, so the one corpus movement is causally attributed. Both directions are asserted, and a third defect surfaced while writing them: the bogus requirement also **shadowed** real ones, because `addRequirement` keeps the first path it sees — a legitimately refused pin was reporting a truncated dependency path. |
| 2026-08-23 | Go backend: typed asset imports and bound must-consume | The Go bridge now owns attributed and staged non-code imports as compile-time asset edges, excluded from the foreign-module, foreign call/property, panic-channel, and native-requirement rules. Loader selection is driven by the authored `type` attribute and never by file extension; admission consults only the request's staged inputs, never the ambient filesystem. Four fail-closed rejections land exactly: `SMITHERS5201@1:1`, `SMITHERS5202@1:38`, `SMITHERS5208@1:1`, `SMITHERS5209@1:21`. The bound/unbound must-consume split is ported: a direct producer keeps `SMITHERS1301`/`SMITHERS1402` at the expression, while a producer stored in a variable transfers ownership to the resolved binding and is charged `SMITHERS1302`/`SMITHERS1403` there. **Honest boundary, not a claim of completeness:** the Go backend does not implement the JSON, const-JSON, text, bytes, Markdown, or MDX loaders. A valid, admitted edge stops at its import declaration with the non-language diagnostic `SMITHERS_GO_ASSET_LOADER_UNSUPPORTED`; nine Go corpus cases observe that boundary rather than a fabricated result. Emitting the original import instead would have silently turned a compile-time data edge back into a runtime module dependency. |
| 2026-08-23 | Foreign-edge laundering: one reported instance, an entire failing class | The reported defect was a foreign edge laundered through a project re-export (`export { readFileSync } from "node:fs"`) granting a native pin with no `SMITHERS3001`. Measured against the pre-fix tree, the portability analyzer followed **no re-binding at all**: named re-export, `export *`, `export * as ns`, `export { default as x }`, import-then-export, rename-through-export, cross-module and same-module value bindings, destructured bindings, `export default`, two-hop chains, cycles containing a foreign edge, and namespace imports of a launderer **all granted the pin**. Not one form was already correct. Enumerating the class also surfaced a cause nobody had reported: the walk skipped **parameter defaults**, so `function pinned(read = readFileSync)` certified native with the `node:fs` edge in plain sight. Fixed by following each binding hop by hop to a foreign specifier (charged), a type-only/asset/compiler-owned edge (free), or an ordinary project declaration (the call graph's job). Resolution is name-directed, so a module that launders one binding does not become foreign wholesale, and cycle detection uses stack-discipline rather than memoization because a "clean" answer for a namespace symbol depends on which member is read. `export * from` has no checker alias, which is precisely the hostile case, so it carries a syntactic fallback. The retained diagnostic path now composes call hops and module hops end to end — `main.sm#pinned -> main.sm#inner -> leaf.sm#leaf -> reexport.sm -> node:fs` — and is empty for direct imports, so every pre-existing path assertion is byte-identical. |
| 2026-08-23 | Three reference-side fail-opens, and a fourth the census had cleared | The TypeScript reference is the oracle every conformance case is judged against, so a fail-open there records its own wrong acceptance as correct. **F10:** `Result.all` was matched by raw identifier spelling, so a user's own `const Result = { all: … }` discharged the must-consume obligation and an unconsumed Result escaped with no diagnostic at all. Now resolved against the prelude's own `declare const Result` member declaration, mirroring what the Go backend already did. **F9:** `implementation-contract.ts` skipped the Action-contract closure check on any specifier merely *beginning* with `smthrs/` or `smithers:` — the same prefix-matching form already fixed once in `classify.ts`. The cheap reproduction only produced a wrong-stage error, so the lane built a `node_modules/smthrs/context-evil` fixture and demonstrated the real fail-open: a `compiler-derived` contract whose `projectDigest` never covered the import. Now exact-matched against the exported intrinsic registry. **Beyond the brief:** the `Promise` combinators carried the identical shadowing fail-open — which the census had cleared as BENIGN — with the `promisedType` guard defeated by an `async` member and `combinatorConsumed` unguarded entirely. Fixed. |
| 2026-08-23 | An instruction of mine was wrong, and the lane proved it rather than complying | I directed C48 to route all twelve must-consume consumers through resolved-binding identity, on the general principle that intrinsics are recognised by identity and never by spelling. The lane implemented it, measured it, and found two over-corrections: a lifted foreign call whose member resolves nowhere, and `lookup("ada").match(...)` on an inferred Result resolving to `String.prototype.match` in `lib.es5.d.ts` — which is conformance case `01-result-lifting/inferred-result-for-an-unannotated-function.sm`, and **it passed every unit suite**. The cause is a real asymmetry between the implementations: the reference analyses authored `.sm` source, where a lifted call keeps its authored type, while the Go backend recognises the same surface *after* lowering. The twelve consumers correctly stay on spelling, because their receiver is already established as compiler-owned; `Result.all` had no such precondition, which is exactly why it alone was the fail-open. Both counter-examples are recorded in the code. Because unit tests missed a conformance regression here, the lane added a read-only A/B diagnostic scan across all 218 corpus `.sm` files and showed the final diff byte-identical. |
| 2026-08-23 | A census premise that did not survive, and the defect underneath it | The census reported that `weakenUnderivableErrors` being set unconditionally made a hard refusal in `poc/src/durable/schema.ts` dead code. False: `deriveActionContract` has two callers and the standalone `compileActionContract` never passes the flag, so the refusal is reachable and was already exercised. The real defect was the opposite shape — the durable source compiler weakened *every* derivation failure while its own comment authorised exactly one, so `Result<_, any>` and structural non-`Error` impostors were silently receiving json-value contracts, while `compileActionContract` refuses the identical source. Settled by a Locked rule in `durable-execution.mdx` — "`any` and `unknown` MUST require an explicit codec at the boundary" — and narrowed to the built-in `Error` channel by symbol identity. The census was also wrong that `poc/src/language/compile.ts` is a specifier-registry mirror; consolidating it would have been a bug, because `smthrs/schema-runtime` deliberately survives emit. |
| 2026-08-23 | Ambient authority laundered through a module-level initializer | Reported as `export const pid = process.pid` escaping the native pin. Measured across 30 forms before any code was written: **all 17 positive forms charged nothing** — empty requirement row, pin granted — and all 13 negative forms were "correct" only by accident of the walk never looking at module level. Fixed by riding C41's hop-by-hop resolution rather than adding a parallel walk, so re-export chains, namespace reads, `export default`, destructuring, and cycle handling all came for free; classification calls the analyzer's existing ambient-authority and host-global tables, so the `Date.parse`/`Date.UTC` exemption and the lexical-shadow rule agree by construction instead of by a second opinion. One structural change was forced: ambient findings must **accumulate** rather than short-circuit the way module edges do, because `{ at: Date.now(), pid: process.pid }` reaches the non-blocking `Clock` first and keeping only the first hit would drop `Host<"process">` and grant the pin the initializer forbids. Diagnostic routes compose to the full path (`main.sm#pinned -> main.sm#inner -> leaf.sm#leaf -> reexport.sm -> config.sm#value -> process.pid`), and C41's existing path assertions pass byte-identical and unmodified. **Honest scope:** the frontend independently refuses most of these programs with `SMITHERS1601`/`1602`/`1603`, so they already failed to compile for a different reason. The fix still matters, because a native pin is a checked assertion that must fail on its own evidence, and `analyzeCompatibility*` is a public surface whose rows were simply wrong. |
| 2026-08-23 | An over-correction caught by the rule that required looking for it | The first version of the fix above descended into nested callables and broke an existing assertion that `const deferred = () => window.location` stays ordinary — a value that is defined but never invoked. The mandatory both-directions requirement caught it, and the lane fixed the scan to stop at function boundaries (matching the body walk) rather than weakening the assertion to fit the new behaviour. This is the fourth over-correction this file has produced across its history, which is why the negative direction is not optional here. |
| 2026-08-23 | Ambient authority through an immediately-invoked function, and a false entry in the file's own memory | **17 of 18 positive forms were failing open** and are now charged: arrow, function-expression, async, and named IIFEs; `.call`/`.apply`/`.bind()()`; `new (function(){})()`; tagged templates; IIFEs in object and array literals, in function bodies, through a re-export chain, one call deeper, and hiding a `node:fs` edge or `eval`. Optional call (`?.()`) was already correct. One form was a *partial* — `{ at: Date.now(), pid: (() => process.pid)() }` kept the non-blocking `Clock` and dropped the blocking `Host<"process">`; both are now charged with separate routes. All 14 negative forms were already correct and none regressed. The mechanism is a single predicate, `isInvokedWhereDefined`, shared by both walks, which walks *upward* through transparent wrappers and returns true only when the callable **is the callee** — it never descends into nested callables, which is precisely the over-correction that had broken the `const deferred = () => window.location` assertion. Prior path assertions were verified byte-identical by test-count arithmetic rather than assumed. **The more important finding is about the file's hazard log itself:** its summary paragraph claimed only the module load graph fails open and that every other entry merely "loses a row that only makes a pin harder to obtain". Measured false — **four** entries grant a pin over a live `process.pid` read. The paragraph now says so, carries `MEASURED: FAILS OPEN` reproductions, and states explicitly that unmeasured entries are not proven safe. |
| 2026-08-23 | A deliberate non-fix, settled from the spec rather than by instinct | `.map`/`.forEach` callbacks are **not** charged. `requirements.mdx` requires inference to be transitive through ordinary calls, and `[1].map(cb)` is a call to `map` — charging `cb` would assume `map`'s body. Decisively, `keep(() => process.pid)` is a mandated negative and is syntactically identical to `.map(() => process.pid)`, so no rule charges one without the other except a second table of host knowledge, which is the documented cause of this file's past over-corrections. The frontend refuses the authored form independently with `SMITHERS1601`, so the pipeline is not fail-open here — only the row would be. |
| 2026-08-23 | Known-open, newly measured: ambient authority through an immediately-invoked function | While correcting a claim in `classify.ts`'s own hazard log — which asserted that every non-module-level entry can only fail closed — the lane measured that an immediately-invoked function expression, `(() => process.pid)()`, **fails open in both the body walk and the module-initializer scan**. It is not fixed. The boundary that makes the fix above correct (stop at function boundaries, so a merely-defined callable stays ordinary) is the same boundary an IIFE hides behind, because an IIFE is defined and invoked at once. The distinction a fix must draw is invocation, not definition. Recorded here rather than left in a comment, and dispatched. |
| 2026-08-23 | A cleanup declined on measured grounds | The native and Wasm backends share roughly 250 lines of layout, facts, and wire helpers, and consolidating them was queued as cleanup on the premise that it was a pure move. It is not: the native backend **re-derived** those helpers rather than copying them. Three measured blockers — divergent type shapes (`PortableStringFacts` 9 fields against 5, `PortableMemoryLayout` 10 against 6) across ~90 reference sites; the four wire helpers carrying their own subsystem diagnostic codes, so sharing them would empty three members of the deliberately-carved `SMITHERS5100`–`5112` native block; and, decisively, `nativeMemoryLayout` sizing the module's memory while `wireExit` produces the wire digest, so any non-exact merge moves both the emitted `.ll` bytes and the digest the three-way acceptance bar rests on. The lane stopped and made the stale in-code justification true instead, so the next lane is not sent into those blockers by an out-of-date comment. A documented duplication is better than a botched deduplication of two things that only look alike. |
| 2026-08-23 | The corpus grew from 211 to 234, and the first re-export case caught a live Go fail-open | Fourteen stale markers were cleared against a fresh measurement rather than against a report, and each retired marker's `notes` now records what that backend used to observe. Twenty-three cases were added pinning this session's fixes: eight for foreign-edge laundering (named re-export, `export *`, two-hop chain, cycle, parameter default, root re-export trust, plus two acceptance controls), `vibelang:flows` with a `smithers:flows` A/B control, the trust marker's three holes with a multi-line-header control, `@throws {Never}`, four import-attribute cases including the template-literal spelling, and shadowed `Result`/`Promise` with two real-combinator controls. **Five of them fail on the Go fork, and that is a live fail-open:** `export { readFileSync } from "node:fs"` produces **zero diagnostics**, grants a native pin to a function that reads `node:fs`, and runs the program. It is not a missing rule — the fork spells both rules and refuses the *import* form of the same edge — it is a missing syntactic form: `grep -n IsExportDeclaration compiler/forkbridge/*.go.txt` returns nothing. A code-set diff could not see it because both codes exist; the 211-case corpus could not see it because none of its files contained a re-export; and backend agreement read 211/211 throughout. Recorded as five evidenced `xfail go` markers and dispatched. Final gate: JS **234/234**, Go **229/234**, zero divergent, zero unmeasured, zero unsupported, zero xpass. |
| 2026-08-23 | The transitive graph, and a blocker that was never a spec question | Three lanes had recorded the remaining native-pin fail-opens as "needs a frontend-agreement decision". The Locked sentence at `compatibility.mdx:68` — "a checked assertion over the **complete transitive graph**… **any reachable operation or provider**" — settles *whether*, and nothing contradicts it. The supposed disagreement turned out to be one-sided and already recorded in the repository's own tests: `classify.test.ts:688` documented that the frontend's row for `alias()` and `holder.read()` was `["Config"]` while the classifier's was `[]`, because the frontend resolves a call through `checker.getResolvedSignature(call)?.declaration` while the classifier required a callee *identifier* resolving to an analysed top-level function. Moving the classifier onto the same question closed it. **No frontend change was needed and none was made.** 113 forms were measured before any code was written: **47 were failing open, all 47 now charge, and 39 negatives held.** Cycle termination is proved by test on two-module, three-module, and self-import cycles, on recursive and mutually recursive callables, and on a clean cycle that must keep its pin. The `.map` decision is unchanged but now rests on firmer ground: deciding by the *selected signature* makes `.map(cb)` and `keep(cb)` go unentered by the **same rule**, with no argument rule and no `Array.prototype` table — the symmetry decides the case rather than merely blocking a fix. One pre-existing assertion was changed and flagged rather than quietly updated: the test that had *asserted* the fail-open now asserts agreement, and its own comment had already called those "NOT legitimate divergences". |
| 2026-08-23 | Layer provision modelled, and value flow closed without a host-knowledge table | **88 forms measured** — 75 against the pre-change tree before any code was written, 13 residue forms after so the surviving hazard entry still reproduces. **26 fail-opens closed, 4 non-blocking under-reports closed, 22 protected negatives byte-identical.** Layer provision was settled by three Locked sentences in `requirements.mdx`: the callback runs, what the layer provides is subtracted, and "the compiler recognizes their effect on `R`" — which makes the recognition mandated rather than invented. It covers one symbol recognised by checker identity against the analyzer's own prelude, so it is not the host-knowledge table this file has been burned by. Subtraction rides the call-graph edge so it survives propagation, and the charge refuses to subtract anything the pin-blocking rule recognises: **before this, `abstract class TypeScript extends Context` bought a native pin over `eval`.** As in the previous lane, the frontend already had the whole model (`isLayerCall`, `resolveLayerExpression`, `checkLayerSatisfaction`, `SMITHERS2101`/`2103`/`2104`), so `poc/src/language/**` again needed no change. The value-flow rule is: enter the callee's visible body and charge only what that body invokes — so `run(cb)` charges, `keep(cb)` does not, `.map(cb)` stays undecidable, all through one code path with no rule about arguments. Termination is keyed on `(callee, callables bound to its parameters)`, both drawn from the program's finite node set, and asserted on recursive and mutually recursive forms, a self-referential layer binding, the negative where mutual recursion never invokes, and two different callbacks through one callee — which is why the key must include the bindings. Byte-identity was verified five independent ways. |
| 2026-08-23 | The module-level argument half, and a handoff note that was a trap | `export const value = run(() => process.pid)` now charges `Host<"process">` through the full route `main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid` and refuses the pin. The same rule was applied in a second place rather than a second rule invented: the initializer walk gained the exact counterpart of the body walk's follow-and-enter, reusing the existing helpers unchanged. **The inherited note was wrong in a way that would have caused damage.** It said closing this required re-keying the walk's *entered-callable* set; that set is what stops a callable being walked twice, and re-keying it would have let two prior lanes' asserted dependency routes be re-derived. The correct shape was a **second** set, keyed on `(callee, callables bound to its parameters)`. A second correction: only the ambient channel failed open, since the module-edge channel already charged inside deferred arguments. 142 forms were measured across the lane and diffed programmatically — 42 byte-identical, 29 changed, of which 27 were fail-opens closed. One route legitimately lengthened and was called out with before/after: the old shorter path came from the deferred-closure over-report, which does not trace an evaluation, and no test had asserted it. |
| 2026-08-23 | Six of eight callable-boundary members closed, and `.map` survives for a principled reason | **351 form-measurements, 320 of them taken before *and* after and diffed by form id: 66 moved — every one a fail-open closing — and 254 were byte-identical with zero routes changed.** One question gained six more answers, all through the existing value-flow helper: a `new` expression resolves to the class (own members read first, so an override wins, then the `extends` chain, so inheritance works); a call result resolves to what the callee returns; an array literal is a positional list; a rest parameter collects into that same list; a destructured parameter binds member by member, with an element default answering only for a property the caller omitted; and a tagged template maps positionally — that last one only because ECMAScript defines `` tag`a${x}b${y}` `` as `tag(strings, x, y)`, the same correspondence the checker uses, and it is asserted with the half that proves it positional. The hard constraint held in eleven programs in one reproduction test: `keep` and `.map` are unchanged at module level, in a body, and one level deeper inside a callable entered through each of the six new channels. **`.map` survives now that an array literal is a followable value because a positional list answers a lookup by index and never by name** — the boundary holds for a structural reason rather than a carve-out. Termination followed the prior lane's correction exactly: no set was re-keyed, and the real trap was that a bindings key must be **structural**, since a list is rebuilt at every call and identity would never converge. |
| 2026-08-23 | Tests asserting fail-opens: the third and fourth occurrences | **Six more pre-existing assertions were recorded fail-opens rather than negatives** — one from the Layer-provision lane and five from the initializer lane, sitting under a comment that read "The residue, named rather than guessed at". Both of those lanes' own reports list all six as *open* in prose, so the tests and the prose disagreed and only the prose was right. Each was replaced in place by its `keep`-shaped twin, with block counts unchanged and no route touched. The hazard log now states explicitly that a residue belongs in the header and never in a negative table. This is the second mechanism this session for a fail-open to become permanent — the first being a coverage document claiming a rule was observed when no case contained it. |
| 2026-08-23 | The last analyzer lane: five of seven residues closed, two justified | 188 forms, **171 measured before the first line of code and re-measured after, diffed by id: 122 byte-identical, 49 moved — every one a fail-open closing. Zero routes changed, not one protected negative moved**, and a third measurement after the header edits showed zero drift. **`keep` and `.map` are byte-identical in all 19 positions** — module level, body, and one level deeper inside a callable entered through each of this lane's five channels and each of the previous lane's six. The eleven-program reproduction test passes untouched, and `src/targets/` held at exactly 123 after the complete code change and *before any test of this lane was added*. No pre-existing assertion was edited, because the previous lane had already unpicked the last of them. Closed: a getter through an instance — where the brief's characterisation was true but **too narrow**, since an annotated concrete receiver one binding away was also failing open because an annotation replaces the checker symbol; a spread argument, flattened positionally rather than by charging every element; an iterated rest parameter under `for…of`, because iterating a list runs every element so the union is what runs; an object spread, decided by one sentence — a spread copies **own enumerable** properties, so object-literal members and class *properties* are republished while class **methods** on the prototype are not; and a multi-return factory, where the union was confirmed rather than assumed after measuring that the old rule made the verdict an accident of source order. |
| 2026-08-23 | Two residues left open, and a word in the log that was simply wrong | The non-literal index stays open and undecidable as predicted: exactly one element runs, so charging all of them is a *different rule*, and the contrast with `for…of` — where all of them do run — is now written into the log beside it. The entry the log called a "collection" was **wrong**: a `Record` or object literal was already followed and already charges, measured. What actually remains is a host container such as `Map` or `Set` — the `.map` boundary under another name. `.forEach` was also deliberately left open and asserted **by name beside `[1].map(cb)`**, which strengthens that boundary rather than eroding it. Two further residues were measured for the first time: a setter, which fails open at a concrete receiver too, and an object spread's evaluation of the source's getters. This was the **fourth** time the hazard log has been found wrong, and twice this session the error was a correct verdict resting on a stale reason. The first entry is now narrowed from nine members to six, each stating why it stays. |
| 2026-08-23 | Seven new residues, measured rather than assumed absent | Closing six members exposed seven more, every one measured and recorded fail-open rather than left implicit: a multi-return factory (followed only to the first return), a non-literal index (predicted in advance), an iterated rest parameter, a spread argument, a class getter reached through an instance (the concrete receiver is charged — the accessor path simply never asks the value question), a collection, and an object spread. The generic-capability-receiver entry's stated *reason* was also corrected: it claimed a class reaching a parameter "is neither a callable nor an object literal", which this lane's own work made false. An entry whose verdict is right for a reason that has since become wrong is a trap for the next lane, which is why the reasons are audited and not just the verdicts. |
| 2026-08-23 | A negative assertion that was a fail-open in disguise | Two pre-existing assertions were changed and both were reported rather than quietly updated. The transitive-graph lane's negative table asserted `run(cb) -> []` as a *negative* while that same lane's own report listed it as a measured fail-open; the entry was replaced with the `keep` form it stood beside. And the "legitimate divergence" test's Layer entry was itself a fail-open in disguise — its two original assertions still pass unchanged, with an agreement case added where both analyzers now report `["Other"]`. A test that encodes a bug as expected behaviour is the quietest way for a fail-open to become permanent, and this is the second one found in this file. |
| 2026-08-23 | The hazard log corrected for the second time, and what remains | `classify.ts`'s header went from seven entries to four, every one carrying a `MEASURED:` verdict and a reproduction; five were retired with "must not return to it" notes, four of which turned out to be one defect under four names. Its summary paragraph was corrected for the second time in the file's history — it had left capability receivers and Layer provision "unmeasured rather than proven safe", and on measurement **`Layer.provide(layer, () => process.pid)` does fail open**. A new entry records that module-level *statements* beyond imports are invisible, left unfixed because closing it needs a purity judgement the spec does not make: an unread `const pid = process.pid` is dead code a native backend may elide, while an unread `readFileSync("x")` is not, and guessing would either over-report every unread module constant or keep under-reporting the side-effecting ones. The file also carries one deliberate over-report in the fail-**closed** direction — a callable reached through a reassigned `let` is entered on its initializer's evidence — on the stated principle that refusing a pin the program might have earned is the safe direction. |
| 2026-08-23 | The Go re-export fail-open closed, and the corpus caught it working | The Go bridge now walks export declarations and follows every re-export and binding form with cycle-safe traversal, producing the same truthful composed dependency paths as the reference. The module-initializer and invoked-where-defined classes were fixed on the Go side in the same lane, while the acceptance controls — type-only re-exports, compile-time asset edges, compiler-owned virtual modules, clean project bindings, and deferred closures — all stayed accepted. All five corpus cases that had been marked `xfail go` now XPASS, which is the contract reporting a fix rather than a person asserting one. Final: JS **234/234**, Go **229 ordinary matches + exactly 5 XPASS**, backend agreement **234/234**, divergences **zero**, full pinned Go tests pass, forkpatch `divergentFromApplied: 0`. |
| 2026-08-23 | A defect in the oracle itself | The JS driver pinned `comptime.target` to `node-es2022` while the Go request sent `options: {}`, and the bridge defaulted to `typescript-node`. **Every comptime case was comparing two compilations of two different programs.** Agreement between them was therefore not evidence of agreement about comptime. Fixed with one shared constant sent to both backends, and pinned by a case. A second oracle hole was closed in the same pass: the native-pin area asserted a dependency route that an **empty** route satisfied in every case, so the "SHOULD show the dependency path" rule was unmeasured — the harness now supports an optional `messageContains` on a declared diagnostic, and the routes are asserted. |
| 2026-08-23 | Corpus 234 → 245, and the subtraction nobody had run | Five re-export markers were retired against a fresh measurement; **four of them declare a `messageContains` route**, so the fork had to reproduce the composed dependency path and not merely the diagnostic code to reach XPASS — the first time that assertion has been load-bearing in a retirement. Eleven cases added: `SMITHERS1507`/`1508` (four refusals plus two controls, covering both branches of the lowerability predicate), and four asset codes plus a control. **A new live Go fail-open surfaced immediately:** `SMITHERS5218` — the fork compiles a **dynamic** asset import into a runtime `import()`, and the emitted program exits 1 with `ERR_MODULE_NOT_FOUND` for a file staged as a compile-time asset. That contradicts two Locked sentences and is the exact failure the static forms were built to avoid: an asset edge must never become a runtime module dependency. Landed as an evidenced `xfail go` and dispatched. The lane flagged that landing a failing case bends the "must pass on both backends" instruction, and explained why it judged "a failing case is a finding" to govern — which is the right call and the reason that instruction exists. |
| 2026-08-23 | Corpus 245 → 260; pinning the portability work found four live Go fail-opens | Five lanes had closed well over a hundred fail-open forms in the reference's native-pin certification and **not one corpus case covered any of it** — the same condition that let the original defects survive at parity. Nine cases now pin the load-bearing classes, each asserting the composed dependency route via `messageContains` rather than the diagnostic code alone. Five pass on both backends; **four fail on the Go fork and are landed as evidenced `xfail go`**: a callback that a visible callee invokes is never entered, so the fork **compiles, certifies, and runs** it; a class instance's method behind an interface-typed parameter, the same shape; the module load graph charged only one link deep rather than transitively, isolated by a probe showing a direct `import "node:fs"` *is* charged correctly; and — highest severity — **a capability an author names `TypeScript` buys a native pin over `eval`**, isolated as a subtraction defect by a probe showing the byte-identical program with the class renamed `Config` is correctly refused. A trust decision made on a name is the class this project treats as most severe, and the reference had the same defect until subtraction was made to refuse anything the pin-blocking rule recognises. Final: JS **260/260**, Go **256 match + 4 xfail**, zero divergent, zero unsupported, zero unmeasured, zero xpass, interop 6/6 both, self-tests 6/6. |
| 2026-08-23 | A wrong case, measured and deleted rather than landed | A case for `SMITHERS1708` was written from the documentation, and the fork accepted it. Probing showed the fork **preserves the authored evaluation order** — identical to the prescribed remedy and to plain TypeScript — so the difference is a reference-side provability limitation, not a fork fail-open. Verdict: wrong case. It was deleted rather than landed as an `xfail`, and the reasoning recorded in the coverage audit. Landing it would have created a permanent false accusation against the fork that every later reader would have inherited. |
| 2026-08-23 | The coverage audit's method was wrong, not just its numbers | The command the page used to compute the fork's diagnostic-code set — a plain grep over `compiler/` — is wrong **in both directions**: it counts `SMITHERS1708`, which appears only as prose in two design documents stating the code is *retired*, and it misses **19 durable codes** the bridge builds by string concatenation. Corrected sets: fork **117** codes (the page said 98), reference-only **100**, and **in-both-with-no-case 27** — the page had said 13. Both sections now print the corrected commands alongside the old-versus-new diff, so the method is auditable and not just the result. A new category was also needed: `SMITHERS4100` and `SMITHERS4117` are cases where **the two implementations mean different rules by the same number**, which no prior subtraction could have surfaced. Six analyzer residues are now recorded as known-uncovered with no case asserting any of them, and the closing claim is scoped to 260 cases with a current exclusion list. |
| 2026-08-23 | Dynamic asset imports on the Go side, and a class the one case did not reveal | The corpus case caught a computed-specifier dynamic asset import compiling to a runtime `import()`. Enumerating the class found the surface was broken more broadly than that one spelling: **every supported literal dynamic asset spelling was rejected as `TS2307`** rather than compiled and embedded; a literal asset dynamic import with no attributes produced `TS2307` instead of the asset-admission diagnostic `SMITHERS5201`; and the dynamic surface did not consistently inherit the established outer/inner attribute diagnostics. All fixed, and the bridge's obsolete pre-loader comment — which still claimed the format loaders were unimplemented — was corrected to describe what the code actually does. The `SMITHERS5218` case now observes `SMITHERS5218@4:24`, identical to the reference. Final on the settled tree: JS **245/245** with zero xpass, zero xfail, zero unsupported, zero unmeasured; Go **244/245 ordinary matches plus the one intended XPASS**; backend agreement **245/245 identical observations**; divergences **zero**; forkpatch `divergentFromApplied: 0`. The lane's first full corpus attempt overlapped a live lane in `poc/src/targets/**` and produced eight temporarily-unmeasured JS observations; it re-ran the exact command after that lane settled rather than attributing the transient failure to itself. |
| 2026-08-23 | The Go CLI default-mode defect, measured rather than argued | No `.sm` program can observe it, because the conformance driver always sends an explicit lowering mode. The assertion therefore went into the harness self-tests, where the request construction that would regress actually lives. It checks both source-level (every request reads one named constant) and live over the wire: omitted mode → refused, unknown → refused, `internal` → two Smithers diagnostics, and **`identity` → exit 0 with zero diagnostics on that same program**. That last row is the original defect's consequence measured directly rather than described. **Demonstrated failing: restoring one literal turns it red.** |
| 2026-08-23 | A second subtraction, computed for the first time | `COVERAGE.md` was re-derived with printed commands rather than patched. It had still claimed "four of the five refusals are `xfail go`" — false. More importantly, the page had only ever computed the set of rules present in **one** implementation and no case. The other subtraction had never been run: **13 diagnostic codes exist in BOTH implementations and in NO case.** That is the set `SMITHERS1507`/`1508` were sitting in when the page wrongly described them as covered. Among them, `SMITHERS3005` gates the entire 16-case native-pin area and is itself unprobed, and `SMITHERS3006` is uncoverable because the harness cannot observe warning severity. Six of the thirteen are writable and remain to be written; one, `SMITHERS5215`, is undecidable from the conformance side and was recorded rather than guessed. |
| 2026-08-23 | Honest accounting of what a new case proves | Of the 23 cases added, **7 demonstrably fail against the behaviour they pin** — five against the live Go fork, one against a reverted harness, and the comptime-target one. The other 16 pin current behaviour only: the lane could not revert `poc/**` or `compiler/**` to reproduce their historical defects, and its report says so case by case rather than claiming reproduction it did not perform. Still unwritten: `SMITHERS1507`/`1508` have no case in either implementation, twelve asset codes remain unpinned, the Go CLI default-lowering-mode defect has no harness assertion, and COVERAGE.md needs a full re-derivation against the enlarged corpus. |
| 2026-08-23 | The contract cannot see the surface that hid it | **Zero of the 218 corpus `.sm` files contain a re-export.** The entire re-export surface is unpinned, which is exactly why an all-forms-fail-open defect survived at parity with zero divergences. `21-native-pin`'s nine cases are all single-module. The corpus already supports multi-module cases (`*.mod.sm` plus a `"modules"` key, used in areas 04, 05, and 15), so this is a coverage gap rather than a harness limitation. Two module-level fail-opens remain open and named rather than hidden: ambient authority in a module-level initializer (`export const pid = process.pid`), and the module **load** graph (`import "./a.sm"` where `a.sm` itself imports `node:fs`). The second needs a frontend-agreement decision and is not a lane-local fix. |
| 2026-08-23 | Six Go-side fail-opens closed, including the CLI's default compiler | **F1, the most severe:** `LoweringIdentity` was the empty-string zero value, and `cmd/smithersc-go/main.go` built its request without a `Lowering` field, so every positional CLI invocation compiled `.sm` through the TypeScript checker only — no rows, must-consume, comptime, durable, assets, native pin, or foreign trust — with `NoEmitOnError` forced off. The mode is now an explicit choice that must be stated; an omitted mode is refused rather than silently defaulted to the weakest one, and the CLI selects internal lowering. **F2:** the retired `vibelang:flows` alias is gone. **F3:** the trust marker is parsed exactly rather than by substring, closing all three holes — a `@module` header no longer certifies the exported function beneath it, `@moduleResolution` no longer matches as `@module`, and `@throws\n * {never}` no longer assembles across a line break. **F5:** `{never}` is now case-sensitive and internally consistent. **F6:** `SMITHERS1507`/`1508` ported. **Import attributes:** `SMITHERS5203`/`5204`/`5205` ported, including a template-literal hole the census had not found. Final: backend agreement **211/211**, divergences **zero**, forkpatch `divergentFromApplied: 0`. The `comptimeTarget` mismatch was left alone and documented, because the specification does not define a default and the remaining difference is in the conformance adapters rather than the compiler defaults — a speculative change there would have settled an undecided question by accident. |
| 2026-08-23 | Known-open: an unobserved fail-open divergence surviving the project rename | The rename (VibeLang → Smithers, `.vibe` → `.sm`, `vibec` → `smthrs`) completed in the TypeScript reference — `grep -rn vibelang poc/src src compat` returns zero hits — but the Go bridge still carries the old name as an **accepted alias**: `compiler/forkbridge/durable.go.txt` maps both `"smithers:flows"` and `"vibelang:flows"` in `durableModuleSpecifiers`, and `lowering.go.txt` lists `"vibelang:flows"` in `compilerModuleSpecifiers`. So `import { durable } from "vibelang:flows"` lowers as a real durable Flow on the Go backend, while the reference does not recognise that specifier as compiler-owned at all. **No corpus case writes `vibelang:flows`, so the differential oracle cannot see it.** This is the honest limit of the zero-divergence result: it proves the two implementations agree on the 211 questions the corpus asks, not that they agree in general. A census lane is diffing the full accepted surface of both backends — specifiers, extensions, import attributes, diagnostic codes, flags, and trust escape hatches — to find the rest of this class. |
| 2026-08-23 | The portability removal: 147 files, −24,597 lines | Carried out against the spec's own worklist after a checkpoint commit made it reversible. **The split I briefed as the delicate part did not exist on the TypeScript side.** `classify.ts` was described as computing the surviving Context/Layer rows and the withdrawn classification through one path; measurement showed all six of its diagnostics were `SMITHERS3001`–`3006`, both non-test consumers read only `.diagnostics`, `project-compile.ts` never read `analysis.functions`, and `grep 'Module<\|Host<' semantic.ts` returns nothing — those spellings were the file's **private pin vocabulary**. The surviving rows were always `semantic.ts`'s. The file held a *second, parallel requirement analysis that fed only the pin*, so it went whole. **The real load-bearing split was on the Go side.** `nativepin.go.txt` exported four symbols, two of them survivors: `assets.go.txt` uses the binding walk for asset identity through a re-export, and `lowering.go.txt` uses two more for the failure channel and `SMITHERS1510`. Reachability closure from the surviving roots was 77 of 98 declarations. The 21 pin-only declarations went, the provably write-only sinks went, and the walk was converted from a dependency type to `bool` — which is what removes the literal string `"TypeScript"` from the fork. The lane **deliberately stopped short of narrowing the traversal itself**, because that meant a new asset-provenance walk whose early-return semantics it could not prove equivalent and whose error direction is treating a foreign value as compiler-owned; it renamed the file `nativeprovenance.go.txt` rather than leave a name that lies about what remains. |
| 2026-08-23 | Survivors proven, a brief corrected, and a regression recorded rather than hidden | A new tripwire in `project.test.ts` asserts Context rows charged and propagated, two capabilities composed, `Layer.provide` subtracting exactly what it provides, `panic` charged on an unannotated foreign call, and no `SMITHERS30xx` reaching a caller — so a deletion that silently weakened the capability system would now fail rather than pass quietly. `fork_reexport_test.go` was rewritten from pin-observed to survivor-observed. The brief's "9 portability cases elsewhere" was **wrong**: only two cases outside area 21 asserted a withdrawn obligation, three had withdrawn *rationale* over a surviving observable and were re-cited, and **all four `20-host-globals` cases are the capability system and stay untouched**. One genuine loss is recorded rather than papered over: COVERAGE §17.11, "asset loading adds no runtime platform requirement", is now **UNCOVERED** — the pin was its only `.sm`-observable channel and there is no writable replacement. The `./targets` subpath export was removed outright and recorded as a **breaking change to a package published at 0.35.0**; the version was deliberately not bumped, so that decision is not buried in a deletion diff. Corpus 260 → 231, four `xfail go` markers retired rather than fixed. Gates on the settled tree: conformance **231/231 both backends, zero divergences**, Go gate 363/363, Node gate 100/100, POC 1,032 pass / 0 fail with the drop from 1,164 reconciled exactly. |
| 2026-08-23 | Full combined gate after the portability removal | Four of five green on a quiescent tree. `npm run check` pass with **Go 363/363, skipped 0** — the fork tests genuinely execute rather than skipping. `npm test` pass across 14 files. Conformance `--backend both` pass at **231/231 with zero divergences**. Docs build clean. `npm run verify:pack` **fails** on one thing: `docs/COMPATIBILITY_API.md:137` links relatively to `src/pages/reference/cli.mdx`. That file is one of only two docs in `package.json` `files`, and `docs/src/pages/**` is not shipped, so the link resolves to nothing for anyone who installs the package; the path is also missing its `docs/` segment and would 404 on GitHub. It belongs to the session that owns the documentation and was reported rather than edited. **This is the third occurrence of that defect class today** — two README links to unshipped files were fixed earlier the same way. It is invisible to every source-tree gate *including a clean docs build*, because `verify:pack` is the only gate that builds a real tarball and reads it back. There are exactly two files where a relative link is a packaging bug rather than a documentation bug. |
| 2026-08-23 | The packaging link fixed, and the class closed rather than the instance | `docs/COMPATIBILITY_API.md:137` now points at `https://docs.smithers.sh/reference/cli` rather than a relative path — the published-docs form chosen over a GitHub blob URL because it serves a reader who has just installed the package and does not pin to `main`. The link carried **two** defects, not one: it pointed at an unshipped file, *and* its relative path was missing the `docs/` segment, so it would have 404'd on GitHub even if the file shipped. Because this was the third instance of the class in one day, the owning session then checked the class rather than the line: `package.json` `files` ships exactly three Markdown documents — `README.md`, `docs/COMPATIBILITY_API.md`, and `docs/TYPESCRIPT_FORK.md` — and every relative link in all three was audited. That was the only one; the rest are absolute. The drift banners in the two shipped docs deliberately use plain code spans rather than links for `docs/DECISIONS.md` and `docs/src/pages/**`, precisely because neither path ships. **Operational rule now recorded on both sides:** any edit to those three files requires `verify:pack`, not a docs build — `verify:pack` is the only gate that builds a real tarball and reads it back, and a clean docs build says nothing about it. |
| 2026-08-23 | The tarball independently confirms the export removal | `npm run verify:pack` → `{"ok":true,"tarball":"smthrs-0.0.1.tgz","files":510,"exports":43,"consumers":["node","bun"]}`. Exports moved **44 → 43** and files **524 → 510**, which is the `./targets` subpath removal showing up in a real installed package rather than only in a source diff — the removal is confirmed by the one gate that exercises a genuine consumer install under both Node and Bun. The `0.0.1` in that filename remains wrong against the published `0.35.0` and is unresolved. This measurement was taken by the session that owns the documentation while two lanes were mid-edit in `poc/src/language/**` and `compiler/**`; it is recorded as their measurement, and the figure will be re-taken on a quiescent tree in the final gate rather than inherited. |
| 2026-08-23 | The durable and build probe: one class, four checks, three fail-open — and it reaches the signed artifact | Two subsystems that had **never** been probed this way (`poc/src/durable/**`, 16,267 lines; `poc/src/build/**`, 9,688) were audited against the failure classes this codebase actually produces. Every defect found was the same shape: *recognition* correctly follows resolved checker identity, but the **rule acting on it enumerated only `import … from`**. The missing members were always `export … from`, `export *`, `export * as`, `import x = require(…)`, and dynamic `import(…)`. **D1, high:** `implementation-contract.ts`'s `assertClosedImports` — whose own comment documents fixing a *prefix* fail-open earlier the same day, while the *syntactic form* was never enumerated. A real installed npm package reached through `export { x } from "pkg"` produced a `compiler-derived` contract whose `projectDigest` never covered that edge. **It reaches the signed artifact:** the resulting worker pool bundle contains `__exportStar(require("evil-pkg"), exports)` — a package that is *not in the bundle* whose SHA-256 becomes `bundleDigest` in the signed manifest. So the signature attests to a bundle that silently requires code the signature does not cover. **D2, high:** `pool-bundle.ts`'s `assertBundleImports` — the *second* layer, the one whose whole job is "worker bundles must be self-contained" — had the identical blind spot. **Defense in depth sharing one blind spot is one layer**, which is exactly why D1 travelled all the way to a signed manifest unchallenged. |
| 2026-08-23 | The same class in the build subsystem, and a generated module shadowing a real one | **D3:** in `source-assets.ts`, `import x = require("./config.json")` was the one form of roughly twenty that skipped loader selection **entirely** — zero diagnostics, zero modules, no dependency edge. It also answered a question the brief had asked speculatively: *can a generated module shadow a real one?* **Yes.** A path reached only by import-assignment was invisible to the code/asset reconciliation, so a generated asset module was issued for a real code module; that now raises `SMITHERS5215`. **D4:** in `comptime-intrinsic.ts`, `import c = require("smithers:comptime")` had its call **recognised and replaced — full intrinsic authority granted** — while its unerasable runtime edge to a module with no runtime existence survived into lowered output reporting `ok: true`. The same held for `export * from` the virtual module and for dynamic `import()`, on both compiler-owned virtual modules. Each fix carries a measured pre-fix reproduction, a per-form verdict table naming which members were **already correct**, and both-direction tests verified to fail against `git show HEAD:` code and pass after. |
| 2026-08-23 | Two findings deliberately left for other lanes, and a fifth test asserting a bug | **D5:** the durable lowerer implements **no postfix `!` at all** — only the retired `.unwrap()`, matched by **name text** at two sites. Postfix `!` is a normative MUST in the durable specification, which is **not** withdrawn, so this is a real gap rather than removal debt; it is blocked behind the live grammar lane and folds into the `.unwrap()` → `!` migration. **D6:** the comptime imposter guard rejects a user's own function named `comptime`, contradicting `comptime.mdx` — and the behaviour is **encoded as intended by two existing tests**. That is the fifth time this session a test has asserted a known defect as correct behaviour, and the second time the asserting tests were the only thing standing between the defect and a fix. |
| 2026-08-23 | What was probed and found clean | Recorded so the next lane does not re-probe it: the underivable-Action skip fails closed at all five use sites; `deliverSignal` satisfies its specification paragraph sentence by sentence; token authorization, persisted-contract verification, authenticated-coordinator sandbox binding, and durable schema derivation are sound; comptime hermeticity holds under eleven distinct ambient-access attempts with three positive controls passing; the Deno loader sandbox and its fail-closed runtime probe hold; and loader selection is genuinely static — a third-party loader cannot register at all, and a project loader cannot shadow a built-in extension or type. A clean probe is evidence, and it is worth as much on the record as a finding. |
| 2026-08-23 | Eight grammar patches removed, and the fork mechanism proved still trustworthy | The specification admits exactly one grammar addition — `if (const x = f(); cond)`, from TC39 Declarations in Conditionals — and withdrew the other eight. Seven patches were removed from the series, `0800-regenerate-ast` regenerated rather than hand-edited, and `0900-smithers-grammar-tests` reduced to the survivor, leaving three. `poc/src/language/control-flow.ts` and its planning, semantic, lowering, formatting, recovery, and test consumers went with them; `recover.ts` is now conditional-declaration-only and the formatter retains only that source mask. **The round-trip contract holds:** `forkpatch status` reports `divergentFromApplied: 0`, `unapply` yields a **byte-identical pristine upstream tree**, the series reapplies successfully, and the mechanism's own tests pass 19/19. That round-trip is what makes the fork reviewable at all; had it broken, the series would have stopped being evidence of anything. Full pinned-checkout run passes. Conformance **207/207 on each backend with zero divergences** (down from 231 as withdrawn-form areas were deleted), Go gate 343/343 with **skipped 0**, POC 999 pass / 1 skip / 0 fail. The test drop is reconciled exactly rather than approximately: 39 language tests removed by this lane, six added concurrently by another, netting the observed −33, with the language-only count moving 184 → 145, exactly −39. The lane confirmed it changed neither `Optional<T>` nor `.unwrap()`, so the two remaining migrations start from a clean base. |
| 2026-08-23 | The second probe: `doctor` reported health it never measured | `smithers doctor` returned a **hardcoded `ok: true`**. It conflated absent, broken, and hung tools, and in at least one case reported a tool's **stderr as its version banner**. A diagnostic command that always says healthy is the purest form of the failure this session kept finding — a check that passes without doing its work, alongside a `go test` step that skipped 143 records and printed `ok`, and a `node --test` glob that exited 0 having run nothing. It now derives its verdict, names each failure reason, and exits nonzero — while correctly leaving the environment healthy when an optional toolchain such as Zig is simply absent. |
| 2026-08-23 | One import specifier silently denoting two different modules | In `.sm`, the specifier `./dep.js` with a real `dep.js` sitting beside `dep.sm` compiled **the wrong module**, reporting `ok: true`. The `.js` branch was inconsistent with its own `.mjs` and `.ts` siblings, which already let the literal file win — so this was not a missing rule but a rule applied to every extension except one. Same shape as the Go backend's missing `export … from` walk: every relevant rule spelled, one member of the class never handled. |
| 2026-08-23 | A capability obtained without ever being provided | `Schedule.retry` swallowed the missing-`Sleeper` panic and slept on the **real host timer** — including under `TestPlatform`, whose `TestClock` reports frozen time. So a test that believed it was controlling time was quietly sleeping on the wall clock, and a capability the program never provided was silently supplied by the host. This was the **only** `catchPanic`-over-`context()` in the entire source tree, which is what made it findable; `Sleeper` now travels in the bundle. A capability system whose whole purpose is that authority must be granted explicitly had exactly one place where it was not. |
| 2026-08-23 | One reported spelling, twelve failing forms — and a fixture that was lying | The comptime imposter guard recognised the intrinsic by resolved symbol and then ran a **name-based gate** on everything that failed it. One spelling was reported; measurement found **twelve** — local declarations including generic ones, const arrows, unrelated named, aliased and namespace imports, object properties, class methods, parameters, local shadows, and re-export chains — while seven further forms were **already correct**. Fixed by deleting the name gate entirely, so the surviving diagnostic fires only on a genuinely unbound identifier. **Three pre-existing assertions were changed and each is named in the lane's report**, including one in `test/cli.test.mjs` whose fixture `invalid.sm` was **actually valid source** — a test, a fixture, and a compiler defect agreeing with each other and all three wrong. The conformance case that supposedly covered this turned out to be the same form as the reproduction rather than an independent one. |
| 2026-08-23 | A fix written, measured, and deliberately reverted | Concurrency's cancellation default diverges by call shape: `mapUnordered(…, 2)` ignores a cancellation that `mapUnordered(…, {concurrency: 2})` honours. The lane wrote the fix, measured it, and found it breaks ten tests by changing documented public semantics in an area `docs/DECISIONS.md` marks **Open**. It reverted and left a `KNOWN DEFECT` comment carrying the measurement. That is the correct call: settling an Open decision by accident, inside a probe lane, is how a language acquires semantics nobody chose. |
| 2026-08-23 | `Optional<T>` withdrawn, in two lanes because the first was scoped too narrowly | The specification withdrew `Optional<T>` entirely; absence is now `T \| undefined` with ordinary narrowing, `?.`, and `??`. The first lane removed the runtime module, the lifting and propagation rules, the Go lowering, the `./optional` **published subpath export** (the second breaking change to a live 0.35.0 package today), and the corpus area — then **stopped at its ownership boundary and listed the consumers it could not reach**, leaving the tree red with 88 type errors. That was the correct behaviour under a brief I had scoped wrongly: it neither reached across the boundary nor stubbed the module back to make the errors disappear. A completion lane then migrated every consumer — runtime, data, schema, platform, concurrency, examples, the durable pool bundle's runtime-contract lists, and a Go integration test — to `T \| undefined`, with **no alias, stub, replacement type, or lifting helper**, since the specification permits reconsidering an `Optional` container later as an ordinary library type but forbids it acquiring lifting, propagation, or nesting. Root `src/optional.ts` was deleted on stated reasoning: it is compiled by the build, both its sources are gone, its subpath is already removed so nothing can reach it, and retaining it would ship a withdrawn concept inside the tarball. Final: `bun run check` clean, `bun test` 998 pass / 1 skip / 0 fail with a net test delta of **zero** (two Optional tests removed, two union tests added), Go gate **337/337 with zero failures and zero skips**, conformance **197/197 on each backend with zero divergences**. |
| 2026-08-23 | Two habits worth keeping from that lane | It **verified another lane's security fix was intact rather than assuming it**: `pool-bundle.ts` had just received the fix for the signed-artifact defect, so it diffed the file against the checkpoint and confirmed the recursive re-export walk was byte-unchanged before editing three unrelated lists in it. And it **strengthened a gate while repairing it** — the stale Go integration test now asserts positively that `?.` and `??` survive lowering verbatim, plus negatively that `__smithersSome`, `__smithersNone`, and `__smithersOptional` appear nowhere in the output. It also stopped twice on judgement calls that were not its own: the `unwrapOptional`/`__vsUnwrap` emitter hook, which despite its name is the hook for the removed non-null assertion and therefore a postfix-`!` decision, and a `Queue` null/undefined ban that the union no longer strictly requires but whose loosening is a library decision the specification does not make. |
| 2026-08-23 | A verification gap, found by a later lane rather than by its own | The grammar-reduction lane ran the Go gate and reported 343/343, but **never ran the Node gate**. It is at 107 tests / 99 pass / **8 fail**, and all eight drive withdrawn-form fixtures — `divergent-forms.sm` with `defer`/`errdefer`/labeled block values, `verdict:` and switch-expression formatter fixtures, and the deleted `11-expression-if-switch` corpus area. The removal itself was correct; the verification was incomplete, and the failures sat undetected until an unrelated lane ran the gate for its own reasons and measured that none of them contained `Optional`. Two stale `conformance/COVERAGE.md` citations to deleted `03-optionals` cases were found the same way. Both are now folded into the remaining lane. **A gate that a lane does not run is indistinguishable from a gate that passes**, which is the same lesson as the skipping `go test` and the empty-glob `node --test`, arriving this time as an omission rather than a defect. |
| 2026-08-23 | The fourth and last withdrawal: `.unwrap()` → postfix `!` | The delicate one, because it changes what a token *means*, and both halves were required — adding `!` as the propagation operator while removing the TypeScript non-null assertion including `x!: T` definite assignment, since doing only the first leaves `!` meaning two things. The existing `.unwrap()` rules were **transferred rather than reinvented**, reusing the early-return lowering machinery instead of writing a second one. The `unwrapOptional`/`__vsUnwrap` emitter hook — which despite its name was the hook for the removed non-null assertion, and which the previous lane correctly declined to touch — was resolved here. The durable lowerer's two `.unwrap()` sites, which matched **by name text**, now resolve by binding identity, closing a normative gap in the *non-withdrawn* durable specification. Final: `bun run check` clean; POC **1,000 pass / 1 skip / 0 fail**, reconciled as +2 intentional tests for the retired and near-miss directions; forkpatch round-trip intact with both divergence counts zero; conformance **201/201 on each backend with 201/201 agreement and zero divergences** (+4 new cases); Go gate **339/339, zero failed, zero skipped**; and the Node gate brought from 99/107 with 8 failures to **106/106 with zero**. The only authored `.unwrap()` remaining in the tree is the deliberate rejection fixture, and no stale `03-optionals`, `unwrapOptional`, `__vsUnwrap`, or durable unwrap-name matcher survives. |
| 2026-08-23 | A test removed rather than converted into a false assertion | One Node test existed solely to assert the now-withdrawn value-loop syntax. Rather than convert it into an assertion about behaviour the language no longer has — which would have kept the gate green while quietly encoding a withdrawn rule as expected — it was removed, and the one-test drop reconciled explicitly. That is the correct disposal for a test whose subject no longer exists, and it is the inverse of the five occasions this session where a test was found asserting a known defect as correct behaviour. |
| 2026-08-24 | Final combined gate: all six green, on a quiescent tree, after all four withdrawals | `npm run check` pass with the Go census at **339 ran / 339 passed / 0 failed / 0 skipped**. `npm test` pass with the Node gate at **106/106** across 14 files. Conformance `--backend both`: JS **201/201**, Go **201/201**, **201/201 identical observations, zero divergences, zero unmeasured, zero xpass, zero xfail**. Harness self-tests 6/6. Docs build 77 files. `npm run verify:pack` → `{"ok":true,"sha256":"83bea807cb5f6ff6ca000194d11351a75271eb6c2140342412c1b28cdd39650e","inventorySha256":"71fd11f57a7612a3090b3fb80c79c9cbecfe1fde6ea773ff9faeffbb67b40a3c","files":499,"generatedFiles":452,"exports":42,"consumers":["node","bun"]}`. **The export count is the withdrawal measured in a shipped artifact rather than a source diff: 44 → 43 when `./targets` went, → 42 when `./optional` went**, with files 524 → 510 → 499. Any later source or script edit supersedes these hashes. |
| 2026-08-24 | Four stale release fixtures, and the lesson applied one iteration too late | Getting the package verifier green took four rounds, each surfacing one more consumer of withdrawn machinery: the smoke fixture asserting `Optional` on the installed package; its `.sm` source still calling `.unwrap()`, correctly rejected with `SMITHERS1206`; `HashMap.get(...).match({some, none})`, whose lookup now answers with `T \| undefined`; and the same pattern in the type fixture. Each was fixed individually before the class was swept — precisely the mistake this session has documented eighteen times, committed here by me rather than by a lane. A single `grep` across `scripts/release-fixtures` and `test/fixtures` for `.unwrap()`, `Optional<`, `defer`, and `break :` would have found all four at once, and is what finally confirmed the class was closed. The fixtures now assert the withdrawal **positively**: that `./optional` and `./targets` are absent from the installed export map, that `Optional`/`encodeOptional`/`decodeOptional`/`__vsOptionalSome` are absent from the runtime namespace, and that a missing key answers `undefined` in both directions. Since `verify:pack` is the only gate that installs a real tarball, it is the only place the withdrawal can be checked as a shipped fact. |
| 2026-08-24 | The two backends had silently disagreed for a day, and the oracle reported 201/201 | The `TypeScript` requirement survived the withdrawal in `poc/src/language/semantic.ts` — eight producer sites and nine consumers — and reached users directly as `requirements[1]: TypeScript` on every function plus `SMITHERS2102 unsatisfied requirements TypeScript` at the top-level call, against a specification that denies the requirement exists in two separate pages. **It was found by writing one ordinary program and running the CLI on it. Five green gates did not see it.** The cause is structural: the portability removal deleted `poc/src/targets/`, which held a *second, parallel* requirement analysis feeding only the pin; the frontend's own rows are a different code path and were never touched. **The severe part is what the fix uncovered:** the Go backend had nothing to remove, because the earlier lane had already taken the member out of the fork. So the reference and the fork had produced **different requirement rows for the same program since 2026-08-23**, while conformance reported 201/201 with zero divergences — because no corpus case made a top-level call into a foreign-importing function. The lane proved this rather than asserting it: both new cases were measured **divergent before the fix** by stashing it, rebuilding, re-running, restoring, and byte-diffing. This is the clearest possible demonstration of the limit recorded elsewhere in this document — a zero-divergence result means the implementations agree on the questions the corpus asks, and nothing more. |
| 2026-08-24 | The member removed, the mechanism kept, and a subtraction made stricter | Per-site verdicts rather than a blanket deletion: **five** producer sites lost only the `add("TypeScript")` line because their condition still guards a live rule (foreign constructor → `SMITHERS1504`, foreign property read → `SMITHERS1506`, `recordForeignBoundary`'s six callers → the `panic` channel, foreign call edges → failure rows); **four** checks went entirely because the condition itself was only ever the withdrawn portability classification (`any` in a signature, `any` in a body, an `eval` call, and a bare foreign identifier reference — that last decided rather than deleted, on the reasoning that every *executable* consequence of touching a foreign value is charged by a different site while a bare reference has none). Two helpers became dead and went with them. The one special-casing consumer was `missing.delete("TypeScript")` inside `checkLayerSatisfaction`; removing it makes Layer subtraction **stricter, never looser**. Survivors were re-measured individually rather than assumed: Context rows 8/8, layers 7/7, host globals 4/4, durable 6/6, foreign calls 27/27. Three new corpus cases — including a refusal using `messageContains`, so a refusal naming the *wrong* requirement cannot pass. Gates: POC 1,001 pass, Go 339/339, Node 106/106, conformance **204/204 on both backends with zero divergences**. |
| 2026-08-25 | **A correction to this document's own method: `--backend both` never gated on Go** | `conformance/runner/run.mjs` computed its exit code as: fail if the reference has failures; then a Go branch reachable **only** under `--backend go`; then `return 0`. So a run that measured *both* backends fell through to success no matter how many Go cases failed or how far the two implementations had drifted — and a divergence is recorded as a Go-side `fail`. **This matters because the exit code was quoted, in this document and in reporting, as evidence of zero divergences.** The printed scoreboard lines were real measurements and remain so; the exit code beside them was not evidence about Go, and treating the two as one fact was wrong. This is the **fourth** instance of the same shape in this repository — a Go step that skipped 143 records and printed `ok`, a `node --test` glob that exited 0 having run nothing, a `doctor` that returned a hardcoded `ok: true`, and this — and the most consequential, because it sat under the project's headline number. Fixed so `both` gates on either backend, verified by measurement in both directions: with one divergence present the runner now returns **1** where it previously returned 0. A fifth instance was found in the same sweep and fixed alongside it: the runner exited 0 having measured **zero** cases when a filter matched nothing. |
| 2026-08-23 | Naming debt worth one line | The corpus area `18-typescript-requirement` is now misnamed: the requirement it is named for is withdrawn, and its four cases were correctly re-cited to surviving observables (`eval` stays usable, type-only imports add no runtime requirement, a class `static {}` block is rejected) with explicit withdrawal notes. The cases are right; the directory name asserts a concept the language no longer has. Renaming it is cosmetic and was deliberately not bundled into a removal diff, but a reader arriving at that path will be misled before they open a file. |
| 2026-08-23 | Review hygiene, unresolved | Twenty-three agent-authored lane reports (`poc/C*-REPORT.md`, `poc/W*-REPORT.md`) sit in the working tree; eight are already committed and fifteen are staged. None of them ship — `package.json` `files` includes only `poc/dist` — so this is repository clutter, not a distribution defect. Removing committed files is a repository decision left to the human reviewer rather than taken unasked. |
| 2026-08-26 | A correct refusal that tells the author to fix code they did not write | The Go fork's `actionFor` set its error schema from a legacy placeholder and **never read an Action's declared failure channel at all**, so it compiled and ran a program declaring two Error classes whose durable contract identities collide — the reference refuses it. That fail-open is fixed and now pinned by `17-durable/two-error-classes-whose-durable-identities-collide-are-rejected`, with the benign direction pinned beside it by `...-with-distinct-durable-identities-compile`, which is also the first failure-channel case that **runs** on both backends (the existing benign case scores `unsupported` on the fork, whose `smithers:flows` surface declares no `descriptor`). What is **not** fixed: both backends now refuse with the sentence *"higher-order and dynamic calls are unavailable in durable source lowering"*, which is **false of the program** — `Pick.run({ key: input.key })` is an ordinary compiler-bound Action call, and the reference reaches that text only by falling through to the generic tail of `lowerExpression` (`poc/src/durable/source-compiler.ts:1213`). The fork reproduces it verbatim to hold backend agreement, so the misdescription is now in two places. The verdict is right; the stated reason is a swallow artifact, and an author hitting it is sent to look for a higher-order call that is not there. Deliberately **not** pinned via `messageContains`, so repairing the sentence does not break the corpus. This is the eighth instance of *correct verdict, stale reason* recorded here, and the second in which the wrong reason is user-facing rather than internal. |
| 2026-08-26 | The judge could certify an agreement it had never checked, and the file that would have caught it is not gated | Re-deriving COVERAGE.md's flagged `104 − 77` arithmetic turned up why it never reproduced: **the corpus declares codes from three families and the subtraction only ever looked at one.** Of 76 declared codes, 7 are `TS`/`VCT`, so the SMITHERS count is 69, not 77; and the fork's set was undercounted because 18 of its codes are built as `durableCode("NNNN")` rather than spelled literally. Honest, with the exact commands now recorded beside the numbers: reference **107**, fork **109**, intersection **88**, corpus **69** — all 69 inside the intersection — so **19** codes are in both implementations and in no case. Chasing the `VCT` half surfaced a live defect in the harness's own judge: `conformance/runner/judge.mjs` canonicalized **any** `SMITHERS19xx` to `VCT10xx` for **both** backends, because the Go comptime port renumbers the reference's `VCT10xx` that way. But the reference *also* spells `SMITHERS1900/1901/1902`, where they are the **formatter's** mask-budget, overlapping-mask and overlapping-edit rules (`poc/src/language/format.ts:646/667/700`) — nothing to do with comptime. So two unrelated rules were folded onto one contract code, and **measured, not argued**: the pre-fix judge returns `pass` for a case declaring the comptime rule `VCT1001` when the reference emits the formatter's `SMITHERS1901`. Latent rather than live — the formatter is reachable only via the `smithers format` subcommand (`src/cli.ts:1505`), never via `compileProject`, and no case declares a `SMITHERS19xx` — but latent in the one component whose whole job is to certify. Fixed by scoping the alias to the fork, translating each side of the agreement comparison under its own backend identity, and adding a harness-integrity violation (`run.mjs` exit 3) if a reference observation ever carries a `SMITHERS19xx`, so it cannot go live quietly. Corpus unchanged at 424, exit 0 — the fix is deliberately behavior-preserving on today's data, which is why it is proven by five direct assertions instead (fork alias still works; reference no longer aliased; same number on both backends is no longer agreement; the guard fires; ordinary codes untouched on both backends). |
| 2026-08-26 | A green, working check that no gate runs | `conformance/runner/selftest.mjs` holds the assertions about the **harness** rather than the language — the ones a differential corpus is structurally blind to, including the request-shape assertion written after `smithersc-go` was found reporting clean compiles on programs it must refuse. It passes, 0 skipped, and **nothing runs it**: not `npm test`, not `npm run check`, not `release:verify`; it appears only as a command in `conformance/README.md`. The corpus itself *is* gated (`test/conformance.test.mjs`, via `scripts/node-test-gate.mjs`) — that part I checked before claiming otherwise — so the gap is the self-tests alone, now 19 assertions after this session's five. This is the same class as the five gates already recorded here that passed without doing their work, in a new place: not a check that answers wrongly, a check that never answers. **Not yet fixed** — wiring it requires editing `package.json` while a lane is live, and this session has twice destroyed uncommitted work by touching a shared file underneath a running lane. Deferred to the quiet tree with the rest of the gate sweep. |
| 2026-08-26 | A gate sweep that reported 151 failures the tree did not have — my invocation, not a regression | Running the five gates serially on a quiet tree, `bun test` came back **1277 pass / 151 fail / 18 errors**, dominated by 122 TDZ `ReferenceError: Cannot access 'X' before initialization` across fifteen unrelated symbols (`TestPlatform`, `Stream`, `Queue`, `Instant`, `ErrorCodecError`, …). That signature reads exactly like a circular-import regression from the two lanes that had just landed. It was not one, and it was worth not reporting it as one: **I had run `bun test` from the repository root instead of from `poc/`.** Measured both ways on the same tree — from `poc/`, 1449 tests across **104** files, **1448 pass / 1 skip / 0 fail**, matching the concurrency lane's own figure exactly; from the root, **124** files. The extra twenty are 15 `test/*.test.mjs` written for `node:test`, `conformance/runner/selftest.mjs`, and **4 fixtures under `test/fixtures/node-test-gate/` that fail and skip on purpose**, since their whole job is to prove the node gate refuses a suite that skips. Two hazards recorded rather than one: the repository has no guard against a root-level `bun test`, and the file count (104 vs 124) is the fastest way to tell the two apart before reading a single stack. The remaining four gates were green on the same sweep — root `check` including the Go gate, root `npm test`, conformance both backends at 424, and `verify:pack` (511 files, 42 exports, `node` and `bun` consumers). |
| 2026-08-26 | Round six: eleven fail-opens, two of them introduced by round six's own fixes | Two independent reviewers, both **not LGTM**. The worst was a certified runtime panic: a program passed `check` with `ok: true`, a layer satisfied its declared requirement row, and it panicked with `capability 'Log' was not provided` — because TypeScript subtype-reduces `typeof Db \| typeof Log` to `typeof Db`, so the row was **misattributed** rather than empty. The second reviewer then found the call graph was keyed on `ts.isCallExpression`, so every non-call invocation form — tagged templates, `new`, `super()`, `Symbol.iterator` through spread/`for…of`/destructuring, `yield*`, `toString`, `toJSON`, thenables, decorators — dropped the row entirely; the *foreign* half of each of those was already modelled and only the authored half was missed. **Every enumerated class came back two to three times its reported size**: 7 receiver forms → 21 → 34 measured on the fork; 6 detached spellings → 17; 11 callback positions → 20; 1 coercion site → **46**. Two defects were **ours, introduced while fixing this round**: `(Db.context)()` was refused because a parenthesised immediate callee was mistaken for a detached reference (the seventh over-correction this repository has shipped, and the fork carried it too), and a lane's first cut at the alias fix mis-attributed `let cb = usesLog; cb = usesDb` as requiring a capability the program never reads — caught by the lane itself before it shipped. Two structural fixes matter more than the counts: the operator table was **factored** (`receiverBranches` → `valueBranches`, one table called by both walks) rather than copied, because the original defect existed precisely because an earlier round taught one table and not its sibling; and the authored coercion sites were **deleted** in favour of the predicate the foreign half already used, so operator coverage now follows by construction. **A scoping error of mine cost a lane**: I passed along "S3 needs no Go change", true for the callee position and wrong for the `??`-selected foreign constructor, property read and tagged tag — the Go lane measured it, reported it, and correctly refused to fix outside its brief. |
| 2026-08-26 | What "0 divergent" did not mean, twice in one day | Two separate discoveries that the headline conformance number measures less than it appears to. First, **the corpus measures `compileProject`, not the shipped CLI**: staging all 424 cases and running `bin/smithers.js check` on each gave **48 divergences** — a corpus-*accepted* durable positive the product refuses with `SMITHERS1207`, the retired-syntax migration guidance arriving as a raw `TS1144` parser cascade, and a case marked `expect: "output"` that the product refuses outright against a Locked ledger entry. The reassuring half is measured, not assumed: the bucket "**product ACCEPTS what the corpus refuses" is 0**, so no corpus green certifies a rule the shipped compiler fails to enforce, and that bucket is now a gate. A staging artifact was ruled out three ways, including 40 of 48 reproducing in-place with no staging at all. Second, the coercion fix **opened 65 real divergences against the fork while conformance continued to report 0**, because no corpus case spells any of them. Both are the same lesson in different clothes: the differential can only see what someone wrote a case for, so a green oracle is a statement about corpus coverage before it is a statement about the language. The `SMITHERS1510` rule was also found to have **two independent implementations** (`poc/src/language/semantic.ts:5480` and `src/relative-runtime-graph.ts:954`), the CLI one firing first and suppressing the paired `SMITHERS1301`/`1302` — the same suppression-behind-a-refused-edge shape retired from the Go fork on 2026-08-25, still live in the product and invisible to every corpus row. |
| 2026-08-27 | Round seven: eleven more defects, four HIGH, and the first one that defeated the language outright | Two independent reviewers, both **not LGTM**. The worst finding of the project: **`eval` and `Function` readmitted every host global the allowlist refuses.** `Date.now()` was refused `SMITHERS1602`; `eval("Date.now()")` reported `ok: true` with `failures: []` and `requirements: []` and **ran**. `eval("process.platform")` returned the host platform on both backends with zero diagnostics. **Twenty of twenty-two spellings failed open**, including a shorthand `{ eval }`. The allowlist's own comment, twenty lines above, already explained why `globalThis` is excluded — "the one language global whose whole purpose is to hand back the host's namespace" — in words true of `eval` verbatim. Three further HIGH defects were in ground **no previous reviewer had examined**: the shipped CLI's trust graph ran untrusted foreign initializers through eight miscased markers at the transitive position and six module-initialization edge spellings (116 and 62 fail-open rows, now zero), and three `context` key spellings lost the capability row and panicked. That is the round's real lesson: findings track **where someone looked**, not how mature the code is. Six rounds had concentrated on the language rules; the first pass over the product surface found four HIGH defects immediately. Also closed: a compiler **crash** — `throw { a: 1 }` took the reference frontend down with a `Debug Failure`, because two walks had each been taught the same insufficient type guard separately, and the second was independently reachable, so a fix at the site first identified would have left it live (577 cells, 90 crash→verdict, 0 regressions). And the last fail-open, a foreign module reached at **depth ≥ 2** never checked for its trust marker by either semantic pass — measured executing its initializer at depths 2 through 5, masked in the product by the CLI's graph alone. |
| 2026-08-27 | Three lanes corrected the reviewers, and one corrected me | The review's recommended fix for the trust marker — read it from TypeScript's parsed JSDoc array — was **measured and rejected by two lanes independently, for different reasons**. One compared a parsed-JSDoc implementation against all 75 marker-carrying files and found **21 disagreements in both directions**: TypeScript attaches only the *last* JSDoc block, losing the header in 15 files including `conformance/support/foreign.ts`, and its JSDoc parser strips `*` decorations, which would have **granted trust to `split-trust-marker.ts`** — a file that exists to be refused. The other found the same fix would lose the header of three more support modules. Both used scanner comment ranges instead: zero disagreements. A third lane disproved the review's reasoning about null prototypes by measuring **all 35 structural predicates** in the repository, and reached the right fix for a different reason than the one it was given. **And a lane corrected me**: I narrowed the frontend crash to the member name `match` after measuring five names, and briefed that as the mechanism. It is not — `throw { a: 1 }` crashes with no `match` anywhere in the program. My narrowing was a corner of the defect, and following it would have fixed one of two independently reachable sites. The recurring defect caught its own diagnostician. |
| 2026-08-27 | What the coverage metric measures, established three ways | `COVERAGE.md`'s "rules both implementations have and no case probes" figure has now stayed at **19** across three rounds that closed eleven fail-opens, and it was **right every time** — for three different reasons, each recorded on the page with a worked example. Round six's defects were **spellings**, and the subtraction counts codes. Round seven's `eval` work added exactly one code, which entered both implementations and the corpus in the same revision, so every input moved by one and the difference did not. And the closure fix showed the table **cannot count distance**: `SMITHERS1510` already had five cases while both backends were executing an untrusted initializer one module edge away. The number was never wrong; it measures something narrower than it reads. The same blindness has a second face in the differential itself: three lanes closed **143, 116 and 227** divergences in round six, and **58** in round seven, while backend agreement stayed **flat** each time — because no corpus case spelled those shapes. Agreement only moved when cases were written: 420/438 → 447/465 → 480/498, rising by exactly the number of cases each time. A green oracle is a statement about corpus coverage before it is a statement about the language, and that is now the first thing this document says about any headline number. |
