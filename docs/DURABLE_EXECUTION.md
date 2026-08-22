# Durable execution

Status: design draft. The core model and distributed-build requirement are
locked in `DECISIONS.md`; everything else here is a proposed baseline unless
that ledger says otherwise.

## Product contract

VibeLang durable execution supersedes the separate `flows` library. The
existing implementation is prior art and a source of tested runtime machinery,
not a required user-facing dependency.

- An **Action** is an open runtime implementation behind a closed, durable
  signature.
- A **Flow** is a closed program produced when the compiler lowers the checked
  body of a function passed to `durable(...)` into a typed, target-neutral
  execution-plan template.
- Action implementations are ordinary VibeLang functions/callbacks. Their
  success and typed failure are inferred from the body when the return
  annotation is omitted. Abstract Action signatures use explicit
  `Result<A, E>` contracts because they have no body. Requirements are inferred
  from `Capability.context()` calls and transitive callees and remain part of
  that static type; the compiler derives persistence codecs rather than asking
  authors to repeat schemas in an Action constructor.
- Ordinary functions remain ordinary eager functions. Only `Action` and `Flow`
  opt into the durable runtime.
- A local process, isolate, sandbox, container, and remote machine all use the
  same Action invocation protocol.

```ts
import { durable } from "vibelang:flows"

abstract class Compile extends Action<
  (input: CompileInput) => Result<CompileOutput, CompileError>
> {}

abstract class Package extends Action<
  (input: PackageInput) => Result<Artifact, PackageError>
> {}

const Build = durable(function Build(
  input: BuildInput,
): Result<Artifact, CompileError | PackageError> {
  const compiled = Compile.run({ source: input.source }).unwrap()
  return Package.run({ code: compiled.code })
})
```

`durable` is an imported compiler intrinsic, not a keyword. The compiler
recognizes the resolved import binding, so aliases preserve the behavior and an
unrelated function with the same name remains ordinary. Its argument must be an
inline function or another function the compiler can resolve statically. The
call lowers to a serializable Flow descriptor that references the emitted IR,
not a runtime callback wrapper. Uncompiled JavaScript fails while loading the
compiler-owned `vibelang:flows` virtual module.

The compiler lowers the function's typed syntax and control-flow graph; it does
not call the function with proxies to discover the graph. `Compile.run` lowers
to an Action node. `compiled` is a typed symbolic value and `compiled.code` is
a typed projection from that node. Passing it to `Package.run` creates the data
edge. Neither Action implementation runs during compilation or planning.

## Compilation model

There are four distinct phases:

1. **Template compilation.** The compiler lowers the statically resolved
   function's checked syntax, control flow, and data flow into Plan IR, schemas,
   inferred failures and requirements, stable identities, and a source map. It
   never invokes the function. The source function is not needed afterward.
2. **Deployment build.** Provider layers are resolved. The compiler checks
   their complete dependency closure, partitions implementations into worker
   pools, and emits coordinator and worker artifacts plus a signed manifest.
3. **Plan/preview.** Tooling reads the emitted Plan IR, validates and optionally
   specializes known input, and reports the execution graph. It neither loads
   nor invokes the durable source function or Action implementations. Unknown
   branches and runtime-sized fan-out remain explicit templates.
4. **Execution.** An execution ID and validated input create or resume a run.
   The durable scheduler evaluates Plan IR control nodes and dispatches ready
   Action nodes to eligible workers.

This differs usefully from the prior `flows` implementation: it builds a graph
by running a JavaScript body and retains live functions in side tables.
VibeLang instead emits portable expression IR and compiler-stable hashes. Plan
mode analyzes that emitted artifact; it never executes a Flow source function.

### Current POC evidence (non-normative)

The executable POC proves a deliberately bounded vertical slice of this model:

- checker-identity resolution lowers a bounded `durable(function)` body with
  const/literal/input projection, conditional selection, durable sleep, a typed
  single-delivery external signal, stable-key fan-out, and
  `Action.run(...).unwrap()` forms without
  evaluating the author module or an Action implementation;
- a fan-out body may be a bounded block sequence of at most 16 Action steps
  whose later inputs project the item and earlier steps' durable results. Step
  children derive their ids from the template id, item key, and step ordinal;
  the complete step-0 set commits atomically before any dispatch, and each later
  step's instantiated input digest commits after the previous step's durable
  success and before that step can dispatch;
- a previously compiled Flow can be invoked as an attached child boundary
  through the provisional `ChildFlow.run(input)` spelling. The child Plan is
  embedded and digest-pinned in the parent artifact, the child runs as its own
  execution with its own journal and its own pinned manifest, the parent node
  suspends without a worker lease, and cancellation or execution failure fences
  attached descendants inside the same transaction that records the parent
  outcome. Embedding is structurally acyclic and bounded by an explicit depth
  budget of 8;
- provisional compiler-owned `sequential(first, second)` orders two independent
  Action calls through an explicit durable control edge, with no invented data
  edge, returning both successes as an ordered tuple;
- provisional compiler-owned
  `loopWhile(initial, state => condition, state => Action.run(input), maxRounds)`
  lowers a runtime-round next-round handoff template. Round child ids derive
  from the loop node id and round ordinal, each round's input and originating
  state digests commit before dispatch and only after the previous round's
  durable success, and exhausting the static literal round budget (at most
  1,000) commits a durable terminal defect rather than hanging;
- the Bun executor exposes a provisional typed execution handle:
  `start(input, { executionId })`, `resume(executionId)`, handle `status()`,
  `result()`, `cancel(reason?)`, and
  `signal(signalId, { idempotencyKey, payload })`; `execute` remains the
  start-and-await convenience. Resume reconstructs the handle from the store's
  pinned input and terminal results do not rerun;
- external signal delivery is fail-closed by default. `grantSignal` mints an
  opaque `vst1_` HMAC-SHA256 sender token bound to one execution and signal
  under a per-database secret; tokenless delivery requires the explicit
  `{ unsafeLocalDelivery: true }` opt-in. This is local-trust evidence for one
  SQLite database, not remote sender authentication, rotation, revocation, or
  transport authorization;
- signal delivery, cancellation, execution failure, and timer scheduling notify
  an in-process wakeup service strictly after COMMIT. Notifications reduce
  latency only: suspended coordinators re-read persisted state at the earliest
  timer/deadline or a bounded fallback sweep, so missed or cross-process
  notifications can delay progress by at most one sweep and cannot change the
  outcome;
- Plan artifacts carry a format version. Version 1 is the original bounded node
  set; version 2 adds the multi-step fan-out encoding, `loop` nodes, and
  `childFlow` nodes with embedded child Plans. The compiler emits the minimal
  version each Plan needs, so programs in the older subset still produce
  byte-identical version-1 artifacts, and a version-1 artifact claiming a
  version-2 node is rejected rather than reinterpreted;
- `compileActionContract` derives canonical, type-sensitive Action input,
  success, and nominal Error payload descriptors before erasure. Generated
  virtual Action declarations catch wrong inputs and projections, while the
  coordinator and worker independently validate invocation, success, failure,
  replay, and cache values. Compiler-produced Plans also carry derived Flow
  input, projected success, and reachable Action-error schemas that the engine
  checks before execution creation, terminal commit, and replay;
- `compileActionImplementationContract` runs the same whole-project row checker
  over an explicitly closed `.vibe` implementation source set. Its frozen
  contract pins source/direct-function identity plus inferred `E`/`R`;
  `provideChecked`, deployment, artifact validation, and the worker gate require
  an exact capability grant, while the legacy provider path cannot receive
  nonempty authority;
- canonical Plan, manifest, route, policy, and invocation envelopes are pinned
  by digest and validated before use. A versioned, domain-separated Ed25519
  envelope authenticates the exact Plan and manifest against out-of-band trust
  roots; the verifier issues an opaque proof that the coordinator consumes
  before constructing worker transports. The authenticated path permits an
  implicit local worker only for `in-process-poc`; every other signed sandbox
  requires an opaque host-issued factory token for that exact sandbox;
- SQLite transitions co-commit state and journal evidence. A deterministic
  post-COMMIT crash injector covers every material transition in the current
  executor, and independent SQLite connections exercise coordinator races and
  stale-worker fencing. A separate subprocess test sends the coordinator
  `SIGKILL` after a committed node success and proves a fresh process adopts
  the WAL-backed result without invoking a poison provider; and
- the same `DurableWorker` protocol routes either to an in-process worker or to
  a digest-pinned artifact executing in a fresh no-authority Deno process.

The legacy callback-based `Flow.define`/`Action.define` path remains readable
with explicitly weaker generic JSON schemas; it is not evidence for compiler
derivation. This evidence does **not** implement general (unkeyed, unbudgeted)
loop lowering beyond the bounded `loopWhile` template, nested fan-out, detached
children, queues/broadcast signals, compensation, recurring or calendar timers,
custom codecs, or migration. The child boundary is bounded in further ways worth
stating plainly: signals inside a child Plan are not yet addressable through the
parent executor's delivery handle, child deployments are derived from the
parent's worker pools at build time and are not separately signed by the Ed25519
envelope, and loop budget exhaustion is recorded as a modeled terminal defect,
deliberately not as an entry in the Flow's nominal Error row.
Action provider capability grants close a compiler-derived row and
the recoverable implementation row must equal the Action's nominal failure
schema, but local callback pairing still does not authenticate lexical closures
or the bytes of a deployed worker bundle. The crash suite reopens a real SQLite
file after injected post-commit loss and includes one post-success `SIGKILL`
checkpoint, but it is not an exhaustive OS-kill or database-fault suite. The
signed local envelope authenticates the manifest and its pinned
digests, not freshness, rollback resistance, key revocation/custody, remote
worker possession, authenticated transport, or sandbox attestation. The
host-issued transport token prevents silent sandbox-kind downgrade but still
trusts the host to supply a factory that enforces what it declares. The
provisional canonical-JSON descriptor and Error envelope do not lock the open
cross-target wire format.

## Plan IR

The first Plan IR should contain these semantic nodes:

- constant, input, projection, and pure expression;
- Action call;
- parallel join and explicit sequence;
- branch/switch, Result/Error matching, and completion;
- parameterized `for`/`while` templates;
- inline Flow, child Flow, and next-round handoff;
- durable sleep, external signal, and cancellation boundary;
- compensation/finalization.

Rules:

- A comptime-known branch is reduced normally.
- A branch on Flow input or Action output emits a branch node and compiles both
  arms. Its error and requirement rows include both arms.
- Pure operations on symbolic values become portable expression IR. Operations
  the IR cannot represent are compile errors; they never inspect a placeholder
  accidentally.
- Loops over comptime-known collections may unroll. Runtime-sized loops and
  fan-out emit a body template plus a stable iteration key. The plan is then a
  statically known template whose instantiated node count may grow at runtime.
- Inline recursive Flow expansion is rejected. Recursion uses a child boundary
  or a durable next-round handoff and has a configurable round budget.
- Action calls are ordered by data/control edges, not source position.
  Independent calls may run concurrently. An explicit sequencing construct is
  required when two calls have no data dependency but order matters.
- The Flow may capture only compiler-known immutable values, including results
  of `comptime(...)`. Clock, random, environment, services, I/O, and mutable
  runtime state are unavailable while compiling the template.

### Scheduling and graph behavior

- A plan instance is append-only. Dynamic loop/fan-out instantiation may append
  nodes, but it never rewrites an executed prefix.
- Independent ready Actions may run concurrently within declared worker and
  resource limits. Priority and fairness are scheduler policy recorded in the
  deployment/run configuration, not accidental queue order.
- A failed node always blocks its dependent cone. Whether unrelated cones
  continue, cancel immediately, quarantine, or await an explicit recovery node
  is a visible Flow policy; the default remains open.
- A durable race records its winner before exposing the result. Loser
  cancellation and cleanup are explicit policy.
- Child Flows are attached: they have their own execution identity and journal,
  parent cancellation propagates, and their completion remains owned by the
  enclosing durable operation. Detached children are unavailable initially.

## Action contract

Every Action descriptor contains:

- a nominal durable ID and version;
- derived input, success, and Error schemas;
- its inferred `A`, `E`, and Action requirement;
- implementation and policy digests;
- source/debug metadata.

These are compiler outputs, not fields the author repeats. The source-level
Action closes over one ordinary function signature, while a provider supplies
any ordinary function implementation compatible with that signature. The
provider also supplies the implementation's recovery and reuse policies.

An Action signature must cross persistence and machine boundaries. Therefore
its input, success, and error types must implement the compiler's `Durable<T>`
contract. Plain data derives this automatically. Functions, capabilities,
process handles, weak references, and other ephemeral values require an
explicit durable representation or are rejected at the Action boundary.
`any`/`unknown` require an explicit codec there; this is not a restriction on
ordinary VibeLang code.

**Proposed:** public Action and Flow declarations have an explicit stable ID.
Compiler-derived IDs are convenient during development but renaming a symbol
must not silently change the identity of an in-flight durable operation.

### Recovery and cache policy

The current `flows` code compresses several guarantees into one tier enum
(`sealed`, `compensable`, or `irreversible`). VibeLang separates one invariant
from three policies:

- **Run-local recording is mandatory.** It is not a cache policy.
- **Retry safety** is repeatable, downstream-deduplicated by a stable key, or
  manual after ambiguous completion.
- **Compensation** is optional and independent of retry safety.
- **Cross-execution reuse** is execution-only, memoized, or content-cacheable.

Every Action node has run-local durable state keyed independently of any
cross-run reuse key. Before a value is exposed downstream, each attempt and the
node's terminal exit—success, typed failure, or defect—commit with their
lifecycle events. Restart reuses that run-local exit. A memo or content hit is
first adopted into the current run, so later cache eviction cannot change
replay. Suspension, cancellation, and worker loss are lifecycle states rather
than reusable values.

Cross-execution reuse has two different meanings:

- **Memoized choice** is allowed to be nondeterministic. `memo(key)` uses an
  atomic compare-and-set in a declared scope and generation. The first
  committed success becomes canonical; concurrent losers adopt that success
  before exposing a value. Typed failures, defects, cancellation, and worker
  loss remain run-local by default and do not poison the memo. An LLM
  generation is a representative use: rerunning the model could produce
  another valid answer, but callers deliberately reuse the chosen one.
- **Content cache** is a stronger assertion that the complete keyed inputs,
  implementation, dependencies, and execution semantics reproduce an
  equivalent result. This is the policy suitable for trusted shared build
  caches and verification. Successes are reusable by default; observing unequal
  outputs for one complete key is an integrity defect, not first-writer-wins.
  Hits revalidate declared input evidence and verify/materialize
  content-addressed outputs before adoption into the run.

`sealed` should mean hermetic, deterministic, and eligible for shared caching;
it should not merely mean “an implementation was provided.” Shared sealing is
accepted only when the sandbox can enforce or attest the declared read/write
boundary. Memoization makes no hermeticity claim and must never be promoted to a
sealed content-cache entry. The safe default is execution-local replay and no
ambiguous retry without an idempotency contract.

A cross-execution key includes canonical inputs, the selected implementation
and policy digests, relevant provider/dependency identities, toolchain and
target facts, and explicit invalidation salts. Four identities must never be
conflated: the run-local node key, a downstream idempotency key, a
nondeterministic memo key, and a deterministic content key.

Content-cache locality and eviction affect performance only. Memo scope and
reset/expiry policy affect program behavior, are pinned in the deployment
manifest, and require a consistency protocol that chooses one winner across
machines. Reset or expiry opens a new memo generation; an existing run keeps
the generation and value digest it adopted. Distributed single-flight may
avoid duplicate work but is only an optimization around the atomic commit rule.

Retry policy, deadline, heartbeat, resources, and placement are separate
policies. A retry deadline and sampled jitter are persisted so a restart does
not reset them.

## Providers

Provider composition comes from `vibelang/provider`; there is no special
`provide { ... }` statement. Exact API spelling remains open. A base dependency
environment has the type:

```ts
Layer<Provides>
```

It receives already acquired services and owns neither their resources nor
their tasks. Action/deployment provider configuration may separately describe
implementation requirements and policy; that does not turn a base Layer into
an implicit constructor or supervisor.

Ordinary implementations obtain services through the compiler-recognized
context library rather than through explicit function parameters:

```ts
import { Context } from "vibelang/context"

abstract class ArtifactStore extends Context {
  abstract put(artifact: Artifact): Result<ArtifactRef, ArtifactStoreError>
}

function publish(artifact: Artifact) {
  return ArtifactStore.context().put(artifact)
}
```

`publish(artifact)` still has one source-level argument. The `ArtifactStore`
requirement, `ArtifactRef` success type, and `ArtifactStoreError` failure are
carried in its inferred static function type. A provider layer must satisfy the
requirement in the deployment closure.

Conceptually:

```ts
import { Action, Layer } from "vibelang/provider"

const BuildActions = Layer.merge(
  Action.provide(Compile, compileWithEsbuild, {
    recovery: Action.repeatable,
    reuse: Action.content
  }),
  Action.provide(Package, packageArtifact, {
    recovery: Action.repeatable,
    reuse: Action.content
  })
)
```

- `Compile.run(...)` adds the nominal `Compile` requirement to the Flow plan.
- The provider satisfies `Compile`; the compiler checks the requirements and
  Result failures inferred from `compileWithEsbuild` as part of the deployment
  closure.
- A deployment build resolves that layer closure. Missing platform services,
  Action implementations, codecs, or target support are build errors with a
  full requirement path.
- Provider selection is pinned in the deployment manifest. A runtime must not
  silently switch to a semantically different implementation.
- The Layer environment is installed on the worker that owns the implementation.
  Explicit worker code owns acquisition and disposal with `using`/`defer`;
  memoization is an Action policy, not a Layer lifetime feature. Secrets are
  injected on the worker and are not embedded in the plan or bundle.

## Distributed builds and placement

Placement is a property of an implementation/deployment, not of the abstract
Action. This preserves “open implementation, closed signature”: one `Compile`
Action may have native Linux, Node, Wasm, browser, local-test, and remote
implementations.

A deployment declares worker pools. A pool has:

- target and ABI: TypeScript/JS, native, or Wasm;
- hard constraints: OS, architecture, region/data residency, required device,
  sandbox strength, and capability envelope;
- scheduling preferences: affinity, cost, latency, and locality;
- resource and concurrency limits;
- the provider layer whose Action implementations it hosts.

The concrete configuration syntax is still open. Its shape is approximately:

```ts
import { Deployment, Layer, Worker } from "vibelang/provider"

export default Deployment.make({
  workers: [
    Worker.pool("build", {
      target: "typescript-node",
      sandbox: "container",
      placement: { region: "us-west", cpu: 4 },
      layer: BuildActions
    })
  ]
})
```

The build emits:

1. a coordinator artifact containing Plan IR, schemas, routing, and durable
   runtime code, but not remote implementation code;
2. one tree-shaken artifact per worker pool, containing only that pool's
   Actions and provider closure;
3. optional target variants of a pool, such as a Node bundle, native binary,
   or Wasm component;
4. a signed deployment manifest mapping each Action implementation digest to its
   artifact, schemas, requirements, policies, and allowed placement;
5. source maps and an inspectable plan graph.

The compiler groups compatible Actions into worker-pool artifacts; it does not
blindly create one bundle per Action. A `TypeScript` requirement forces the
implementation into a TypeScript-capable pool. A native-pinned implementation
fails the build if any transitive dependency requires TypeScript.

The signature must cover the canonical Plan and complete manifest, including
coordinator, worker-artifact, implementation, policy, schema, and grant
digests. Verification keys come from an out-of-band trust policy; an artifact
cannot introduce its own authority. A signature establishes provenance and
integrity of those claims. It does not establish freshness, prevent an
authorized signer from publishing bad content, attest worker/sandbox state, or
replace revocation and anti-rollback policy.

An in-process executor is simply the local implementation of the same worker
protocol. Sandboxing and distribution therefore do not change Flow semantics.

Durable source functions are never shipped as opaque code. Coordinators
evaluate the portable Plan/expression IR; workers receive only Action
implementations. A
child-Flow boundary may route to another coordinator, region, or deployment
when its manifest says so.

## Worker protocol

The transport is replaceable, but the semantic request is fixed and
schema-versioned:

```text
Invocation {
  executionId, nodeId, attempt, actionId, implementationDigest,
  input, deadline, capabilityGrant, lease, fencingToken, traceContext
}
```

A worker:

1. advertises the exact artifact digest and Action table it loaded;
2. leases an eligible invocation;
3. verifies the manifest and decodes the input schema;
4. runs under a narrowed capability grant and sandbox;
5. heartbeats for long work;
6. commits one encoded success, typed failure, or remote defect.

Large values use typed content-addressed `Artifact<T>` references rather than
passing bytes through the task queue. The wire encoding must be canonical and
identical across TypeScript, native, and Wasm so hashes and schemas agree.

The runtime journal/store is the authority. A worker process is disposable.
Leases and fencing tokens prevent a late zombie worker from committing runtime
state after a new attempt owns the node. They fence an external system only
when that system receives and validates the token.

## Runtime guarantees

- Execution lifecycle is durable: pending, running, suspended, completed,
  failed, cancelled.
- Execution identity is separate from cache identity. Callers normally provide
  an execution ID; payload-derived coalescing is explicit opt-in.
- State transitions and their journal event commit atomically.
- Journal and runtime state commit atomically with each other, never with an
  arbitrary external service. After an ambiguous crash, an admitted Action may
  execute again. An external effect is safe only when its destination
  atomically deduplicates a stable idempotency key, honors the supplied
  fencing/transaction protocol, or the Action has an explicit compensation
  strategy. Compensation repairs consequences; it does not provide
  exactly-once. `sealed` is a content-cache claim and does not make external
  effects exactly-once.
- Domain failures use the Action's typed `E`. Defects, worker loss, storage
  failure, and deployment unavailability remain distinct runtime outcomes.
  Infrastructure interruption may be retried without pretending it is a
  domain failure.
- Cancellation is recorded before propagation to active attempts and attached
  children. A race has one durably recorded winner.
- Timers, signals, human approvals, queues, and child Flows suspend without
  occupying a worker lease.
- In-flight executions are pinned to a Plan IR digest, provider manifest, and
  schemas. A new deployment does not silently replay old history under new
  code. Old worker artifacts remain routable until runs finish or an explicit
  migration is applied.
- The journal supports inspection and deterministic state reconstruction.
  Fork, rewind, and compensation are higher-level operations over that journal;
  irreversible boundaries are reported and never crossed silently.

### Execution control surface

Exact names are proposed, but long-running execution needs more than
`execute(input)`:

- `start(input, { executionId })` returns a typed durable handle immediately;
- `resume(executionId)` re-obtains that handle from persisted execution state;
- `execute` is the start-and-await convenience form;
- a handle exposes status, typed result, cancel, and signal operations;
- external signals carry idempotency keys and payloads validated against the
  schema already pinned by the compiler-owned Plan; a sender never supplies
  schema authority;
- poll, subscribe, inspect history, fork, and administrative recovery are
  runtime/library APIs over the same persisted execution.

Execution IDs are normally caller-selected. Payload-derived identity is an
explicit idempotency policy, never an automatic assumption that equal inputs
mean the same business operation.

The current Bun POC validates this surface with provisional
`waitSignal<Payload>("literal.identity")` source syntax and the handle methods
above. `executor.grantSignal(executionId, signalId)` returns a grant containing
an HMAC sender token; `deliverSignal` requires that token unless the caller
explicitly passes `{ unsafeLocalDelivery: true }`. Tokens are bound to one
execution/signal and checked before execution existence is read, but the secret
is stored in the same SQLite database, so this is a local-trust seam rather
than remote authentication or authorization.

The POC pins the compiler-derived structural payload schema at initialization,
journals canonical delivery and consume transitions atomically, and never
holds a worker lease while waiting. Its external boundary rejects more than
100,000 durable-JSON nodes/own fields before canonicalization, retains the
independent 8 MiB canonical-message ceiling, and byte-bounds request identities
before storage. An in-process post-COMMIT notifier wakes local waiters promptly;
a persisted-state fallback sweep (250 ms by default, configurable through
`wakeupSweepMs`) is the correctness path when notification is missed or comes
from another process. All spellings remain non-normative. Remote signal
transport and authorization, queues/broadcast, schema migration, and the final
inspection/administrative API remain open.

## Security and authority

Static requirements and an OS sandbox solve different problems and both are
needed:

- The compiler proves which capabilities an Action implementation can request.
- The deployment grants only the subset allowed for that pool and invocation.
- The sandbox prevents ambient filesystem, network, process, environment, and
  host-global access from bypassing those providers.
- Authority may be narrowed across child calls but never widened by callees.
- Artifact digests and manifests are verified before dispatch. Secrets and
  fields marked sensitive are redacted from traces and encrypted or excluded
  from durable payloads according to policy.

This section governs distributed Action workers. A code-writing agent may use a
smaller sandbox implemented entirely by its library: generated code is placed
in an otherwise confined evaluator and receives only explicitly passed
functions, some of which may invoke Actions or Flows. That agent sandbox adds no
VibeLang syntax or compiler security model; see
[`AGENT_LIBRARY.md`](AGENT_LIBRARY.md).

## What VibeLang should reuse from `flows`

Keep the proven ideas:

- the Action/Flow split and `Node<A, E, R>` algebra;
- symbolic projections and explicit branch/catch topology;
- content-addressed plan and dispatch keys;
- one-owner leases, heartbeats, fencing, and zombie protection;
- atomic journal/state transitions;
- sealed-cache evidence, idempotency, compensation, and irreversible effects;
- durable timers, signals/deferreds, queues, child executions, cancellation,
  replay inspection, fork, and rewind.

Replace library limitations with compiler features:

- JavaScript proxies become checker-enforced symbolic values;
- function-source hashes and live side tables become portable expression IR;
- handler replay becomes execution of a persisted plan;
- opaque placement becomes a typed deployment contract and multi-artifact
  build;
- the single Action tier becomes independent retry, compensation, and reuse
  policies;
- unsafe default sealing becomes explicit, evidence-backed sealing.

## Open design decisions

Resolve these one at a time:

1. Exact semantics and syntax for runtime-sized `for`, `while`, and fan-out,
   including stable item keys. The POC now carries a provisional answer: keyed
   `fanOut(...)` with optional multi-step bodies for the fan-out direction, and
   a `loopWhile(...)` round template with stable round ordinals and a static
   literal budget for the sequential direction. The spellings are non-normative
   and general authored loops still fail closed.
2. Provider API spelling and the retry/compensation/reuse policy shapes.
3. Stable Action/Flow ID and version syntax.
4. Deployment/worker-pool syntax and call-site placement constraints.
5. Canonical cross-target wire format and custom codec interface.
6. Code/schema migration rules for in-flight executions.
7. Explicit sequencing syntax for independent side-effecting Actions. The POC
   carries a provisional answer: `sequential(first, second)` over exactly two
   direct `Action.run(...)` calls, lowering to a pure control edge. Wider arity
   and the final spelling remain open.
8. Memo scope/generation syntax and whether a later explicit negative-cache
   policy may retain selected typed failures; success-only is the baseline.
9. Default graph-failure, race-loser, child-cancellation, and resource-fairness
   policies.
10. Exact execution-handle, signal, inspection, and administrative APIs.
