# Durable execution

Status: design draft. The core Action/Flow model, the replay execution model, and
the distributed-build requirement are locked in [`DECISIONS.md`](DECISIONS.md) and
in [Durable Execution](/specification/durable-execution); everything else here is
a proposed baseline unless that ledger says otherwise.

> [!IMPORTANT]
> **Re-derived on 2026-08-27 against one-shot delimited continuations.**
> On 2026-08-27 durable execution was rebuilt on one-shot delimited
> continuations: a Flow is an ordinary function executed under a journaling
> handler, not a lowered execution-plan template. This draft has now been
> re-derived against that model. Text that described the plan model is not
> deleted silently — every claim someone might still be relying on is quoted in
> the [withdrawal and amendment record](#withdrawal-and-amendment-record--one-shot-delimited-continuations-2026-08-27)
> at the end of this file.
>
> Read [`DECISIONS.md`](DECISIONS.md) and
> [Durable Execution](/specification/durable-execution) first. Where this draft
> and the specification pages disagree, the specification pages win, and the
> decision ledger wins over both — that is the rule in
> `specification/index.mdx` §Source of Truth, which also makes this file part of
> the same specification set.
>
> **Three of the decisions this re-derivation rests on are pending ratification.**
> `DECISIONS.md` §Pending ratification records **PR-1** (build the Effect
> Manifest), **PR-2** (journal key `(siteId, occurrence)`), and **PR-3** (fail
> closed on version divergence) as adopted on a recommendation, awaiting the
> owner's sign-off, each with an explicit `**To reverse:**` line. Until that
> marker is struck, every sentence below that depends on one of them rests on a
> provisional foundation. Those sentences are marked **(PR-1)**, **(PR-2)**, or
> **(PR-3)** inline so the dependency is traceable rather than implied.

## Product contract

Smithers durable execution is a compiler and runtime contract. It does not
require applications to depend on a separate graph-building workflow DSL.

- An **Action** is an open runtime implementation behind a closed, durable
  signature.
- A **Flow** is an ordinary function whose execution is placed under the durable
  handler. `durable(...)` does not change what the function computes; it changes
  only which handler answers the function's effect requests. Branches, loops,
  `let` bindings, closure capture, and recursion execute unchanged inside it.
- Action implementations are ordinary Smithers functions/callbacks. Their
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
import { durable } from "smithers:flows"

abstract class Compile extends Action<
  (input: CompileInput) => Result<CompileOutput, CompileError>
> {}

abstract class Package extends Action<
  (input: PackageInput) => Result<Artifact, PackageError>
> {}

const Build = durable(function Build(
  input: BuildInput,
): Result<Artifact, CompileError | PackageError> {
  const compiled = Compile.run({ source: input.source })!
  return Package.run({ code: compiled.code })
})
```

`durable` is an imported compiler intrinsic, not a keyword. The compiler
recognizes the resolved import binding, so aliases preserve the behavior and an
unrelated function with the same name remains ordinary. Its argument must be an
inline function or another function the compiler can resolve statically.

The reason for that static-resolvability rule **changed**, and the change is
worth stating because the rule's spelling did not. It is no longer that the body
must be lowered to a plan. It is that the compiler must be able to **digest,
version, and address** the Flow's source — which is what pins an execution to a
body under [§Versioning](/specification/durable-execution) **(PR-3)**.

The call lowers to a serializable Flow descriptor carrying the Flow's pinned
source identity, its derived codecs, its Effect Manifest **(PR-1)**, and a
reference to the emitted Flow body. The identity, codecs, and Manifest are
serializable; the body is not reconstructible from them. It is not a runtime
callback wrapper. Uncompiled JavaScript fails while loading the compiler-owned
`smithers:flows` virtual module.

The compiler emits the checked function body in the resumable calling
convention. It does **not** call the function with proxies to discover a graph —
that prohibition survives the pivot and is strengthened: it now holds at every
phase, **including replay**. What it no longer implies is a symbolic layer.
`Compile.run` emits a journaled effect request bearing a stable site identity and
the derived codecs for its input and answer. `compiled` is an ordinary value —
the answer, delivered either from the journal or from a freshly dispatched
Action — and `compiled.code` is ordinary property access on it. Passing it to
`Package.run` is an ordinary argument, not a data edge. Neither Action
implementation runs during compilation or inspection.

## Compilation model

There are four distinct phases:

1. **Compilation.** The compiler emits the Flow body in the resumable calling
   convention and publishes its Effect Manifest **(PR-1)**, together with
   schemas, inferred failures and requirements, stable identities, and a source
   map. It never invokes the function. **The source function is needed
   afterward** — see the inversion in §Distributed builds and placement.
2. **Deployment build.** Provider layers are resolved. The compiler checks
   their complete dependency closure, partitions implementations into worker
   pools, and emits coordinator and worker artifacts plus a signed manifest.
3. **Inspection.** Tooling reads the emitted Effect Manifest and reports the
   Flow's reachable Actions, capability requirement row, external-input
   contracts, and failure row. It neither loads nor invokes the emitted Flow body
   or any Action implementation. It reports a **bound on what a Flow may
   request**; it is not a prediction of what a run will do and must not be relied
   on as one. Unresolved branches and runtime-sized iteration are not reported at
   all, because the Manifest carries no control flow.
4. **Execution.** An execution ID and validated input create or resume a run. The
   durable runtime executes the emitted body under the journaling handler,
   answering each request from the journal until the journal is exhausted, then
   dispatching.

Manifest, route, policy, schema, and invocation envelopes are versioned,
canonical, digest-pinned, and validated at every trust boundary. Unknown
versions and fields with semantic meaning fail closed rather than being
reinterpreted.

## The Flow body and the Effect Manifest

This section replaces the Plan IR section. There is no Plan IR: a Flow body is
ordinary TypeScript, and the only static artifact the compiler publishes about it
is the Effect Manifest.

The Manifest **(PR-1)** contains, per Flow: the set of Action identities the Flow
can reach, its capability requirement row, its external-input contracts, its
failure row, and its site table. **Sets and tables only.** It carries no
control-flow edges, no branch structure, and no execution counts. It is a bound
on the request alphabet, not a prediction of a trace.

Two obligations keep it honest, and both are normative:

- **Sound with respect to reachability.** Every Action identity, capability key,
  and external-input contract a run can reach appears in it.
- **Permitted to be imprecise about count and order**, and only about those. A
  Manifest that acquires an edge, a branch, or a count has begun growing back
  into an execution-plan template, and the pivot has been undone by accretion.

A call whose callee the compiler cannot resolve is either rejected inside a Flow
body or forces the Manifest to include the full effect set of the callee's
module. It never silently narrows the Manifest.

### Where each withdrawn plan node went

The earlier draft proposed a Plan IR node list. Each entry has a destination
under the replay model, and naming them is how a reader who relied on that list
finds the replacement:

| Withdrawn plan node | What the construct is now |
| --- | --- |
| constant, input, projection, pure expression | ordinary TypeScript evaluated in the body. Nothing is journaled, and nothing appears in any static artifact |
| Action call | a journaled effect request keyed `(siteId, occurrence)` **(PR-2)**; its Action identity appears in the Manifest |
| parallel join | an explicit recognized combinator, dispatched through the runtime scheduler (§Execution and scheduling behavior) |
| explicit sequence | **closed and withdrawn.** Program order is order, so there is no sequencing construct left to spell |
| branch/switch, Result/Error matching, completion | ordinary `if`/`switch` and ordinary matching. `!` is the ordinary failure exit — an `abort` request answered by the enclosing function's compiler-installed frame handler, per [Effects](/specification/effects) §Propagation Is an Abort Request. It is given no durable-specific meaning |
| parameterized `for`/`while` templates | ordinary loops. The static ceilings they carried are gone with the plan; see §Journal boundedness below, which is **open** |
| inline Flow | an ordinary function call |
| child Flow | retained as **Direction** — persisted child executions, attached, with their own execution identity and journal |
| next-round handoff | withdrawn. It existed to give recursion a bounded plan; recursion is now ordinary. A continue-as-new equivalent is **open** and is user-visible API |
| durable sleep, external signal, cancellation boundary | retained as runtime constructs; see [Durable Execution](/specification/durable-execution) §Durable Suspension and External Signals |
| compensation/finalization | retained as Action policy; see §Recovery and cache policy below |

Three of the old Plan IR *rules* inverted rather than moved, and each inversion is
a liberalization worth stating plainly:

- **No operation is refused for lacking an IR representation.** The old rule made
  "operations the IR cannot represent" a compile error so that nothing could
  accidentally inspect a placeholder. There are no placeholders, so the whole
  category of refusal is gone.
- **Recursion is not rejected.** Inline recursive expansion was rejected because
  a plan cannot contain itself. A body can, so it does.
- **Capture is unrestricted.** The old rule allowed a Flow to capture only
  compiler-known immutable values. Closing over mutable local state is now
  unrestricted, because there is no compile-time evaluation of the body to
  protect.

What replaced the capture restriction is stricter in the dimension that matters,
and is the subject of the next section.

### Flow determinism

The obligation that used to hold "while the compiler constructs the template" now
holds on **every execution and every resumption**. The full normative list is
[Durable Execution](/specification/durable-execution) §Flow Determinism; the
seven obligations in summary are: no clock, randomness, environment, process
state, filesystem, network, or mutable host state except through a request the
handler answers; no evaluation of a runtime string as code; no observation of
garbage-collection timing or cross-agent shared memory; no host time zone or
locale except through a capability; every started Promise consumed; every
arrival-order-dependent combinator dispatched through the scheduler; and
canonicalized iteration order at the capability boundary.

The per-member walls that make the first four enforceable live in
[Compatibility](/specification/compatibility) §Determinism-Sensitive Members and
are **uniform across all `.sm` code**, not scoped to Flow bodies. That uniformity
is deliberate and its cost is accepted: requirement inference is whole-program, so
a Flow's helper lives in another file, and a rule that fired only inside a Flow
would be a per-file dialect.

**Obligation 2 sits on an unratified conflict, and this draft does not settle
it.** "MUST NOT evaluate a runtime string as code" is enforced today by a shipped
refusal (`SMITHERS1604`: `eval`, the `Function` constructor, and selection of
`constructor` on a callable receiver). But
[Compatibility](/specification/compatibility) §Dynamic Features still carries the
Locked sentence "`any` and `eval` remain usable … the language does not forbid
them", which has not been withdrawn. **The implementation is deliberately ahead
of the specification here**, and the conformance corpus says so in its own case
notes. Replay raises the stakes rather than settling the question: an `eval`'d
string produces no journal entry, therefore no divergence to detect, so a
nondeterministic read the compiler could not see yields two histories from one
journal, silently. The full evidence — the two violated `MUST`s, the twenty of
twenty-two spellings that failed open, and the narrow "the operation is refused,
not the name" reading that might save the locked sentence — is in `DECISIONS.md`
§TypeScript target, recorded as **the most urgent of the six open questions**.
Nothing in this file may be read as having decided it.

**A dynamic import inside a Flow body lands on the Manifest soundness rule, and
its availability is itself contested.** A dynamic import is exactly the call whose
callee the compiler may be unable to resolve, so the Manifest rule above applies
to it directly: reject it inside a Flow body, or widen the Manifest to the whole
callee module — never narrow silently. Whether a dynamic import is available at
all is not settled: `DECISIONS.md` §TypeScript target records that the ledger, the
conformance corpus, and the shipped product **disagree three ways** — the lock
reads absolute, the corpus certifies two cases as compiling and running under a
narrow reading, and the shipped CLI refuses every one as deferred. This draft
takes no side, and no lane should move either side first.

### Journal boundedness

The plan model bounded execution size **by construction**, through static ceilings
on plan nodes, loop rounds, and fan-out steps. Those ceilings went with the plan
and **no replacement is specified**.

The exposure is concrete: a Flow body containing an unbounded loop can journal
without bound, and each resumption re-executes the whole prefix of the body, so an
execution with *n* requests resumed *n* times costs O(n²) body execution. A
runtime SHOULD impose a journal-size limit and MUST fail closed rather than
silently truncate.

This is **open**, and a continue-as-new equivalent is user-visible API that the
ledger explicitly declines to design under pivot pressure.

## Execution and scheduling behavior

- **The journal is append-only.** Replay answers each request from the entry at
  its `(siteId, occurrence)` **(PR-2)** until the journal is exhausted, then
  dispatches the first request with no entry. It never rewrites a committed
  prefix.
- **Effect ordering is the program order of the body.** Concurrency is started
  explicitly through a recognized combinator. Implicit reordering and
  auto-parallelization of independent Action calls do not occur.
- **Concurrent requests are scheduler-mediated.** The runtime assigns every
  concurrent request a deterministic submission index before dispatch, journals
  the completion order it observed, and reproduces that order on resumption. The
  scheduler has no source-language surface.
- **A durable race records its winner before exposing the result.** This survives
  the pivot and is strengthened by the scheduler: `Promise.race` and
  `Promise.any` charge a `Scheduler` requirement and must not be reachable except
  through it. Loser cancellation and cleanup remain explicit policy, and the
  default is still **open**.
- **Child Flows are attached**: their own execution identity and journal, parent
  cancellation propagates, and completion remains owned by the enclosing durable
  operation. Detached children are unavailable initially.

### Losing implicit fan-out parallelism — a product question, not settled here

The previous model ran every independent Action concurrently with zero author
annotation. That is gone.

The trade-off, stated on both sides, because it has not been decided:

- **Against the loss.** For a framework whose Actions are model calls, a 20-way
  independent fan-out that becomes sequential is a wall-clock regression measured
  in **minutes**, on the workload where that is the dominant cost.
- **For the loss.** Program order is what makes replay reproducible without a
  plan, and implicit concurrency is precisely why the previous journal keys had
  to be content-addressed in the first place.

**Whether the loss is acceptable is a product decision, not an engineering one,
and it is not made here.** It is recorded in `DECISIONS.md` §Durable execution
and in [Durable Execution](/specification/durable-execution) §What Replay Trades
Away (Cost 3). One consequence is worth repeating because it constrains
scheduling rather than opinion: if the loss is **not** acceptable, an explicit
concurrency combinator must ship in the same release as the first Flow that needs
one. It cannot be follow-on work, because a Flow written against sequential
semantics and later parallelized is a changed body with live executions.

### The `Promise.all` gap

There is a recorded tension here with no rule yet, and this draft does not invent
one. `Promise.all` and its keyed and settled variants are order-independent in
their *result*, so they charge no `Scheduler` requirement — yet they start
concurrent requests that must still acquire deterministic submission indices. Two
locked obligations pull against each other until this is settled: every
concurrent request is dispatched through the scheduler, and every `Promise`
member other than `race` and `any` stays free. Recorded in `DECISIONS.md`
§Durable execution and in
[Durable Execution](/specification/durable-execution) §Deterministic Scheduling.

## Action contract

Every Action descriptor contains:

- a nominal durable ID and version;
- derived input, success, and Error schemas;
- its inferred `A`, `E`, and Action requirement;
- implementation and policy digests;
- source/debug metadata.

Its identity also appears in the Effect Manifest of every Flow that can reach it
**(PR-1)**, which is what lets inspection report a Flow's reachable Action set
without loading anything.

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
ordinary Smithers code.

That contract has acquired a second job under the pivot: **it is also the
journaling classifier.** A request is journaled if and only if its answer
satisfies it — the whole rule, with no annotation or partition syntax added. A
`Clock.context()` answers with a service, which is not codec-representable, so it
is not journaled and is re-answered by the handler stack on every resumption; a
`clock.now()` answers with a number, so it is. See
[Effects](/specification/effects) §The Journaling Classifier.

### Stable identity

Flow **source** identity is now normative and closed: it is content-addressed,
pinned into the execution, and is what a coordinator compares before replaying
**(PR-3)**.

That partly satisfies the older proposal recorded here — that public Action and
Flow declarations carry an explicit stable ID, because renaming a symbol must not
silently change the identity of an in-flight durable operation. Under fail-closed
pinning a rename does not *silently* change anything: it changes the digest, and
the coordinator abandons the execution rather than replaying it under new code.
The safety property is delivered; the convenience is not. An explicit ID that
survives a rename **with live executions still resumable** is exactly the
versioning API that PR-3 declines to ship, and it remains **open**. The
persisted-ID encoding — as distinct from source identity — is likewise still
open.

### Recovery and cache policy

This section survives the pivot. Only its vocabulary is re-derived: what was a
"node" is a journaled request site, and what was "exposed downstream" is
"delivered to the resumed continuation".

Recovery design separates one invariant from three independent policies:

- **Run-local recording is mandatory.** It is not a cache policy.
- **Retry safety** is repeatable, downstream-deduplicated by a stable key, or
  manual after ambiguous completion.
- **Compensation** is optional and independent of retry safety.
- **Cross-execution reuse** is execution-only, memoized, or content-cacheable.

Every journaled request has run-local durable state at its
`(siteId, occurrence)` key **(PR-2)**, keyed independently of any cross-run reuse
key. Before an answer is delivered to the resumed continuation, each attempt and
the request's terminal exit — success, typed failure, or defect — commit with
their lifecycle events. Restart reuses that run-local exit. A memo or content hit
is first adopted into the current run, so later cache eviction cannot change
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
conflated: the run-local journal key `(siteId, occurrence)`, a downstream
idempotency key, a nondeterministic memo key, and a deterministic content key.

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

Provider composition comes from `smthrs/provider`; there is no special
`provide { ... }` statement. Exact API spelling remains open. A base dependency
environment has the type:

```ts
Layer<Provides>
```

It receives already acquired services and owns neither their resources nor
their tasks. Action/deployment provider configuration may separately describe
implementation requirements and policy; that does not turn a base Layer into
an implicit constructor or supervisor.

Under the continuation model, `Layer.provide(layer, body)` **installs a
handler** that accepts exactly the capability keys the layer provides and runs
`body` under it; a `get` request whose key the layer provides is answered and
resumed, and one it does not provide is forwarded outward. Scoping is therefore
structural rather than revocation-based: because the handler holds its
environment on its own stack rather than in ambient storage, a completed or
abandoned computation cannot issue a further request, and no promise-settlement
hook is required. See [Effects](/specification/effects) §Layer Provision Installs
a Handler and [Requirements](/specification/requirements) §Scoping.

Ordinary implementations obtain services through the compiler-recognized
context library rather than through explicit function parameters:

```ts
import { Context } from "smthrs/context"

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
import { Action, Layer } from "smthrs/provider"

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

- `Compile.run(...)` adds the nominal `Compile` requirement to the Flow's
  requirement row, which the Effect Manifest publishes **(PR-1)**.
- The provider satisfies `Compile`; the compiler checks the requirements and
  Result failures inferred from `compileWithEsbuild` as part of the deployment
  closure.
- A deployment build resolves that layer closure. Missing platform services,
  Action implementations, or codecs are build errors with a full requirement
  path.
- Provider selection is pinned in the deployment manifest. A runtime must not
  silently switch to a semantically different implementation.
- The Layer environment is installed on the worker that owns the implementation.
  Explicit worker code owns acquisition and disposal with `using`;
  memoization is an Action policy, not a Layer lifetime feature. Secrets are
  injected on the worker and are not embedded in the Manifest or bundle.

**The "build errors with a full requirement path" bullet has a known hole, and it
is not closed here.** `DECISIONS.md` §Requirements and dependency injection
records **R1, subclass substitution at a capability receiver**: a concrete
`typeof Db` annotation is accepted and records the nominal key `Db`, but a
subclass of `Db` is assignable to `typeof Db` and its nominal key is a *different*
one — so a program can check clean against a satisfied layer and **panic at run
time** with a capability that was never provided. This is not a fork-versus-
reference disagreement; **both backends behave identically**, and the hole is
pinned as a KNOWN RESIDUAL at both sites that read a capability receiver. It is a
bounded residual — a type parameter merely *bounded* by `typeof Db` is refused at
both sites, and a subclass used directly records the subclass — and the unpinned
middle case is passing a subclass where a concrete `typeof Db` parameter is
declared. Two of the three candidate fixes contradict forms the language
currently accepts. Not resolved here; see the ledger entry for the evidence and
the constraint that any fix must move all three receiver walks together.

## Distributed builds and placement

Placement is a property of an implementation/deployment, not of the abstract
Action. This preserves “open implementation, closed signature”: one `Compile`
Action may have several implementations placed in different worker pools,
machines, regions, or sandboxes.

A deployment declares worker pools. A pool has:

- hard constraints: OS, architecture, region/data residency, required device,
  sandbox strength, and capability envelope;
- scheduling preferences: affinity, cost, latency, and locality;
- resource and concurrency limits;
- the provider layer whose Action implementations it hosts.

The concrete configuration syntax is still open. Its shape is approximately:

```ts
import { Deployment, Layer, Worker } from "smthrs/provider"

export default Deployment.make({
  workers: [
    Worker.pool("build", {
      sandbox: "container",
      placement: { region: "us-west", cpu: 4 },
      layer: BuildActions
    })
  ]
})
```

The build emits:

1. a coordinator artifact containing **the emitted Flow bodies** in the resumable
   calling convention, their Effect Manifests, schemas, routing, and durable
   runtime code, but not remote implementation code;
2. one tree-shaken TypeScript artifact per worker pool, containing only that
   pool's Actions and provider closure;
3. a signed deployment manifest mapping each Action implementation digest to its
   artifact, schemas, requirements, policies, and allowed placement;
4. source maps and the Effect Manifest — a bound on what each Flow may request,
   not an execution graph.

The compiler groups compatible Actions into worker-pool artifacts; it does not
blindly create one bundle per Action. Host requirements — an exact host module,
or a capability only some pools can satisfy — constrain which pool an
implementation can be placed in.

**The Flow body is not removable, and this is the exact inverse of what this
draft previously said.** The emitted Flow body must be present in every artifact
that can create or resume an execution of that Flow, reachable by the Flow's
pinned source identity, and **tree-shaking must not remove it**. Inspection must
not load it. What survives from the old sentence, verbatim and strengthened, is
its other half: a coordinator must not require a live function side table, a
proxy-recorded graph, or any value that did not arrive from the journal or from
the Flow's declared input.

Durable source functions are still never shipped as opaque author blobs. What a
coordinator runs is compiler-emitted code in a compiler-owned calling convention,
addressed by pinned source identity and covered by `flowSourceDigest`; workers
still receive only Action implementations. A child-Flow boundary may route to
another coordinator, region, or deployment when its manifest says so.

### Signing

The signed artifact is `{flowSourceDigest, effectManifest, journalSchemaVersion,
routingManifest}` **(PR-1)**, and it must be authenticated before a coordinator
creates workers. `flowSourceDigest` must cover exactly the emitted Flow bodies
that can create or resume an execution. The authenticated manifest pins
coordinator, worker artifact, implementation, policy, schema, capability-grant,
and Flow source identities.

Verification keys come from an out-of-band trust policy; an artifact cannot
introduce its own authority. A signature establishes provenance and integrity of
those claims. It does not establish freshness, prevent an authorized signer from
publishing bad content, attest worker/sandbox state, or replace revocation and
anti-rollback policy.

**And it now attests to something narrower than it used to.** A signature over
this artifact attests to *what a Flow is and what it may request*. It must not be
described as attesting to what a run will do. That is a real loss, it is stated
plainly rather than absorbed, and §What this model gives up records it.

An in-process executor is simply the local implementation of the same worker
protocol. Sandboxing and distribution therefore do not change Flow semantics.

## Worker protocol

The transport is replaceable, but the semantic request is fixed and
schema-versioned:

```text
Invocation {
  executionId, siteId, occurrence, attempt, actionId, implementationDigest,
  input, deadline, capabilityGrant, lease, fencingToken, traceContext
}
```

`siteId` and `occurrence` replace the plan model's `nodeId` **(PR-2)**. The pair
is what makes a divergence report able to name a **source location**, which an
execution ordinal cannot.

A worker:

1. advertises the exact artifact digest and Action table it loaded;
2. leases an eligible invocation;
3. verifies the manifest and decodes the input schema;
4. runs under a narrowed capability grant and sandbox;
5. heartbeats for long work;
6. commits one encoded success, typed failure, or remote defect.

Large values use typed content-addressed `Artifact<T>` references rather than
passing bytes through the task queue. The wire encoding must be canonical and
identical across every artifact that participates in one execution, so hashes and
schemas agree; the encoding itself remains **open**.

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
- **In-flight executions are pinned to a Flow source identity**, provider
  manifest, and schemas **(PR-3)**. A coordinator whose Flow source identity
  differs from an execution's pinned identity **abandons** that execution rather
  than replaying it or recording a terminal outcome for it. A new deployment
  therefore cannot silently replay old history under new code. Old worker
  artifacts remain routable until runs finish or an explicit migration is
  applied. Until a versioning facility is specified, editing a Flow body with
  live executions is an **operational migration, not a code change**.
- **Divergence is detected during an attempt and names its site.** If the body
  issues a request whose site identity does not match the journal entry at that
  occurrence index, or completes while journal entries remain unconsumed, the
  runtime reports a divergence naming the offending source site, fails the
  attempt, does not commit, and abandons the execution rather than recording a
  terminal outcome.
- The journal supports inspection and deterministic state reconstruction, now by
  re-executing the body against the journal rather than by evaluating a stored
  graph. Fork, rewind, and compensation are higher-level operations over that
  journal, and a fork or rewind point is a `(siteId, occurrence)` prefix;
  irreversible boundaries are reported and never crossed silently.

### Execution control surface

Exact names are proposed, but long-running execution needs more than
`execute(input)`:

- `start(input, { executionId })` returns a typed durable handle immediately;
- `resume(executionId)` re-obtains that handle from persisted execution state;
- `execute` is the start-and-await convenience form;
- a handle exposes status, typed result, cancel, and signal operations;
- external signals carry idempotency keys and payloads validated against the
  schema the compiler already pinned in the Flow's **Effect Manifest**
  **(PR-1)**; a sender never supplies schema authority;
- poll, subscribe, inspect history, fork, and administrative recovery are
  runtime/library APIs over the same persisted execution.

Execution IDs are normally caller-selected. Payload-derived identity is an
explicit idempotency policy, never an automatic assumption that equal inputs
mean the same business operation.

`waitSignal<Payload>("literal.identity")` illustrates the source shape. The
compiler pins the literal signal identity and derived payload schema in the
Manifest, which is what makes a wait **addressable before the execution reaches
it** — the property that lets a delivery client schema-validate, authorize, and
idempotently commit a delivery to a wait the Flow has not yet arrived at.
Delivery requires authority bound to the execution and signal plus an idempotency
key; the sender cannot replace the schema. Delivery and consumption transitions
commit atomically, and waiting holds no worker lease. Retrying the same key and
payload is idempotent; a conflicting key or payload for a single-delivery wait
fails closed.

That addressability property is the load-bearing reason PR-1 exists: `DECISIONS.md`
§Pending ratification records that if the Effect Manifest is not built, the locked
ahead-of-time addressability requirement becomes **unsatisfiable** and must be
withdrawn in the same edit.

Notifications occur after commit and optimize latency only. Coordinators MUST
re-read persisted state so a missed or cross-process notification cannot change
correctness. Remote authorization and transport, queues and broadcast, payload
budgets, schema migration, and the final inspection and administrative API
remain open.

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

The integrity of the durable intrinsic itself rests on a mechanism whose
ownership is **an open question**. `smithers:flows` is a compiler-owned virtual
module, and "uncompiled JavaScript fails while loading it" is enforced by
specifier form against an exact registry of compiler-intrinsic specifiers, with
prefix matching deliberately refused because it has already been a fail-open
twice. `DECISIONS.md` §Compiler and delivery records that the
`@module` / `@throws {never}` marker is doing **two jobs at once** —
module-initialization safety for foreign modules whose top-level code can panic,
and access control for the compiler-owned prelude — and that the two agree today
only because the second is enforced by specifier form rather than by the marker,
and because `runtime/result.ts` and `runtime/panic.ts` are **unmarked on purpose,
their unmarkedness being the forgery guarantee**. A future edit that "tidies up"
that unmarkedness would look like a cleanup and be a forgery hole. Not resolved
here.

This section governs distributed Action workers. A code-writing agent may use a
smaller sandbox implemented entirely by its library: generated code is placed
in an otherwise confined evaluator and receives only explicitly passed
functions, some of which may invoke Actions or Flows. That agent sandbox adds no
Smithers syntax or compiler security model; see
[`AGENT_LIBRARY.md`](AGENT_LIBRARY.md).

## What this model gives up

The pivot buys ordinary control flow inside a Flow. It is not free, and the costs
are stated plainly here so that neither is discovered later and reported as a
regression. [Durable Execution](/specification/durable-execution) §What Replay
Trades Away is normative for all three; this is the short form.

**Cost 1 — static flow-version divergence detection.** The previous model decided
statically *and totally* whether an in-flight execution could move to a new
version, by diffing two plan templates node by node, before the new coordinator
touched a journal. That capability is not hypothetical: the prototype computes it
at compile time today in `poc/src/durable/migration.ts` against
`poc/src/durable/store.ts`, from plan and manifest digests. Under replay no such
total static answer exists. It is the hardest unsolved problem in this class of
system — the state of the art detects divergence only at run time and without a
source location. What replaces it is a **partial static answer plus a named
dynamic one**: pinned source digest failing closed, the Effect Manifest site-table
diff, and replay divergence detection that does name the source site. Strictly
better than run-time-only detection with no static layer at all. **Strictly worse
than the total static answer this draft previously described.**

**Cost 2 — the signable pre-execution artifact.** An operator could previously
read and sign *what a Flow will do*. The signed artifact now attests to what a
Flow **is** and what it **may request**. One honest correction shrinks the loss:
the previous artifact was already a template rather than a trace — this very
draft conceded that unresolved branches and runtime-sized fan-out remained
explicit templates — so for any Flow with runtime-dependent control flow it
already answered *may*, not *will*. What is actually lost is **bounded may**: the
static ceilings that made the template finite. Three properties are lost outright:
the order Actions run in, a bound on how many times each runs, and a
human-readable pre-execution graph.

**Cost 3 — implicit fan-out parallelism**, above, and undecided.

The Effect Manifest **(PR-1)** buys back cost 2 outright and roughly half of cost
1. **It is not a free trade**, and the Manifest must not be described as
equivalent to the artifact it replaces.

## What Smithers should reuse from `flows`

Keep the proven ideas:

- the Action/Flow split, and the `(A, E, R)` triple — which survives as the
  compiler-inferred effect row on an ordinary function type, not as a
  user-visible `Node<A, E, R>` or `Effect<A, E, R>` value;
- explicit branch and catch topology — as ordinary `if`, `switch`, and matching
  in the body, rather than as a graph;
- content-addressed identity — now the site identity that keys the journal
  **(PR-2)**;
- one-owner leases, heartbeats, fencing, and zombie protection;
- atomic journal/state transitions;
- sealed-cache evidence, idempotency, compensation, and irreversible effects;
- durable timers, signals/deferreds, queues, child executions, cancellation,
  replay inspection, fork, and rewind.

Replace library limitations with compiler features:

- opaque placement becomes a typed deployment contract and multi-artifact build;
- the single Action tier becomes independent retry, compensation, and reuse
  policies;
- unsafe default sealing becomes explicit, evidence-backed sealing;
- proxy-discovered graphs become a body the compiler emits directly — the
  prohibition on proxies survives and is strengthened to hold at every phase
  including replay, but nothing symbolic replaces them;
- **live function side tables** are still refused. That half of the old sentence
  survives verbatim.

Three entries of the old "replace" list inverted, and they are the pivot in
miniature:

| Old claim | What is true now |
| --- | --- |
| "JavaScript proxies become checker-enforced symbolic values" | proxies are refused, and there are no symbolic values to replace them with |
| "function-source hashes … become portable expression IR" | the function-source hash was **adopted**, not replaced. It is `flowSourceDigest`, and it is what pins an execution to a body **(PR-3)** |
| "handler replay becomes execution of a persisted plan" | exactly reversed: execution of a persisted plan became handler replay |

## Open design decisions

Resolve these one at a time. Items 1 and 7 of the previous list are **closed** —
program order is order, so there are no loop or fan-out templates to give
semantics to and no sequencing construct to spell — and their replacements are
listed here instead.

1. Journal boundedness and a continue-as-new equivalent (§Journal boundedness).
2. Provider API spelling and the retry/compensation/reuse policy shapes.
3. Persisted-ID encoding, and a Flow versioning facility that permits a body to
   change with live executions **(PR-3 declines to ship one; the question is
   open)**. Stable *source* identity is closed.
4. Deployment/worker-pool syntax and call-site placement constraints.
5. Canonical wire encoding and custom codec interface.
6. Journal-schema migration rules for in-flight executions.
7. How an *order-independent* concurrency combinator reaches the scheduler
   (§The `Promise.all` gap).
8. Memo scope/generation syntax and whether a later explicit negative-cache
   policy may retain selected typed failures; success-only is the baseline.
9. Default failure, race-loser, child-cancellation, and resource-fairness
   policies. The plan-model spelling of this question — "whether unrelated cones
   continue, cancel, quarantine, or await recovery" — no longer parses, and its
   replacement is recorded as a finding below.
10. Exact execution-handle, signal, inspection, and administrative APIs.
11. What the Effect Manifest's **site-table diff** normatively obliges an
    implementation to do. It is described as recovering "a site with committed
    evidence must not change its semantics", but that is a statement of what the
    diff buys back, not an obligation. What counts as a site's *semantics* is
    unspecified. Recorded rather than invented.
12. Whether a disposal error raised while unwinding an **abandoned** computation
    can be observed by the handler; see [Effects](/specification/effects)
    §Abandonment.

Five further questions are open across the specification set and are **not**
durable-execution questions to settle here, though three of them reach into this
file: implicit fan-out parallelism (§Losing implicit fan-out parallelism), R1
subclass substitution (§Providers), dynamic import (§Flow determinism), the
`@module` / `@throws {never}` marker (§Security and authority), and
§Dynamic Features versus the shipped `eval` refusal (§Flow determinism). All five
are recorded with their evidence in [`DECISIONS.md`](DECISIONS.md).

## Findings from this re-derivation

Two claims in the previous draft turned out to rest on nothing any current page
supports, and no open question covered them. They are recorded as questions here
rather than answered, and neither is silently deleted.

1. **Concurrent-sibling failure policy has lost its spelling and not gained a
   rule.** The old draft said "a failed node always blocks its dependent cone",
   and left open whether unrelated cones continue, cancel, quarantine, or await
   an explicit recovery node. There are no cones. A failure in program order
   exits the body through the ordinary failure exit, and
   [Effects](/specification/effects) §Abandonment specifies what happens to the
   *abandoned* computation — every live `using` and `await using` scope disposed
   in reverse acquisition order, every `finally` run, `catch` clauses not run.
   What no page states is what happens to **concurrent requests still in flight**
   when one arm of an explicit combinator fails: whether they are cancelled,
   awaited, or abandoned, and what is journaled for them. Open.
2. **The multi-ABI worker pool is unsupported.** The previous draft gave a pool a
   "target and ABI: TypeScript/JS, native, or Wasm", offered "optional target
   variants of a pool, such as a Node bundle, native binary, component", and
   required a wire encoding "identical across TypeScript, native, and Wasm". The
   near-native/LLVM and Wasm **compilation targets** were withdrawn on 2026-08-23;
   TypeScript is the only target, and both the ledger and
   [Durable Execution](/specification/durable-execution) §Distributed Deployment
   speak only of **TypeScript** worker artifacts. What is still supported is
   narrower and is what this file now says: worker artifacts are TypeScript, and a
   native or Wasm implementation reaches the host through the ordinary foreign
   boundary — Wasm survives as a *library* format through generated bindings, not
   as a target. Whether a worker pool may be a non-JavaScript **process** at all,
   and what its ABI contract would be, is stated by no page. Open. The ledger's
   surviving Direction entry — placement "allowing multiple target and location
   implementations of one closed signature" — is the sentence that would have to
   be read one way or the other to settle it.

A third observation was not a specification question but a documentation defect:
the guide, reference, and introduction pages still described the plan model.
**Resolved on 2026-08-27.** `guide/durable-execution`,
`reference/actions-and-flows`, `reference/cli` (`plan` command),
`reference/language-syntax`, `reference/comptime`, `guide/comptime`,
`guide/features`, `introduction/why-smithers`, `introduction/overview`,
`introduction/philosophy`, `reference/standard-library` and
`docs/TYPESCRIPT_FORK.md` were re-derived against the specification, each with a
withdrawal record where a claim inverted. `poc/src/durable/README.md` still cites
this file for parts of the model this revision rewrote; that path is outside
`docs/**` and remains outstanding.

Two further defects were found during that pass and are **not** fixed, because
neither is a documentation problem. Both were re-measured on 2026-08-27 and both
now carry a direction marker on the specification page that states the gap; see
[Specification Status](/specification/index) §Specification–Implementation Gaps.

- **`failures.mdx` §Refusal Conditions has been reached by the implementation — `(SA-1)`, narrowed 2026-08-30.** "Placement is unrestricted" now holds for five of the six worked forms: `r!.length`, `r!.trim()`, `r![0]`, `r! ?? "fallback"` and `f(r!)` all compile and run on the reference backend, and the four corpus cases that certified their refusals were flipped to `expect: "output"` with `xfail(go)` markers, the Go fork still holding the withdrawn walk. What is left is not a placement rule: the shipped early-`return` lowering cannot hoist its guard out of a conditionally evaluated operand (`maybe ?? r!`, `SMITHERS1204`), a repeated loop header (`SMITHERS1703`; hoisting `while (next()!) {}` never terminates), or past an unhoisted effect earlier in the same statement (`g() + r!`, `SMITHERS1204`). Those three are uniform across both `effectLowering` modes and retire with that lowering.
- **The durable frontend has left the plan model half way — `(SA-2)`, narrowed 2026-08-31.** A runtime branch and a runtime loop inside a `durable(...)` body now compile on both backends: `SMITHERS4106` and `SMITHERS4107` are **withdrawn**, together with the optional-projection and non-boolean-conditional refusals that shared `SMITHERS4106`, the unsupported-expression `SMITHERS4111` fallthrough, and the unnameable-call `SMITHERS4112` fallthrough. Such a body is not refused; the Plan lowerer declines it without a diagnostic and the Flow publishes its Effect Manifest instead, and thirteen `17-durable` cases moved from `expect: "diagnostics"` to `expect: "output"` in one commit. What is left: `Action.run` is typed `A | undefined` rather than `Result<A, E>`, so the annotated Flow signature that this file and `durable-execution.mdx` both show still does not check — measured as `SMITHERS4100` — a plain `return` inside a durable body is still not Result-lifted, a `let` binding is still refused (`SMITHERS4105`), closure capture is still refused (`SMITHERS4110`), and recursion or any call to a project-declared function is now refused by the Effect Manifest (`SMITHERS4199`) rather than by the withdrawn wall, because the Manifest must reject a call it cannot account for instead of narrowing its effect set silently.

The `conformance/COVERAGE.md` §4.12–§4.19 citations of "failures.mdx §Accepted
Placements", a section this revision deleted, were repointed on 2026-08-27; see
that file's 2026-08-27 citation record.

## Withdrawal and amendment record — one-shot delimited continuations, 2026-08-27

Following the house style of `conformance/COVERAGE.md`'s 2026-08-23 withdrawal
record: what was removed is quoted verbatim, what was kept is named, and a loss is
not presented as a tidy-up.

Retained and unaffected by the pivot: the Action model, the durable codec
contract, journaling and adoption, recovery and reuse policy, external-signal
delivery semantics, distributed deployment, and the security obligations. What
follows is everything that did not survive.

**Withdrawn — the definition of a Flow:**

> "A **Flow** is a closed program produced when the compiler lowers the checked
> body of a function passed to `durable(...)` into a typed, target-neutral
> execution-plan template."

**Withdrawn — the lowering and the symbolic layer:**

> "The compiler lowers the function's typed syntax and control-flow graph … 
> `Compile.run` lowers to an Action node. `compiled` is a typed symbolic value and
> `compiled.code` is a typed projection from that node. Passing it to
> `Package.run` creates the data edge."

There are no plan nodes, no symbolic values, no projections, and no data edges.
Property access on a journaled answer is property access. The sentence "it does
not call the function with proxies to discover the graph" survives verbatim and
is strengthened to hold at every phase, including replay.

**Withdrawn — the whole `## Plan IR` section**, including its node list and its
seven rules. Each node's destination is tabulated in §Where each withdrawn plan
node went. Three rules inverted rather than moved and are named in that section:
the IR-representability refusal, the rejection of inline recursion, and the
capture restriction.

**Withdrawn — `plan/preview` as a phase:**

> "**Plan/preview.** Tooling reads the emitted Plan IR, validates and optionally
> specializes known input, and reports the execution graph. … Unknown branches and
> runtime-sized fan-out remain explicit templates."
>
> "Smithers emits portable expression IR and compiler-stable identities. Plan mode
> analyzes that emitted artifact; it never executes a Flow source function."

The phase is **inspection** and it reads the Effect Manifest **(PR-1)**. The
obligation that it never loads or invokes the source function or an Action
implementation survives verbatim; only the artifact it reads changed. The
"unknown branches remain explicit templates" sentence is withdrawn outright,
because the Manifest carries no control flow: an unresolved branch is not
reported at all.

**Withdrawn — implicit concurrency:**

> "Action calls are ordered by data/control edges, not source position.
> Independent calls may run concurrently. An explicit sequencing construct is
> required when two calls have no data dependency but order matters."
>
> "Independent ready Actions may run concurrently within declared worker and
> resource limits."

Program order is order. The sequencing construct that item 7 of the old open list
asked for has nothing left to sequence, so that question **closes**. The
permission for implicit concurrency is withdrawn as a **capability loss, not a
tidy-up** — see §What this model gives up, cost 3 — and whether that loss is
acceptable is the open product question this file must not decide.

**Inverted — the removability of the durable source function.** The previous
obligation was the exact opposite of the current one:

> "The source function is not needed afterward."
>
> "Durable source functions are never shipped as opaque code. Coordinators
> evaluate the portable Plan/expression IR; workers receive only Action
> implementations."
>
> "a coordinator artifact containing Plan IR, schemas, routing, and durable
> runtime code"

The emitted Flow body is now what resumes an execution, so it must be **present**
in any artifact that can resume one, must be reachable by pinned source identity,
and tree-shaking must not remove it. The halves that survive: workers still
receive only Action implementations, what ships is still compiler-emitted code
rather than an opaque author blob, and the refusal of a **live function side
table** survives verbatim and is strengthened.

**Amended — the appended-plan rule:**

> "A plan instance is append-only. Dynamic loop/fan-out instantiation may append
> nodes, but it never rewrites an executed prefix."

The journal is append-only and replay never rewrites a committed prefix. The
property survives; the thing it is a property of changed.

**Amended — pinning:**

> "In-flight executions are pinned to a Plan IR digest, provider manifest, and
> schemas."

Now pinned to a **Flow source identity**, and a mismatch **abandons** the
execution rather than being resolved by a static compatibility answer **(PR-3)**.
The static plan-digest comparison this sentence implied is the capability
recorded as cost 1.

**Amended — signing:**

> "The signature must cover the canonical Plan and complete manifest, including
> coordinator, worker-artifact, implementation, policy, schema, and grant
> digests."

The signed artifact is now `{flowSourceDigest, effectManifest,
journalSchemaVersion, routingManifest}`. Every sentence about what a signature
does *not* establish — freshness, signer honesty, sandbox attestation,
revocation — survives verbatim. What it attests to is narrower, and §What this
model gives up says so plainly.

**Amended — the invocation envelope.** `nodeId` became `siteId, occurrence`
**(PR-2)**. That is what lets a divergence report name a source location.

**Amended — the reuse-from-`flows` list.** Three "replace library limitations"
claims inverted; they are tabulated in §What Smithers should reuse from `flows`
rather than deleted. `Node<A, E, R>` is removed as a user-visible algebra:
[Effects](/specification/effects) §What This Page Does Not Add is normative that
`.sm` has no `Effect<A, E, R>` value, no `Result.gen` do-notation, and no `.run()`
step. The `(A, E, R)` triple survives as the compiler-inferred effect row.

**Amended — the stable-ID proposal.** Its safety motivation — "renaming a symbol
must not silently change the identity of an in-flight durable operation" — is
satisfied by fail-closed pinning, which makes the change loud rather than silent.
Its convenience motivation is not satisfied and is now part of the open
versioning question.

**Withdrawn — the multi-target worker vocabulary** ("target and ABI:
TypeScript/JS, native, or Wasm"; "optional target variants of a pool"; a wire
encoding "identical across TypeScript, native, and Wasm"; "or target support" in
the deployment-closure error list). These predate the pivot: they rest on the
near-native/LLVM and Wasm compilation targets withdrawn on 2026-08-23. Recorded
as finding 2 above rather than replaced, because no current page states what a
non-JavaScript worker pool would be.
