# Durable execution risk spike

This directory is a deliberately small end-to-end implementation of the risky
parts of `docs/DURABLE_EXECUTION.md`. It is not the proposed production runtime.

Run the executable self-test from the repository root:

```sh
bun poc/examples/durable/demo.ts
bun test poc/src/durable/*.test.ts
```

The demo and focused tests prove:

- a compiler-shaped, canonical Plan artifact can be validated, loaded, and
  executed without retaining or invoking an author callback;
- Plan/artifact/manifest format versions, exact fields, graph scope and
  dependencies, Action contracts, routes, pool artifacts, and semantic digests
  are checked before execution;
- an Action descriptor contains identity and compiler-derived structural
  schema/contract digests but no implementation; legacy authoring artifacts
  retain their explicit JSON-shape stub for compatibility;
- `source-compiler.ts` parses authored TypeScript without evaluating it, follows
  exact imported `durable`, `sleep`, `waitSignal`, `fanOut`, and Action symbol identity through
  aliases, and lowers a bounded function subset into the same validated static
  artifact;
- an Action declared in the compiled source as `class X extends Action<Signature>`
  needs no ceremony from the caller: `compileDurableSource` derives its contract
  from its own checked program through the same `deriveActionContract` the
  standalone contract compiler uses, so a derived descriptor and a separately
  compiled one are byte-identical for the same declaration. Its id is
  `<authored file>#<class name>` at version 1. `options.actions` is therefore
  optional and describes only Actions *imported* from modules this single-source
  pass cannot see. A success result reports the declarations it consumed in
  `derivedActions` with their authored ranges: they are compiler-owned contract
  declarations whose base class does not survive the erasure of the
  compiler-owned import, so a consumer erases them alongside it. A same-file
  Action whose failure channel is only the built-in `Error` keeps its structural
  input/success contract and records the weaker json-value error schema rather
  than losing the whole declaration;
- `compileActionImplementationContract` derives an ordinary provider
  function's transitive failure/requirement rows from a closed checked Smithers
  source project. Its recoverable failure row must exactly match the Action's
  compiler-derived nominal Error schema; `Panic` is recorded separately as a
  defect channel and can never impersonate a persisted typed failure.
  `Provider.provideChecked` accepts only the locally compiler-issued frozen
  contract/callback pair; provider creation, deployment, and manifest loading
  all recheck the exact Action identity and schema. Deployment also requires
  the capability grant to equal the derived requirement row exactly and pins
  the contract/source identity into provider, route, pool, coordinator, and
  manifest identity;
- legacy `Provider.provide` remains available for the existing POC examples,
  but it has an explicit null contract and cannot receive nonempty capability
  authority;
- the legacy-boundary POC `Flow.define(...)` callback can record strict symbolic
  input/results and disappear into serializable Plan IR, validating the IR
  boundary independently of the accepted compiler lowering;
- projection and argument passing produce data edges, independent Actions run
  concurrently, and explicit parallel, branch, and sequence topology works;
- deployment building rejects missing/ambiguous/incompatible providers and
  emits a coordinator digest, pool-specific artifact digests, and pinned routes;
- a pool built with `bundle: true` emits one deterministic JavaScript module
  from exactly the selected Actions' retained, compiler-checked source
  closures. Unselected providers are absent; imports outside a checked closure
  and nonempty capability rows fail closed. The SHA-256 of the exact UTF-8
  bundle bytes participates in the pool artifact and manifest digests;
- a canonical Ed25519 deployment envelope signs the exact validated Plan and
  manifest under an out-of-band trust root. Authentication returns a nominal,
  process-local proof tied to the exact `Deployment.build` result, and the
  authenticated coordinator factory consumes that proof before constructing
  any worker transport. Only `in-process-poc` has an implicit `LocalWorker`;
  every other signed sandbox requires an opaque host-issued transport token
  bound to that exact sandbox spelling;
- the same exact-field, schema-versioned invocation crosses both in-process and
  fresh zero-permission Deno worker boundaries with route, contract, policy,
  capability, lease, and manifest verification;
- `DenoBundleWorker` verifies those exact bytes against the signed pool
  `bundleDigest` immediately before composing a zero-permission Deno turn, and
  dispatches any Action in the pool through the bundle's exported Action
  table. Live provider callbacks authenticate coordinator-side routing but do
  not execute on this path;
- the provisional `remote-http-poc` transport serves one digest-pinned bundle
  from a worker-host process on `127.0.0.1`. The host independently verifies
  the signed artifact, bundle bytes, full invocation envelope, Action table,
  and monotonically increasing fencing tokens. Duplicate invocation identities
  join one in-flight execution or reuse one bounded in-memory committed exit;
  the coordinator still gates the only durable node/cache commit with SQLite;
- SQLite commits node state and its journal event in one transaction, and a
  restart reuses that exit even when the coordinator died after commit but
  before exposing the value;
- execution input/output, node exits, cache entries, and journal payloads carry
  checked content digests, so accidental SQLite corruption fails closed before
  replay;
- attempts retry with persisted deadlines/backoff, leases, monotonically
  increasing fencing tokens, and cooperative provider abort signals;
- a compiler-owned `sleep(milliseconds)` lowers to a first-class timer node;
  SQLite atomically persists its one absolute wake time, so restart and
  concurrent resume cannot reset the wait or complete it early;
- provisional compiler-owned `waitSignal<Payload>("identity")` lowers to a
  first-class signal node with a compiler-derived structural payload schema.
  SQLite pins that contract at execution initialization and atomically journals
  a canonical, schema-checked delivery addressed by exact execution/node/signal
  identity. One idempotency key and payload pair wins; retries adopt it, while
  conflicting keys or payloads fail closed. Consumption commits inbox state,
  node success, and journal evidence together without acquiring a worker lease;
- provisional `executor.start(input, { executionId })` returns a typed durable
  execution handle exposing `status()`, `result()`, `cancel()`, and
  `signal(signalId, { idempotencyKey, payload })`. Every handle method
  addresses only the handle's own execution id, delivery goes through the
  authenticated exact-identity path, and `executor.resume(executionId)`
  re-obtains an equivalent handle after process restart from the execution id
  and the store's pinned, digest-verified input alone. `execute` remains the
  start-and-await convenience;
- provisional authenticated local signal transport: `deliverSignal` is
  fail-closed by default and requires an opaque sender token minted by
  `executor.grantSignal(executionId, signalId)` (HMAC-SHA256 over exactly
  those two identities under a per-database secret created and persisted at
  store initialization). Forged, truncated, wrong-execution, wrong-signal, and
  foreign-secret tokens are rejected with a timing-safe comparison before any
  execution state is read; the tokenless direct call survives only behind an
  explicit `unsafeLocalDelivery: true`. The token is honestly scoped
  local-trust grant evidence — any principal with database read access can
  derive the secret — not remote-network authentication;
- event-driven wakeup replaces the 25 ms suspension polls: each `DurableStore`
  owns an in-process `WakeupService` keyed by execution id that signal
  delivery, cancellation, execution failure, and timer scheduling trigger
  strictly after their COMMIT, while suspended timer waits sleep to the exact
  persisted `wake_at` and signal waits sleep to the execution deadline, both
  bounded by a persistent fallback sweep (default 250 ms, `wakeupSweepMs`).
  Correctness never depends on a notification: a delivery or cancellation
  committed through another connection or process is observed at the sweep
  boundary at the latest, and the store's `wake_at` gate still rejects early
  timer completion after wall-clock rollback;
- compiler-owned `fanOut(items, item => item.key, item => Action.run(input))`
  lowers one runtime-sized array to a non-executable keyed Action template.
  SQLite atomically persists the complete canonical key/child/input-digest set
  before invocation; child ids derive from the template id and key rather than
  array position, and committed children replay independently after a crash;
- a fan-out body may also be a bounded block SEQUENCE of Action steps
  (`const a = First.run(...).unwrap()` … `return Last.run(...)`, at most 16
  steps) whose later inputs project the item and earlier steps' durable
  results. Step children derive ids from template id + item key + step
  ordinal; the complete step-0 set persists atomically before any dispatch and
  each later step's instantiated input digest commits atomically, after the
  previous step's durable success, before that step can dispatch;
- a compiler-bound, previously compiled durable Flow can be invoked as an
  attached child boundary with the provisional `ChildFlow.run(input)`
  spelling. The child Plan is embedded and digest-pinned in the parent
  artifact; the child runs as its own execution with its own journal, input
  checked against the child's compiler-derived Flow schema, the parent
  suspends without a worker lease, cancellation and execution failure fence
  attached descendants in the same durable transaction that records the
  parent outcome, and the child's terminal outcome is adopted run-locally
  before exposure. Embedding is structurally acyclic and bounded by an
  explicit depth budget of 8, the POC's round budget for the child boundary;
- provisional compiler-owned `sequential(first, second)` orders two
  independent Action calls through an explicit durable control edge with no
  invented data edge, returning both successes as an ordered tuple;
- provisional compiler-owned
  `loopWhile(initial, state => condition, state => Action.run(input), maxRounds)`
  lowers a runtime-round `while`-style next-round handoff template. Each
  round's child id derives from the loop node id and round ordinal; the
  round's input and originating-state digests commit atomically before
  dispatch and only after the previous round's durable success; the Action's
  success becomes the next durable state; and exhausting the explicit literal
  round budget (at most 1,000) is a durable terminal defect, never a hang;
- provisional compiler-owned `dequeue<Item>("queue.identity")` lowers to a
  first-class durable QUEUE consumer node (Plan format version 3). A queue is
  shared, multi-producer durable state with one cross-execution pinned
  compiler-derived item contract: `enqueue` validates against that registry, not
  against anything a producer supplies. FIFO order is commit order, enqueue is
  idempotent by `(queueId, idempotencyKey)`, and the head item's terminal state,
  the consumer node's success, and the journal evidence all commit in one
  transaction, so two coordinators can never hand one item to two consumers.
  A waiting consumer holds no worker lease and holds no reserved item;
- provisional compiler-owned `waitBroadcast<Payload>("identity")` lowers to the
  BROADCAST signal form, where one delivery satisfies every already-subscribed
  execution. A waiter's first poll commits a durable subscription WATERMARK (the
  highest delivery sequence at that instant) and is then entitled to exactly the
  deliveries committed after it, so a late execution never retro-consumes an old
  broadcast. Each waiter adopts a delivery exactly once through its own
  consumption record, which carries its own payload digest and therefore stays
  valid after retention collects the delivery row. Broadcast and single-delivery
  identities are different contracts and fail closed against each other in both
  directions, at the Plan node and in the cross-execution registry;
- a parent execution handle can address a signal inside an ATTACHED child Plan
  with `handle.signalChild([childFlowNodeId, ...], signalId, { idempotencyKey,
  payload })`. Authority derives entirely from the parent: the store walks the
  durable parent -> child linkage chain before any evidence exists, the minted
  token is consumed inside the call and never returned, and a child that is not
  attached along that exact path fails closed;
- an in-flight execution can be moved to a new deployment by an EXPLICIT,
  opt-in `MigrationPlan`. The compatibility judgment is re-derived inside the
  applying transaction from both artifacts and the execution's own durable rows,
  never trusted from the caller. Rewriting the pinned digests, fencing every
  live attempt, and journaling `execution_migrated` are one transaction, and
  re-applying an already-applied migration is idempotent. Every mutating
  coordinator entry point now carries the coordinator's Plan digest, so a
  superseded coordinator abandons a migrated execution instead of terminalizing
  it;
- cancellation is persisted atomically with node fencing, while a terminal
  execution failure fences unrelated active work before it can publish shared
  cache state;
- two coordinators using independent SQLite connections converge on one
  committed node and execution winner;
- run-local node identity, downstream idempotency identity, nondeterministic
  memo identity, and deterministic content identity are separate;
- memo is atomic first-success-wins, while content reuse verifies input/output
  evidence and reports unequal output as an integrity defect;
- cache publication and run-local success commit share one fenced transaction,
  so a zombie attempt cannot poison later executions; and
- every memo/content hit is first adopted into the current execution journal.

Every read-then-write store transaction opens with `BEGIN IMMEDIATE`, so two
live connections contending on the same rows serialize through SQLite's busy
handler and produce only modeled `busy`/fenced-loss results. A deferred
transaction that read before writing could instead fail its lock upgrade with
an unretried `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT`, turning transient
contention into a spurious terminal defect. `contention.test.ts` holds this
liveness property by racing two processes' interleaved claim/retry/commit
cycles over one database file and by fencing a stale attempt across two
connections.

`crash-matrix.test.ts` injects coordinator death immediately after each
material committed boundary, closes the connection, and resumes through a new
SQLite connection. Its matrix covers initialization, lease claim/fencing,
retry scheduling, ordinary/memo/content terminal adoption, cache-hit adoption,
branch skipping, deadline fencing, cancellation, execution failure, final
execution completion, and the queue/broadcast transitions: `enqueue`, the
`pollQueue` consume, the `pollSignal` broadcast subscription and consume, and
`deliverBroadcast`. Committed provider outcomes are not reinvoked, a producer
retry after a crashed enqueue adopts the committed item instead of adding one,
and a re-poll after a crashed consume reports `newlyConsumed: false`. The
migration COMMIT boundary has its own entry in `migration.test.ts`.

`process-crash.test.ts` complements that deterministic matrix with a real
subprocess boundary: it sends the coordinator `SIGKILL` immediately after
SQLite returns from the node-success COMMIT, opens the WAL-backed database in
a fresh Bun process, supplies a provider that throws if it is called, and
proves the committed result is adopted without reinvocation while
`PRAGMA integrity_check` remains clean. This is one high-value abrupt-death
checkpoint, not a complete OS/database fault-injection matrix.

`timer.test.ts` separately exercises the suspension boundary. A timer holds no
worker lease while waiting. The store, rather than an in-memory timeout, gates
claims on the persisted `wake_at`; cancellation clears that state and fences
the node, while the persisted execution deadline can win and record a terminal
defect. Tests cover artifact smuggling, invalid durations, an early direct
claim, wall-clock rollback after claim, crash immediately after scheduling,
crash after success but before exposure, replay, cancellation, and timeout.

`signal.test.ts` exercises the external-suspension boundary. It covers static
generic payload-schema derivation, forged Plan/schema rejection, delivery
before the coordinator reaches the wait, restart while suspended, exact
delivery identity, invalid payloads, duplicate and conflicting idempotency
keys, cancellation/deadline, a skipped branch, independent coordinator and
delivery races, and persisted contract/inbox/evidence corruption. A signal
node retains attempt zero and no owner or lease throughout suspension. Its
legacy direct deliveries all use the explicit `unsafeLocalDelivery: true`
escape hatch.

`handle.test.ts` exercises the provisional execution handle: typed success and
typed-failure results converging with the durable store, handle-scoped
cancellation and delivery that cannot touch a sibling execution, authenticated
handle delivery holding no worker lease, re-obtaining a handle across process
restart via `resume` from the pinned store input, terminal resumes exposing
committed outcomes without reinvocation, and exact-field option validation.

`signal-transport.test.ts` exercises the fail-closed sender-token seam:
tokenless delivery rejected before any execution state is read (no existence
probe), forged/truncated/replayed-across-executions/wrong-signal/
foreign-secret tokens, hostile authorization shapes (non-string tokens,
`toString` objects, unknown or conflicting evidence fields, symbol keys), a
valid token not weakening identity/idempotency/conflict rules, minted tokens
surviving process restart with identical tokens across live connections (the
secret at initialization is the token scheme's only committed boundary; grants
are stateless), and a corrupt persisted secret failing store initialization
closed.

`wakeup.test.ts` exercises both wakeup paths: a same-process delivery
completing far ahead of a one-minute sweep (fast path), a delivery and a
cancellation committed through a second SQLite connection — where the waiting
coordinator's notifier never fires — observed at the sweep boundary, a timer
sleeping to its exact persisted wake time rather than any interval, and the
`WakeupService` unit semantics (multi-waiter notify, elapse without
notification, no stored notifications, input validation).

`fanout.test.ts` exercises the parameterized-Plan boundary with a structural
Action and its v2 checked implementation contract. It proves source modules and
callbacks are never evaluated by the Plan compiler, keyed children retain the
same ids when input order changes, output still follows input order, duplicate
and noncanonical keys fail before provider invocation, and a child committed
immediately before coordinator death is not reinvoked after SQLite restart.

`fanout-steps.test.ts` extends that boundary to multi-step bodies: format-2
emission with per-step contracts, step-reference templates, byte/identity
stability of the single-step encoding, later-step digest fencing against
aliasing and missing predecessors, crash injection after the initial set, a
later step's materialization, and a step child's success, plus a two-connection
race converging on one chain with each provider invoked once per key per step.

`child-flow.test.ts` exercises the attached child boundary: pinned embedded
Plans, transitive requirement closure, the checker rejecting wrong child
inputs, a child execution with its own journal while the parent node stays
`pending` without a lease, run-local adoption of child success and typed
failure, single-transaction cancellation propagation with completed children
keeping their outcome, crash injection after linkage, after the child's
terminal commit, and after parent adoption, a two-connection race with one
linked child, an executable three-level chain, the depth-9 round-budget
rejection, and forged-artifact/linkage rejections.

`queue.test.ts` exercises the durable-queue boundary: compiler-derived item
contracts with stable node ids, dynamic/spoofed/duplicate-typed uses failing
closed, format-version and forged-schema artifact rejection, lease-free
suspension with attempt zero, FIFO consumption of exactly one item, idempotent
and conflicting enqueues, producer-token authorization (missing, tampered,
conflicting evidence fields, unpinned queue), a two-connection race in which one
item reaches exactly one of two waiting executions while the loser stays
suspended holding nothing, cancellation and deadline both ending a wait without
consuming, crash-after-consume adoption across a fresh SQLite connection,
restart while waiting, corrupt persisted item/registry/contract state, and two
Flows disagreeing about one queue's item contract.

`broadcast.test.ts` exercises the fan-out delivery form: contract identity
distinct from the unicast form (and the unicast encoding refusing to carry the
field at all, which would move every pre-existing pinned digest), one delivery
satisfying three subscribed executions with three consumption records, the
watermark preventing retro-consumption by a late waiter, idempotent and
conflicting deliveries, sender-token authorization including a unicast token
failing to authorize a broadcast, ambiguity between the two forms failing closed
in both directions and on payload disagreement, crash after one waiter's consume
leaving the others unaffected, a two-connection race on one waiter, retention
collecting only deliveries no live subscription can still claim while a consumed
waiter still re-verifies from its own record, and corrupt persisted state.

`migration.test.ts` exercises the in-flight migration boundary: a migrated
execution resuming committed history under a new Plan with a POISON provider on
the committed Action, a manifest-only hot fix under a pinned Plan, each
rejection reason (committed-node semantics, node-set change, Flow identity,
Flow contract, pinned suspension contract, no-op, pinned-digest mismatch,
terminal execution, unknown execution), forged/self-inconsistent migration
artifacts refused before anything commits while edited digest FIELDS are simply
ignored in favour of re-derived ones, a stale coordinator fenced out of a
migrated execution without terminalizing it, crash immediately after the
migration COMMIT converging on one applied migration, and a two-connection race
with exactly one applied winner.

`child-signal.test.ts` exercises parent-addressed child signals: one-hop and
two-hop attached paths, delivery journaled against the child execution's own
node identity, unlinked/wrong-kind/over-long paths and unknown identities
failing closed, one parent handle unable to reach a sibling parent's child, no
transferable capability appearing on the handle, a two-connection race
converging on one committed delivery, and forged child contracts or foreign
tokens refused before the inbox.

`sequential.test.ts` proves the explicit-order seam: a pure control edge with
no data dependency, statement and expression positions, tuple projections,
runtime evidence that the second Action observes the first's committed success,
crash-after-first-commit resumption without reinvocation, a two-connection
race preserving order, and forged forward/dangling control edges failing
validation.

`loop.test.ts` exercises the round template: format-2 emission, state/operator
templates, zero-round completion with the initial state, exact per-round
evidence and chained provider inputs, budget exhaustion as a durable terminal
defect that replays without new rounds, round aliasing/predecessor fencing,
crash injection after round materialization and round success, and a
two-connection race converging on one round chain.

`signed-deployment.test.ts` exercises the deployment admission boundary. It
uses real Ed25519 signatures over a versioned domain and canonical JSON,
requires canonical DER keys and unpadded base64url, derives key identity from
the public key, and rejects unknown/duplicate/mismatched trust roots,
wrong-domain signatures, artifact edits even after unkeyed digests are
recomputed, oversized envelopes, forged proofs, structural deployment
lookalikes, and worker creation before authentication. Trust-set rotation is
explicit: removing a key rejects future verification, but this POC has no
online revocation and does not invalidate an already-issued process-local proof.
It also proves that a non-local signed sandbox cannot silently fall back to
`LocalWorker`: absent, mismatched, forged, duplicate, and raw factories fail
before any transport factory is invoked. A host-issued transport token records
an explicit routing trust decision; it does not attest the factory's behavior.

The checked-provider seam is deliberately local compiler evidence, not
production artifact attestation. The checked-export digest is derived only
from checked source; the compiler deliberately does not use `Function.toString`
as evidence. Opaque in-process pairing prevents substitution after a contract
is issued, but a caller can still pair an arbitrary live callback at issuance,
and the compiler cannot prove that callback's lexical captures came from the
source project. Runtime codecs do independently reject a callback that returns
the wrong success or typed-failure wire shape. External implementation imports
therefore fail closed in this slice. A real nonempty capability grant must load
the callback and its closure from a signed or digest-pinned compiler-emitted
worker module; accepting a live host callback is not production-sound authority
isolation.

`DenoIsolatedWorker` is the bounded process-transport slice. A compiler-shaped
JavaScript function artifact and the complete Deno runtime/runner/config
identity are hashed together; every provider routed to that pool must include
that artifact digest in its dependency closure. The worker reuses
`LocalWorker.prepare` for exact invocation, manifest, capability, lease, and
input-codec checks, but the provider artifact itself runs only in a fresh Deno
process with filesystem, network, environment, subprocess, FFI, clock, random,
and dynamic-import authority denied. The coordinator independently validates
the returned discriminant and payload before persistence. Timeouts, malformed
exits, identity drift, and artifact tampering fail as non-cacheable defects.

`pool-bundle.test.ts` and `bundle-worker.test.ts` exercise the emitted-module
boundary: byte determinism under identical inputs, Action-level tree shaking,
checked-source/capability fail-closed behavior, the bundle digest's participation
in pool/manifest/signature identity, tamper rejection, two different Actions
dispatched from one bundle, exact typed-failure wire values, and preservation
of Deno sandbox limits. Runtime and Action modules are concatenated in
canonical order; modules use bundle-local Error constructors and do not install
runtime conveniences on the host's `Error.prototype` or `Reflect`.

`remote-worker.test.ts` exercises the local HTTP transport. Missing, forged,
and misspelled `TrustedWorkerTransport` tokens fail before a factory or network
call. A host advertising another bundle digest fails at handshake before
invoke. The real host rejects unauthenticated requests, stale fencing tokens,
and envelope reuse under one token, and replays a duplicate identity from its
one committed exit. A remote success under a stale store fence is rejected by
the same `BEGIN IMMEDIATE` commit predicate as a local success. The end-to-end
case starts the CLI worker-host as a real Bun subprocess, kills it after
dispatch, observes a persisted retry and higher fencing token against a
replacement host, then removes the host and proves a fresh coordinator/store
connection adopts the run-local commit without a network call.

The HTTP authentication boundary is deliberately narrow and local. Requests
and responses carry HMAC-SHA256 over a domain-separated role, timestamp,
method, path, and body digest under one per-deployment shared secret; MAC
comparison is timing-safe and timestamps have a bounded freshness window. The
transport accepts only plain `http://127.0.0.1:<port>` and follows no redirects.
There is **no TLS, no multi-machine transport, no principal identity, no key
rotation/revocation, and no solved shared-secret distribution or custody**.
Anyone holding the secret is fully trusted, and identical signed messages can
be replayed inside the freshness window (invocations are idempotent by
identity). This is a LOCAL-TRUST seam, not production network authentication.

## Structural codec vertical slice

`compileActionContract` now resolves an abstract class extending the
compiler-owned `Action<Signature>` binding and the compiler-owned
`Result<Success, Error>` type by checker identity. Before TypeScript erases the
signature, it emits canonical structural descriptors for Action input,
success, and nominal Error payloads. Descriptor bytes participate in the
Action contract digest, and the static Flow compiler regenerates typed virtual
Action declarations from that checked descriptor. Consequently, a wrong
`Action.run` input or symbolic projection is rejected before Plan emission.

Static Flow compilation now derives a structural input descriptor from the
checked function parameter, derives the success descriptor from the emitted
Plan expression/projections, and unions the structural Error descriptors of
reachable Actions. These schemas are part of the Plan digest. The coordinator
checks Flow input before creating an execution, success before terminal commit
and again on replay, and typed failures before recording the execution failure.
Unsupported Flow boundary types fail as `SMITHERS4110`. Legacy `Flow.define`
artifacts remain readable without falsely claiming this compiler-derived proof.

The bounded descriptor supports canonical JSON scalars and literals, arrays,
fixed tuples, exact objects with optional fields, bounded unions, and named
Error subclasses with compiler-derived payload fields. `any`, `unknown`,
functions, nested Promises, capabilities/class instances, symbol, bigint,
recursive or generic shapes, index signatures, and excessive depth/width fail
closed. The coordinator validates Action input before reuse or dispatch; the
worker validates it again before calling the provider and validates success or
typed failure before returning. The coordinator independently revalidates the
worker exit, cache hits, and replayed exits before exposure.

The POC nominal Error wire value is the canonical envelope
`{ version: 1, identity, payload }`. `identity` is compiler-derived and
`payload` follows the Error class's exact structural descriptor. This spelling
is deliberately **non-normative**: the specification has not locked its wire
encoding or migration rules. Generic and infallible Action contract forms also
remain fail-closed rather than inventing a bottom-error encoding. Legacy
`Action.define` JSON-stub Plan artifacts remain readable for compatibility;
new structural safety evidence uses `compileActionContract` plus
`Action.fromDescriptor`.

The implementation-row bridge is intentionally fail-closed. Typed
implementations require a structural `compileActionContract` descriptor;
legacy `Action.define` descriptors can authenticate only an empty recoverable
failure row. The POC proves that an implementation cannot omit, add, rename,
relocate, or change the payload of the Action's declared nominal Errors. It does
not prove that a declared failure is reachable, attest the paired host callback,
or attach retry semantics to the separately recorded `Panic` bit.

The most important finding is visible in `authoring.ts`: a JavaScript proxy can
record projections and reject coercion, enumeration, and calls, but JavaScript
offers no trap for truthiness, strict equality, or its operators. Consequently
ordinary `if (symbolic)` cannot implement the language contract. `Expr.*` and
`Flow.branch` in this spike are explicit versions of the expression/branch IR
that the real Smithers compiler must lower ordinary source syntax into.

The accepted source API imports `durable` from `smithers:flows` and passes it an
inline or otherwise statically resolvable function. Template
compilation lowers that function's checked syntax and control flow without
invoking it. Plan/preview then reads the emitted IR without the source function
or Action implementations present. The root `smithers plan` command invokes this
compiler over a real project without evaluating authored modules. The
deliberately bounded compiler lowers block-bodied `const` bindings, JSON-shaped
values, input projections, conditional expressions, imported
`Action.run(...).unwrap()`, compiler-owned `sleep(...)` and `sequential(...)`
statements/expressions, the bounded
`waitSignal<Payload>("static.identity")` form, the bounded keyed `fanOut(...)`
form with single-Action or multi-step bodies, the bounded
`loopWhile(...)` round template, compiler-bound child-Flow `run(...)` calls,
and returns. It emits stable semantic source IDs and
fails closed, with source locations, on statement branches, arbitrary loops,
mutable bindings, captures, optional/dynamic calls, and general higher-order
code. A local or foreign function merely named `sleep`, `fanOut`,
`sequential`, or `loopWhile` is not an intrinsic and cannot create durable
coordination nodes.

This timer is deliberately one small primitive: its Plan expression is a
relative, non-negative safe-integer millisecond duration, and the first
coordinator to reach it transactionally derives the absolute deadline. It
returns durable `null`, uses the ordinary Plan dependency/control edges, and
does not execute author code. The suspended coordinator sleeps to the exact
persisted `wake_at` (bounded by the execution deadline and the fallback
sweep), and in-process cancellation wakes it immediately through the store's
`WakeupService`; a cancellation committed through another connection is caught
by the sweep. This is an in-process notifier plus a sweep over one SQLite
file, not a distributed scheduler service. Wall-clock rollback cannot make a
node complete before its stored deadline, but this does not provide
distributed trusted time, calendar/cron semantics, or clock-skew consensus.

The signal API is intentionally provisional. This slice accepts exactly one
explicit structurally durable payload type and one bounded literal identity;
each node consumes at most one delivery. Every spelling —
`executor.start(...)`, `resume(...)`, the handle's
`status/result/cancel/signal`, `grantSignal(...)`, the `senderToken` /
`unsafeLocalDelivery` authorization fields, and the `vst1_` token format — is
provisional and non-normative. The sender token is an honest local seam: HMAC
over exactly (executionId, signalId) under a per-database secret makes
delivery fail-closed and unforgeable *without database access*, but anyone who
can read the SQLite file can derive the secret, so it is local-trust grant
evidence, not remote sender authentication, key rotation, revocation, network
transport, authorization policy, subscription, queue, broadcast, multi-message,
or schema-migration design.
The shared durable JSON boundary rejects more than 100,000 values/own fields
before canonicalization and retains its independent 8 MiB canonical-message
ceiling. Signal/execution/node/idempotency identities are nonempty, NUL-free,
and byte-bounded (128 bytes for the portable signal identity; 512 bytes for the
other request identities) before SQLite work.

The fan-out is likewise one intentionally small primitive, not general loop
lowering. Its collection is one durable array expression; its key callback must
be an inline direct projection returning a canonical string, number, or
boolean; and its body constructs Action inputs only from the current item,
earlier steps' durable results, and literals. At most 10,000 unique keys and
16 body steps are materialized. The persisted mapping includes each
instantiated input digest, so a restart cannot silently bind an existing child
id to different work; later steps validate their reconstructed inputs against
that persisted evidence before dispatch. Items execute concurrently, steps
within one item execute in order, and the parent records final-step results in
original input order. Index keys, captures, mutation, nested fan-out,
branches/timers/signals inside the body, and arbitrary authored loops fail
closed.

## Plan format versions

Format version 1 is the original bounded node set with the flat single-Action
fan-out encoding; every artifact the earlier compiler emitted keeps its exact
bytes, digests, and node ids, and continues to load. Format version 2 adds the
multi-step fan-out `steps` encoding, round-budgeted `loop` nodes, and
`childFlow` nodes with embedded child Plans. Format version 3 adds durable
`queue` consumer nodes and the `delivery: "broadcast"` signal form. The compiler
emits the minimal version each Plan needs, so programs in the old subset still
produce byte-identical version-1 and version-2 artifacts. A lower-version
artifact claiming a higher version's node or field is rejected with an explicit
"requires Plan format version N" diagnostic rather than being reinterpreted;
unknown future versions remain "unsupported Plan format".

The unicast signal encoding deliberately never carries a `delivery` field.
Spelling it `delivery: "unicast"` would be a second encoding of one meaning and
would silently move the `signalContractDigest` of every Plan emitted before
version 3, so the validator rejects that spelling outright. Broadcast nodes put
`delivery: "broadcast"` inside their contract digest, which is exactly what
makes a broadcast identity incapable of impersonating a single-delivery identity
of the same name.

## Migration of in-flight executions

An in-flight execution is pinned to a Plan digest, a manifest digest, and its
compiler-derived schemas. A redeploy never silently reinterprets that history:
moving an execution to a new deployment requires an explicit `MigrationPlan`
carrying BOTH complete artifacts, and `DurableStore.migrateExecution` re-derives
the entire compatibility judgment inside its `BEGIN IMMEDIATE` transaction from
those artifacts plus the execution's own durable rows. Claimed digest fields on
the migration value are evidence, not authority; editing them changes nothing.

Rules the system VERIFIES before it applies a migration:

1. the execution exists, is `running`, and is pinned to exactly the migration's
   source Plan and manifest;
2. `flowId` is unchanged (`flowVersion` may move);
3. the complete Flow contract — `flowSchemas.input`, `.success`, and `.error` —
   is byte-identical, and the PERSISTED input bytes are re-validated against the
   target input schema;
4. the static node id set is identical, so no durable node row is orphaned and
   no declared node lacks a row;
5. every node keeps its `kind`;
6. every node holding a durable terminal exit keeps byte-identical semantics
   (excluding `debug`, which carries no execution semantics and shifts with
   unrelated edits), so a committed exit can never be reinterpreted;
7. a template that already materialized dynamic children (fan-out items, loop
   rounds) or linked a child execution is frozen too, even while that template
   node is still running, because those durable child identities derive from it;
8. every `signal` and `queue` contract digest is frozen, committed or not,
   because the store pins those contracts once at initialization;
9. the migration changes something: `from` and `to` naming one Plan and one
   manifest is refused as a no-op.

Applying it is one transaction: every `running` node is fenced back to `pending`
with an incremented fence so no attempt admitted under the old code can commit
under the new one, the pinned digests are rewritten, `plan_generation` is
incremented, and one `execution_migrated` event records both digests, the
migration digest, the committed node ids, and the fenced node ids. Committed
history is appended to, never rewritten. Re-applying the same migration returns
`applied: false`, which is what makes a crash immediately after this COMMIT
recoverable.

Every mutating coordinator entry point — `claimNode`, `adoptSuccess`,
`timeoutNode`, `materializeFanOut`, `materializeFanOutStep`,
`materializeLoopRound`, `registerChildExecution`, `completeExecution`,
`failExecution`, `pollSignal`, `pollQueue`, and `initializeExecution` — now
carries the coordinator's own Plan digest and raises `ExecutionMigratedError`
when it does not match the pinned one. The engine treats that error exactly like
process death: it rethrows without recording a terminal outcome, because a
coordinator that can no longer interpret an execution is emphatically not
entitled to fail it.

Deliberately NOT attempted, and fail-closed rather than guessed:

- topology change — adding or removing Plan nodes, or changing a node's kind;
- widening or otherwise changing the Flow input/success/error contract;
- re-pinning a signal payload or queue item schema for a suspension that has not
  yet been consumed;
- transforming, backfilling, or reinterpreting committed node results;
- rewriting committed journal history (migration only appends);
- migrating a terminal execution, or migrating across Flow identities;
- implicit migration as a side effect of deployment: it is always explicit and
  opt-in, and old worker artifacts stay routable until runs finish.

## Durable queue and broadcast retention

A consumed queue item keeps its row, its consumer identity, and its digests as
durable evidence; nothing collects it. Broadcast deliveries are the one surface
with a retention rule, because one delivery is shared by every subscriber:

> `collectBroadcastDeliveries(retentionMs, now)` deletes a delivery only when it
> is older than `retentionMs` AND no live subscription could still claim it —
> that is, its sequence is at or below the lowest watermark among every
> non-terminal subscribed node for that signal. A signal with no live subscriber
> has no floor, so its aged deliveries are collectable.

Consumption records are never collected. Each carries its own payload digest, so
a waiter that already adopted a delivery still re-verifies its committed value
after the delivery row is gone.

## Provisional round-4 control spellings

`sequential(...)`, `ChildFlow.run(...)`, block-bodied fan-out steps,
`loopWhile(...)`, `dequeue(...)`, and `waitBroadcast(...)` are provisional
source spellings; the persisted node
contracts are the architectural seam, matching the ledger's open spelling
questions. Deliberate boundaries of this slice: `sequential` accepts exactly
two direct `Action.run(...)` calls; a child Flow binding must supply a
compiled Plan with structural Flow schemas and returns the child's success
directly (no `.unwrap()`); child deployments
are derived deterministically from the parent's worker pools at build time
and are not separately signed by the Ed25519 envelope; the loop's condition
and body are pure canonical-operator templates over one state value, its
budget is a static literal, and budget exhaustion is recorded as a durable
`LoopRoundBudgetExhausted` defect (a modeled terminal outcome, deliberately
not encoded into the Flow's nominal Error row). Parent termination fences
attached descendants inside the same `BEGIN IMMEDIATE` transaction that
records the parent outcome, so no committed state exists in which a parent is
terminal while an attached child silently keeps running; live in-process
attempts additionally observe the abort cooperatively.

A parent handle now reaches signals inside attached child Plans through
`signalChild([childFlowNodeId, ...], signalId, ...)`, gated on the durable
linkage chain; detached children are still out of scope, so there is no path to
an execution the parent did not create.

Queue and broadcast producer evidence reuses the signal-token scheme: HMAC-SHA256
over exactly one identity under the same per-database secret, timing-safe
comparison before any state is read, and the `unsafeLocalDelivery: true` escape
hatch for in-process callers. A unicast token cannot authorize a broadcast and a
broadcast token cannot authorize a queue, because each is domain-separated. It
remains honest LOCAL-TRUST evidence over one SQLite file, not remote sender
authentication. Enqueue and broadcast delivery wake at most 256 suspended
executions directly after COMMIT; every other waiter converges through the
persistent fallback sweep, so correctness never depends on that fan-out.

Deliberate omissions are custom codec registration, recursive/generic schema
representations, and a normative cross-target Error
wire encoding. Other omissions are general (unkeyed/unbudgeted) loop lowering
beyond the bounded `loopWhile` template, catch and compensation topology,
detached children, recurring/calendar timers,
artifact CAS, remote-machine or TLS transport,
remote sender authentication and grant rotation/revocation (the sender token
is local-trust evidence over one SQLite file), a cross-process notification
bus (the wakeup notifier is in-process; other connections converge via the
sweep), queue priority/visibility-timeout/dead-letter policy, data backfill or
transformation during migration, and distributed consensus. Local providers still
run as cooperative host callbacks; the isolated Deno bundle path proves forced
termination and exact bundle-byte pinning, and may additionally pin the Deno
runner/runtime identity through signed placement. The signed envelope now
authenticates a pool's `bundleDigest`, so a verifier plus admission check covers
the exact worker code bytes that digest names; the remote host independently
repeats both checks before serving. A bundle digest is **not provenance
attestation**: it does not prove who built the bytes, that a compiler was
uncompromised, or that an unpinned runtime/container/VM executed them. The
deployment signature does not authenticate the HTTP transport or solve
shared-secret custody. Exact sandbox routing prevents silent downgrade, but the
host remains responsible for issuing tokens only to factories that enforce
their declared sandbox. Retry jitter/sampling policy is
not persisted. Static-lowering call-site IDs tolerate unrelated line shifts,
but production still needs parser-integrated identity/migration rules across
larger refactors. The legacy `Flow.define(...)` IDs remain deterministic ordinals.
Co-located SHA-256 evidence detects accidental corruption, not a malicious
database writer. The Ed25519 envelope adds build-origin authentication under an
external trust root, but freshness, anti-rollback, revocation, signing-key
custody, and authenticated persisted state remain production responsibilities.
