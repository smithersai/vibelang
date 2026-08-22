# Findings and production roadmap

> Current architecture report: this records what the executable POC proves and
> what it deliberately leaves for production. The decision ledger remains the
> language contract; this document is implementation evidence and planning
> guidance, not a normative syntax specification.

## Outcome

The core product model hangs together. The live project frontend proves that
ordinary eager functions can return typed Results while concrete failure and
requirement rows propagate across module aliases, namespaces, and cycles. The
static source compiler proves that a statically resolvable function passed to
`durable(...)` can become executable Plan IR without loading the author module
or Action implementations. Agent code remains a library consumer of the same
typed callable boundary rather than a language special case.

The POC also found four places where a shortcut would create the wrong
architecture:

1. **The TypeScript 7 extension seam comes first.** The Go-native preview has no
   JavaScript compiler API, so a language-service plugin or JS transform cannot
   be the foundation. The exact-revision process bridge now proves upstream
   content mapping, checking, declaration/runtime emit, diagnostics, and maps
   without copying `internal` packages; real Vibe lowering still needs narrow
   fork-owned parser/checker/emitter/IR hooks.
2. **Rows and control flow belong in checked compiler IR.** The shared
   TypeScript Program is enough to prove concrete module-edge propagation,
   statement-safe lowering, and a deliberately narrow lexical-tail
   `defer`/`errdefer`. Generic rows, higher-order provenance, expression control
   flow, and general cleanup/evaluation order still require the production
   resolver and control-flow graph.
3. **Runtime type metadata must be emitted before erasure.** The durable
   structural-codec slice now proves that Action input/success/Error and static
   Flow input/success/error descriptors can be derived and enforced before
   TypeScript erases them. Validators, loaders, RPC bindings, agent
   declarations, and provider contracts still need that same compiler-owned
   descriptor rather than separate reconstruction from JavaScript callbacks or
   generics. A second bounded slice now reuses the project row checker for
   Action implementation `E`/`R` and fail-closed equality with the Action's
   nominal failure schema; sharing that descriptor beyond durable boundaries
   remains production work.
4. **Symbolic Flow values need compiler lowering.** The bounded static source
   compiler now handles Action calls, projections, conditional selection,
   timers, one typed single-delivery external signal, stable-key fan-out with
   bounded multi-step bodies, explicit `sequential(...)` ordering, attached
   child Flows under a depth budget, and a budgeted `loopWhile(...)` round
   template — all without a Proxy (programmatic POC evidence; final counts
   pending the wave gate). General authored loops, nested fan-out, detached
   children, and operators still need checked IR; the POC's explicit `Expr.*`
   and `Flow.branch` remain useful IR targets, not desired source syntax.

## What is real and what is mocked

The spike deliberately uses real machinery where behavior, identity, or a
process boundary is the risk: SQLite transactions and restart, Deno process
isolation and JSON-lines RPC, TypeScript checking, Zig/Rust tool invocation,
Wasm instantiation, content keys, dependency invalidation, overlapping async
layer scopes, and an exact-revision upstream Go compiler process all execute
for real.

The replaceable plumbing is fake: the model adapter is scripted, workers are
local callbacks or fresh local Deno processes rather than a fleet, and
deployment artifacts are canonical plans/manifests plus digest-pinned worker
source and a signed local manifest envelope rather than attested tree-shaken
bundles. Durable Actions now have real
bounded structural descriptors and validators; only the legacy `Action.define`
path retains generic JSON-shape stubs. The live semantic frontend remains a
bounded TypeScript-checker/AST project instrument. The Go bridge now accepts
externally lowered TypeScript per `.vibe` file and composes real non-identity
source maps back to authored positions, but it remains an external build overlay
rather than a landed fork-owned extension, and its cached binary is not signed
or attested. Those seams expose the intended contracts without hiding the parts
that need production architecture.

The external-signal slice uses real SQLite transactions, canonical payload
bytes, compiler-derived structural schemas, exact execution/node/signal
identity, idempotency conflict detection, restart, cancellation/deadline, and
two-connection races. The external entry bounds request identities and JSON
node/field traversal before the independent canonical byte limit or SQLite.
Its direct in-process `deliverSignal(...)` call is
replaceable plumbing: it deliberately does not claim a final execution-handle
API, sender authentication/authorization, remote transport, notification
service, queue/broadcast semantics, or schema migration.

Keep the negative evidence explicit when planning: row/provider analysis is
checker-backed across explicit source graphs but generic/higher-order cases are
intentionally incomplete; `Layer` has lookup scope but no resource lifetime;
the temporary `Flow.define(...)` authoring callback still observes host ambient
state, while static source compilation and Plan loading do not execute it;
third-party loaders and comptime modules registered through
the sandbox APIs now run through a bounded no-permission Deno process instead
of trusted host callbacks;
implementation/contract digests and deployment-owned capability grants are
validated metadata now covered by the signed manifest, but the corresponding
callback closure/bundle and installed authority are not attested; foreign dependency
discovery is representative rather than complete; and the agent sandbox has
wall-clock, V8 heap, output, call, cancellation, and transport/backpressure
limits but no container/VM-grade confinement or OS-wide resource accounting.
Action implementation capability requirements are now checker-derived from an
explicit closed `.vibe` source project and `provideChecked` requires an exact
grant. The contract/source/direct-function digests flow through deployment and
worker validation, while legacy providers cannot receive a nonempty grant.
This is still local metadata evidence: the compiler-issued contract/callback
pair plus an in-process WeakMap does not attest its lexical closure or a remote
implementation bundle. Recoverable `E` is now required to equal the Action's
nominal failure schema exactly, while `Panic` remains a distinct defect bit.

## Adversarial results that changed the design

| Reproduced failure | POC response | Production implication |
| --- | --- | --- |
| Plain TypeScript was accidentally rewritten as Vibe syntax and scripts became modules | Added contextual scanning, conditional helpers, and identity regressions | Imported `.ts`/`.tsx` need a TypeScript conformance gate; `.vibe` needs its own upstream-derived parser tests rather than a renamed-corpus “superset” claim |
| The upstream Go compiler intentionally suppressed runtime JavaScript for a content-mapped `.vibe` source | Check the mapped Program and emit its declaration, then run the mapper-owned virtual TypeScript through a second upstream Program and rewrite identity source-map ownership | Production must formalize the mapper/build-tool virtual IR and compose non-identity spans; it cannot assume one upstream Program owns both mapped checking and runtime output |
| A shared asset cache reused dependency paths from another project; mutable options, changing/repeated reads, unbounded source parsing/graphs, preflight path swaps, invalid UTF-8, hard-link aliases (including a cached dependency relinked to its source), cache self-reads, executable typed-array allocation, prototype-mutating literals, symlinks, loader changes, and poisoned envelopes broke key/output equivalence | Bound source before parsing, snapshot each canonical graph file once, reconcile preflight identity after the loader, carry inode authority into cache validation, enforce file/graph/cache budgets, exclude compiler cache authority, snapshot options, require strict JSON IR, emit safe literals, resolve real paths, key loader artifacts, and verify output digests | One hermetic graph rule ABI must own identity, authority, normalization, budgets, and dependency discovery |
| A foreign source could escape through `../` or a symbolic alias; ambient environment and same-version compiler shims aliased a key; and cache symlinks escaped bounded reads | Compile only a bounded canonical source snapshot beneath explicit authority, key the sanitized passed environment plus executable content/version/build profile, verify the executable around process use, and make no-follow bounded cache objects ordinary misses | Foreign tool execution must be a first-class graph rule; production dependency and ABI facts must come from compiler metadata, while compiler installations and subordinate tools need an attestation/content policy |
| Settled/unconsumed async work and early iterator exit could outlive their owner | Make the combinator retain its own children; cancel and join unordered mapping on exit | The returned Promise owns combinator work; authored calls must consume it, while Layers remain environment-only and never supervise tasks |
| Durable retries lost deadline/backoff state; stale fenced attempts could race global reuse; mutable manifests changed behavior under a fixed digest | Persist timing state and make fencing, cache publication, and pinned immutable artifacts explicit invariants | Kill/restart and two-coordinator race suites are release gates, not optional unit tests |
| An external signal could otherwise smuggle a caller-selected schema, alias one wait with another, hold a worker lease while idle, or change after replay | Put the literal identity and compiler-derived payload schema in Plan identity, pin an exact execution/node contract at initialization, persist one canonical idempotent inbox winner, and consume it with node/journal state in one transaction without a lease | The durable store contract is now clear; production still needs an authenticated sender/handle/transport and event-driven wakeup design rather than granting type authority to delivery clients |
| A structural authentication token with `deployment: undefined` passed an `undefined === undefined` WeakMap comparison; a lookalike deployment could add pools; and the authenticated executor silently mapped non-local signed sandboxes to `LocalWorker` | Check proof issuance independently, brand the public type, require the exact `Deployment.build` object, consume it before worker creation, and require an opaque exact-sandbox host token for every non-local transport before invoking any factory | Security tokens and build products need nominal runtime provenance; signed metadata must drive fail-closed routing, while the host transport implementation remains a separate trusted/attested boundary |
| Generated code returned before host RPC finished, returned non-JSON or traversal-amplifying values, flooded or outlived host RPC, escaped deterministic globals through fresh realms, and could rely on a runner changed in place while restoring size/mtime | Reject unawaited calls, bound source before base64 and JSON depth/nodes before serialization, abort in-flight calls, deny obvious realm creation, content-pin the canonical runtime/runner with ctime-aware revalidation, and use a fresh no-permission process with timeout, V8 heap/output/call limits, cancellation, and write backpressure | Compiler-emitted codecs plus audited container/VM confinement, OS resource limits, race-free artifact launch, and attestation are still required for hostile multi-tenant execution |
| Runtime failure payloads could overwrite their nominal discriminant | Reserve/freeze identity fields and recognize same-realm instances nominally | Cross-realm failures need an explicit checked codec; a forgeable global symbol is insufficient |
| `Optional.unwrap()` and `Result.expect()` were recognized by the checker but silently not lowered or charged, so an accepted "plain" function could panic at runtime; top-level `throw`, `static {}` blocks, and panic/unwrap inside a JavaScript `catch` scope were similarly silent; a `vibelangutils` package name inherited compiler trust from a prefix check; and the retired-syntax scanner rejected the documented `Result.try(...)` API | Implement real Optional-unwrap propagation lowering, charge `expect` to the distinguished Panic row, add stable fail-closed diagnostics (`VIBE1002`/`VIBE1107`/`VIBE1205`/`VIBE1206`/`VIBE1511`), require exact `vibelang`/`vibelang/`/`vibelang:` specifiers, and guard the scanner against member access | An independent red-team over the frontend's fail-closed claim is a release gate: every checker-recognized form needs either a lowering or a diagnostic, proven by a test, before the claim is checked |
| All durable SQLite read-then-write transactions were DEFERRED; real two-connection contention reliably produced unretried `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` (~120 ms, under the 5 s busy timeout) that the engine then recorded as a permanent terminal defect | Convert all 19 store transactions to `BEGIN IMMEDIATE` and add a two-connection interleaved contention/fencing suite | Journal-store liveness under contention is a separate property from atomicity and fencing and needs its own adversarial gate; transient lock conflicts must never become permanent execution outcomes |
| Sandboxed generated code could stream one enormous newline-free protocol line (for example `console.log` of a multi-megabyte string), and the host buffered it fully (~153 MiB observed) before the per-line output limit fired at timeout | Count raw stdout bytes at the data-event layer against the shared output budget and kill the child on breach | Host-side resource limits must be enforced at the transport byte layer, not after protocol framing |
| The deterministic package verifier compared the installed CLI's realpathed report paths against a symlinked `os.tmpdir()` workspace, so verification could never pass on default macOS; its copy-overwrite guard was inert and its `npm audit` failure path unreachable | Canonicalize the workspace base with `realpathSync`, enforce `force: false`, and make every nonzero audit exit fail with captured diagnostics | Release verifiers need their own adversarial review and at least one full green run on every supported platform before their checks count as evidence |

## Recommended architecture

```text
TypeScript/VibeLang frontend (Go)
  parser + resolver + checker + control-flow graph
                    |
                    v
        shared checked VibeLang IR
   A/E/R rows, reified types, symbolic expressions
                    |
        content-addressed build graph
       /          /         |          \
      v          v          v           v
 TS/JS emit   LLVM/Wasm   asset IR   Plan IR + manifests
      |                       |           |
 layer kernel            agent library  durable runtime/workers
```

The build graph should be orchestration, not a second language. Compiler passes,
comptime evaluation, asset loaders, schema/code generation, foreign toolchains,
durable Plan IR lowering and analysis, bundle partitioning, and custom diagnostics should all expose
stable inputs, outputs, dependency edges, and content identities through one
narrow rule contract.

## What the POC clarified

### Language and providers

- Fixed-point set propagation is straightforward once call resolution exists.
  The hard work is attaching rows to all TypeScript call shapes and preserving
  them through declarations, generics, callbacks, overloads, and module edges.
- AsyncLocalStorage proves correct nested/overlapping TypeScript scopes. It is a
  viable backend implementation, but hidden environment parameters remain more
  attractive for native compilation, tree shaking, and static dependency
  closure. Source semantics can remain independent of that choice.
- Missing provider diagnostics become much better when they retain the same
  dependency paths used by native-pin and deployment checks. Build one shared
  requirement-path engine.
- The bounded lexical-tail `defer`/`errdefer` lowering proves registration,
  scope-exit, and Result-error gating, but cleanup-error composition, arbitrary
  placement, and expression block/loop values still need the compiler's
  control-flow graph.

### Comptime, schemas, and builds

- Content keys can cleanly include loader identity/artifact digest, immutable
  option snapshots, normalized source, target, and tracked dependencies. A
  persistent logical index avoids loader execution when all prior evidence and
  the cached-output digest still match. A build must read from one immutable,
  bounded graph snapshot: allowing a loader to observe a dependency twice at
  different moments makes even a correct content key meaningless. Cache I/O
  needs its own bounds and authority exclusion; cache validation must inherit
  source inode ownership or it can accept a dependency relinked to the source.
  An oversized cache envelope is best treated as an ordinary cache miss, not a
  compilation failure. Source discovery needs a pre-parse budget and must bind
  post-loader output back to the exact preflight file identity.
- The POC validates the loader boundary directly: loader/comptime modules
  registered through the sandbox APIs run in fresh no-permission Deno
  processes, receive only stable JSON plus tracked dependency RPC, and have
  timeout, V8 heap, input/output, request, and concurrency limits. A trusted
  in-process hook remains for built-ins and tests; production registration must
  require the sandbox path for third-party code and add audited policy plus
  compiler-owned typed output/dependency APIs.
- Structural validator derivation is mechanically feasible and now enforced at
  durable Action and statically compiled Flow boundaries. The current compiler
  descriptors cover bounded canonical JSON shapes and nominal Error payloads;
  recursive types, refinements, functions/capabilities, `any`/`unknown`, and
  custom durable encodings need an explicit shared reification policy.
- A mixed `.vibe`/TypeScript/JavaScript runtime graph is mechanically feasible
  without executing imports during build: the CLI now stages a bounded
  ESM/CJS extension matrix and rewrites its relative closure. Production still
  needs package-mode semantics, a representative upstream corpus, stronger
  JSX/CJS declarations, and exact provenance after rewritten specifiers.
- Actual Zig/Rust-to-Wasm compilation works as graph work. Production bindings
  must come from compiler/ABI metadata and include every imported foreign file;
  source regex is intentionally not retained.

### Durable execution

- Keep four phases as separate artifact contracts: template compilation,
  deployment build, plan/preview, and execution. Template compilation lowers
  checked syntax and control flow without invoking the source function;
  plan/preview loads only emitted Plan IR and runs no Action implementation.
- The POC's `Flow.define(...)` and host callback execution are disposable
  authoring instrumentation, not the accepted compiler path. Canonical
  static source lowering and `PlanArtifact.load(...)` validate and reconstruct
  a compiled Flow without loading that callback or an Action implementation.
- Keep four identities separate in storage and APIs: run-local node,
  downstream idempotency, nondeterministic memo generation, and deterministic
  content key.
- Runtime-sized fan-out needs two more deliberately separate facts: a static
  template identity and a canonical item-key identity. Array position controls
  result order but cannot participate in the child identity.
- Persist the complete key-to-child and instantiated-input-digest set in one
  transaction before dispatching any child. Restart can then adopt committed
  children while rejecting duplicate keys, input drift, and observed identity
  collisions instead of re-running author code.
- External signals likewise need separate static and dynamic facts: the Plan
  owns node identity and the compiler-derived payload schema, while each
  execution owns one exact delivery idempotency key and canonical payload.
  Senders must never provide schema authority. Delivery, consume, cancellation,
  skip, and deadline races need one persisted winner, and suspension must not
  acquire a worker lease. The provisional in-process API proves these storage
  invariants but leaves authenticated handles/transport and wakeup scheduling
  for production.
- A cache or memo hit must first become a run-local terminal record before its
  value is returned. This makes replay independent of later cache eviction.
- Provider/policy digests and Plan/schema versions must be pinned per execution.
  Placement is a route/implementation decision, not part of the abstract Action.
- Leases and fencing protect journal commits from zombie workers. They do not
  make an external side effect exactly-once unless the destination participates.
- Post-COMMIT crash injection now covers every material store transition in the
  current executor. That proves restart adoption at the API/transaction seam;
  production still needs OS-kill tests, faults during SQLite operations, and
  multi-process/multi-host chaos.
- A digest-pinned worker expression now executes through the same invocation
  contract in a fresh no-authority Deno process. It proves isolation routing and
  codec/failure handling. The Ed25519 envelope authenticates the manifest's
  pinned digest for that local artifact, not tree-shaken bundle bytes, remote
  transport/worker possession, or attested capability installation.

### Coding agents

- The passed-function table is a clean authority-boundary shape. This POC wires
  local callbacks; Actions, Flows, tools, and MCP still need checked adapters.
- Type declarations are valuable diagnostics but not confinement. The POC's
  fresh Deno process denies ambient permissions and enforces wall-clock, V8
  heap, output, total/concurrent call, cancellation, and backpressured transport
  limits. Production still needs audited sandbox images, OS-wide memory/CPU
  enforcement, redaction, artifact attestation, and compiler-emitted codecs.
- Model responses are nondeterministic memo candidates, never deterministic
  content-cache entries. Generated source and compiler diagnostics are ordinary
  content-addressed artifacts.

## Immediate P0 gaps exposed by the conformance re-audit

These are ordered by architecture risk, not by specification-page order. Each
is a bounded vertical slice that can fail closed beyond its supported subset.

1. **Turn the executable Go bridge into the real compiler extension seam.** The
   exact revision, clean-`tsc` verification, content mapper/checker,
   declaration/runtime emit, diagnostics, authored identity maps, and direct
   CLI process now execute. The transform is identity-only, runtime emit uses a
   second Program, and the fork is neither vendored nor extended with VibeLang
   IR. Land reviewed fork-owned lowering, non-identity span composition,
   multi-file/package hosting, rows, and language-service support.
2. **Extend checked expression/control-flow IR.** The bounded POC now lowers
   nested `if` and `switch` expression plans with typed joins, Result
   propagation, evaluation-order checks, unsafe-exit rejection, and exact maps.
   Block values, `while`/`for` values, labels, loop `else`, exhaustiveness, and
   durable symbolic branches still need one shared production IR instead of
   more independent AST transforms.
3. **Unify project/module and effect provenance.** The direct module graph is
   checker-backed, but generic/higher-order `E`/`R` rows, arbitrary foreign
   callable provenance, stable module-qualified identities, package resolution,
   structural Action contracts, and authenticated implementation artifacts do
   not yet share one production representation. The bounded provider-contract
   path derives implementation `E`/`R` from a closed source project, checks
   exact grants, and requires recoverable `E` to equal the Action's nominal
   failure schema, but it does not attest lexical closures/remote bundles.
   Static foreign imports can throw before a generated
   call-level `Result.try` wrapper exists; the bounded POC now rejects them
   unless the target has leading `@module` plus `@throws {never}` JSDoc, with
   type-only edges exempt and deferred loading routed through a trusted checked
   async adapter. Production still needs to standardize and surface that trust
   claim across declarations, tooling, artifacts, and package resolution.
   Keep authority classification in that same checker representation: the
   bounded POC now resolves common ambient clocks and randomness to
   `Clock`/`Random`, preserves lexical shadows, and propagates those rows, but
   the complete host API table is still future work.
4. **Grow the forced comptime contract from the proven bounded seam.** The POC
   now interprets immediate/private-const `comptime(function)` calls without
   author-module execution, evaluates only the selected `comptime.target`
   branch, tracks text `embed` content in cache identity, and emits deep literal
   result types into checking/declarations. A second compiler-owned seam now
   discovers static attributed asset imports, admits only nominally issued
   pure-data modules, and carries them through every root CLI command with
   deterministic runtime paths, declarations, maps, cache replay, and AST-owned
   attribute stripping. Production still needs general checked evaluation,
   loops/mutation policy, arbitrary type-valued bindings, asset re-export and
   dynamic/nested graph forms, and one compiler-owned incremental graph.
5. **Join structural descriptors to every boundary.** The durable vertical
   slice and exact implementation-`E`/Action-schema check are real; route the
   same compiler-owned descriptor into loaders/generated modules, agent RPC,
   declarations, and custom codecs rather than inventing more
   subsystem-specific schema shapes. Custom codecs need explicit identity and
   versioning.
6. **Expand static Flow IR and deployment evidence.** Runtime conditional,
   relative timer, typed single-delivery external signal, stable-key fan-out
   with bounded multi-step bodies, explicit sequencing, attached child Flows,
   and budgeted loop rounds now execute from static IR without invoking source
   (programmatic POC evidence; final counts pending the wave gate). Add
   authenticated signal handles/transport, signal addressing into child Plans,
   separately signed child manifests, and general unbudgeted body templates,
   then emit a tree-shaken worker bundle and exercise OS-process death around
   the existing SQLite transition matrix.
7. **Grow the bounded portable backend into the shared backend.** The POC now
   lowers a bounded single-module `.vibe` subset through both checkers into exact
   canonical IR, runs that IR in a TypeScript host, emits real import-free Wasm,
   and proves wire-hash agreement without evaluating author source. That subset
   covers plain/Optional/Result returns over `f64` and boolean scalars,
   intra-module calls with recursion rejected and a depth cap, locals and
   assignment, `if`/`while`/`for` under a fixed loop-fuel budget whose exhaustion
   is a canonical defect in both runtimes, scalar error payloads, and interned
   printable-ASCII string literals with pooled equality and length
   (programmatic POC evidence; final counts pending the wave gate). That closes
   the initial representation and tagged-ABI risk, but not the locked LLVM
   target or a general Wasm backend. Next add compiler-owned structural
   descriptors, Context/environment lowering, cross-module calls, general heap
   values and string operations, GC, and whole-project partitioning through one
   shared checked IR.

## Proposed implementation sequence

### P0 — Upstream seam and identity lowering

- Vendor and provenance-check the already pinned `smithersai/TypeScript`
  revision rather than depending on an external sparse checkout/build cache.
- Replace the identity overlay bridge with reviewed fork-owned hooks that carry
  the proven `.vibe` project emission, composed non-identity maps, declarations,
  stable row metadata, and language-service behavior into the upstream seam.
- Establish narrow hooks for syntax extensions, row metadata, checked IR,
  comptime rules, and generated modules.
- Gate: keep an upstream TypeScript corpus unchanged in `.ts`/`.tsx` interop
  tests, plus a separate `.vibe` corpus for documented shared syntax and
  intentional divergences.

### P1 — Function rows, failures, and requirements

- Add `Result<A, E>` lifting, `E`/`R` representation, and fixed-point inference.
- Implement `.unwrap()` propagation, exhaustive Result/Error matching, async
  propagation, `Capability.context()` inference, and provider satisfaction.
- Ship the TypeScript Layer environment kernel. Keep acquisition/disposal in
  explicit `using`/`defer` code and reject detached Promise work.
- Gate: cross-module, generic, async, callback, and incremental-checking suites;
  full dependency-path diagnostics for failures and missing requirements.

### P2 — Shared IR, expression control, and comptime graph

- Add checked expression/control-flow IR for block/if/switch/loop values,
  optionals, `defer`, and `errdefer`.
- Add deterministic comptime evaluation and the content-addressed graph/rule ABI.
- Emit one compiler-owned reified type/schema descriptor used by validators,
  loaders, Actions, RPC, and agent declarations.
- Gate: const JSON, Markdown/MDX, one custom loader, schema derivation, target
  elimination, and repeatable incremental cache behavior.

### P3 — Plan IR and local durability

- Expand the compiler-owned `vibelang:flows` lowering from the proven static
  Action/conditional/timer/typed-signal/stable-key fan-out subset to child
  Flows, general checked loops, multi-step item bodies, and reusable
  cross-module functions without invoking them. Replace the provisional local
  signal call with an authenticated execution handle/transport and durable
  wakeup service while preserving the proven inbox contract.
- Lock stable IDs/versioning, explicit sequence, fan-out keys, canonical wire
  encoding, and run/schema migration rules.
- Build an atomic local executor with inspection, replay, retries, timers,
  signals, children, cancellation, artifacts, and the distinct reuse policies.
- Gate: prove plan/preview runs from emitted IR with the source and Action
  implementations absent; then kill/restart at every journal boundary and
  verify adoption, fencing, memo CAS, content integrity, cancellation races,
  and version pinning.

### P4 — Targets and distributed deployment

- Add LLVM/Wasm backend slices and finish the portability classification table.
- Turn foreign compilers, bundling, and worker partitioning into graph rules.
- Bind signed routing manifests to emitted coordinator/worker bundle bytes,
  schemas, and RPC bindings; implement protected key lifecycle and remote
  workers with real sandbox/capability grants.
- Gate: one Flow spanning TypeScript, native, and Wasm pools with cross-target
  codec/hash agreement and zombie-worker tests.

### P5 — Agent library and ecosystem

- Publish MDX prompt components, model adapters, generated-source checking,
  passed-function RPC, sandbox backends, repair/continuation primitives, and
  durable hooks as a library.
- Add Effect/tool/MCP adapters after the core function-channel ABI is stable.
- Gate: deterministic replay of a multi-turn coding task with a restarted host,
  confined generated code, and independently recoverable Action calls.

## Decisions to settle before production code hardens

1. Go compiler extension interfaces and ownership of shared checked IR.
2. Layer merge/override precedence and environment lowering; base Layers do not
   acquire, dispose, memoize, or supervise work.
3. Nested Optional normalization and type-assertion/native-cast rules.
4. Loader registration, typed module IR, Markdown/MDX shapes, and sandbox ABI.
5. Complete portable/TypeScript-required/forbidden feature table.
6. Stable Action/Flow IDs, loop/fan-out identity, explicit sequencing, wire
   encoding, artifact model, and in-flight migration.
7. Worker deployment syntax, signing-key custody/rotation/revocation and
   anti-rollback, capability installation, remote worker possession, and
   sandbox attestation. The local Ed25519 envelope settles only the basic
   canonical signing and out-of-band trust-root seam.
