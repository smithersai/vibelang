# Coding-agent library

Three boundaries live here: the sandbox RPC contract, the durable turn journal,
and the model adapter. Only the first two are backed by real implementations —
the model is still a scripted fake, and the sandbox is process-level.

## Coding-agent RPC boundary

Agent functions have three deliberately distinct wire modes: a compiler-derived
Action contract, a compiler-derived Flow contract, and legacy JSON-only
interop. A binding carries at most one contract, and which one it carries is
visible in its identity, its callable declaration, and every journal row.

`defineActionFunction(descriptor, invoke)` is the checked path. `descriptor`
must be the exact, untampered `ActionDescriptor` returned by the durable
contract compiler. The binding snapshots and revalidates the complete
descriptor, derives the TypeScript callable signature from its structural
input/success schemas, and includes the contract plus schema digests in the
binding identity, callable surface, function-table identity, and call journal.
The Deno host validates input before invoking the callback and validates output
before replying. A mismatch is returned as a structured
`AgentRpcContractError`; invalid input never invokes host code and invalid
output never crosses into generated code.

`defineFlowFunction(flowContract, invoke)` is the same checked path for a
durable Flow: the contract is projected from a validated Plan artifact by
`flowContractFromPlan`, revalidated against its own digest, and the signature is
derived from the Plan's structural Flow input/success schemas.

`defineFunction(signature, invoke)` remains the compatibility path for existing
callers. Without `actionContract`, it enforces strict bounded JSON transport but
does not know the declared TypeScript shape at runtime. Its identity and
callable declaration are labeled `legacy-json-only` so it cannot be mistaken
for a compiler-checked boundary. `defineFunction` can also accept a validated
descriptor through `options.actionContract`, though `defineActionFunction` is
preferred because it avoids separately maintaining the signature string.

## Tool to Action adapter

`tools.ts` is the `tool or MCP operation -> typed Action -> generated-code
function` step. `compileActionTool({ source, exportName, id, version }, call)`
compiles a tool's Action contract with the durable contract compiler and binds
it in one step; `actionTool(descriptor, call)` binds an already-compiled
descriptor; `actionToolTable(tools)` assembles a validated function table.
Contract compilation failure throws `ActionToolContractError` with the
compiler diagnostics rather than binding an unchecked tool.

`callableSurfaceManifest(functions)` produces the per-turn durable manifest
(exposed name, kind, Action id/version or Flow id/version plus Plan digest,
contract digest, durability) that the journal records with `turn.started` and
`sandbox.started`.

Durable execution semantics attach to Action- and Flow-backed bindings only,
matching `docs/AGENT_LIBRARY.md`: an ordinary `defineFunction` closure is
journaled as an observation but is never replayed from a recording.

## Compiled Flows as agent functions

`flowTool(target, options)` exposes a compiled durable Flow as an ordinary
member of the callable surface. `target` is the Plan plus its executor wiring:
a `DurableExecutor` satisfies it directly (`deployment.flow.plan` and
`execute`), and `{ plan, execute }` covers callers that own their own wiring.

- the generated-code signature and the RPC codec come from the Plan's
  compiler-derived Flow input/success schemas — the same schemas the executor
  validates against — so invalid input is rejected at the sandbox boundary
  before any durable execution is started or joined;
- the binding identity is `flow/<id>@<version>` with the Plan digest in its
  configuration, and `flowContractFromPlan` revalidates the Plan artifact
  before projecting the contract; and
- a call starts *or joins* one durable execution and awaits its terminal
  outcome: the success value crosses back through the schema-checked path, and
  a typed Flow failure, defect, or cancellation crosses the sandbox's
  structured error channel.

### Derived execution id and join semantics

`flowExecutionId({ turnId, sourceDigest, functionName, ordinal, flowId,
flowVersion, planDigest, inputDigest })` is the whole mechanism. The execution
id is derived, never chosen, so:

- replaying a turn recomputes the same id, and `DurableStore.initializeExecution`
  is idempotent for it: the call **joins** the execution a crashed attempt
  started, and Actions that already committed do not run again;
- a different input, or a redeployed Plan, is a different execution rather than
  a mutation of the pinned one; and
- before starting work, the call commits its attachment through
  `TurnJournal.attachFlowCall`, so a replay of the same call site under a
  different input or Plan raises `TurnJournalDivergenceError` instead of
  quietly starting a second execution. A journal without that method (for
  example `MemoryTurnJournal`) still runs the Flow, but has no such protection.

A completed Flow call is an ordinary recorded host call: on replay its outcome
answers the call and the executor is never touched. An interruption is not an
outcome — anything that escapes the executor without a terminal commit becomes
`DurableFlowInterrupted`, which the sandbox refuses to record, so the restarted
turn re-attaches to the same execution id.

## Durable turn journal

`SqliteTurnJournal` (`journal.ts`) is a real `bun:sqlite` database — its own
file, independent of the durable executor's store. One transaction per
committed boundary (`BEGIN IMMEDIATE`), `synchronous = FULL`, and every row
carries a digest that is re-verified on read; a mismatch throws
`TurnJournalIntegrityError` and the turn fails closed rather than being served
a tampered recording.

Tables:

| table | key | holds |
| --- | --- | --- |
| `agent_journal_meta` | `key` | journal schema version |
| `agent_turn_events` | `sequence` | the turn event vocabulary, plus `previous_digest`/`event_digest` forming an append-order hash chain |
| `agent_turn_artifacts` | `digest` | content-addressed generated source and compiled JavaScript |
| `agent_model_calls` | `(turn_id, attempt)` | request digest, model identity/version, recorded response |
| `agent_host_calls` | `(turn_id, source_digest, function_name, ordinal)` | binding identity, RPC contract identity, input digest, and the committed success/failure outcome |
| `agent_flow_calls` | `(turn_id, source_digest, function_name, ordinal)` | the durable execution a Flow call site is attached to, with its Flow identity, Plan digest, and input digest |

Recorded per turn: the model request digest and response, the accepted-source
artifact and its digest, the compiler diagnostics digest, the sandbox execution
outcome (duration, result digest, error, log count), and every host call with
its per-site ordinal identity.

Replay semantics:

- the model response for the same turn id, attempt, and request digest is
  reused instead of invoking the model;
- a completed Action call recorded under the same turn id, accepted-source
  digest, function name, and per-site ordinal is returned without re-invoking
  the host, and is revalidated against its contract before re-entering the
  sandbox;
- the first committed result for an identity stays canonical; a later differing
  result never overwrites it;
- a replay whose request, input, binding identity, or contract differs from the
  recording raises `TurnJournalDivergenceError` instead of answering;
- a Flow call site attached to a durable execution re-derives and re-joins that
  same execution after a crash, and fails closed on a divergent input or Plan;
- control-plane failures (timeout, cancellation, call/transport limits, channel
  teardown, and a durable execution that lost its coordinator) are never
  committed as replayable results, so a restarted turn is free to call the
  function again; and
- a host result is committed before the generated program can observe it, so a
  crash between the effect and its record cannot repeat the side effect.

`MemoryTurnJournal` remains the observation-only fake: it records events and
artifacts but implements none of the recall/record pairs, which is exactly how
a non-durable composition behaves.

Per-site call identity is keyed by function name plus ordinal because no
call-site information crosses the sandbox RPC boundary. That is the POC's
answer to open library decision 5 in `docs/AGENT_LIBRARY.md`, not a claim that
data-dependent loops have stable identities in general.

## Model adapter

`ModelAdapter` is the whole model boundary: a `ComponentIdentity` pinning the
adapter artifact and configuration, a `ModelDescriptor` (provider, name,
version) that flows into the turn provenance and every journal row, one
`generate(request)` method, and an optional `extractSource` hook for
provider-specific extraction of the TypeScript module from a reply. The turn id
folds in both the identity and the version, so a model upgrade is a new turn
rather than a replay of the old one.

`ScriptedModel` implements that interface over a fixed list of replies.
`PoisonModel` impersonates another adapter's identity and version but fails if
it is invoked at all; with `poisonFunctionTable` it is how the tests prove a
restarted turn completed entirely from the journal.

## Current bounded scope

- the model is still scripted; no adapter here performs a network call, and the
  interface exists so that a real client is a drop-in;
- the sandbox is process-level (a no-permission Deno subprocess), not a VM or
  container boundary;
- attachment is explicit; the Smithers compiler does not yet wire Action
  descriptors into agent bindings automatically;
- descriptors are canonical and digest-checked, not signed or branded runtime
  objects; provenance depends on the trusted compiler/build pipeline supplying
  the descriptor rather than accepting attacker-authored descriptors;
- the helper derives the generated-code surface, but a runtime descriptor
  cannot reconstruct a TypeScript type parameter for the host callback; callback
  mistakes therefore fail at the runtime codec unless the caller also supplies
  a matching host-side type annotation;
- the Action input and success schemas govern RPC values; the error schema is
  pinned in contract identity but ordinary thrown host exceptions still use the
  sandbox's structured defect channel rather than typed `Result` failures;
- supported values are exactly the durable structural-codec subset (canonical
  JSON scalars, arrays, tuples, exact optional objects, bounded unions, and the
  compiler's nominal Error envelope where a schema permits it);
- generated JavaScript is byte-bounded before base64 allocation, and every
  host-side JSON snapshot has independent 128-level/100,000-node traversal
  bounds before transport serialization;
- the real Deno executable and runner are canonical-path, content-digest pinned.
  Their device/inode/size/mtime/ctime fingerprint is rechecked before every
  launch and changed artifacts are rehashed and rejected;
- cancellation, call limits, transport limits, and sandbox process confinement
  remain independent of schema validation and of replay;
- a passed Flow runs on in-process workers through a locally built deployment;
  remote workers, deployment signature verification at the agent seam, and
  cross-process coordinator handoff are not exercised here;
- the turn journal and the durable store remain two databases: the attachment
  row links a call site to an execution id, but a turn and its Flow executions
  are not committed in one transaction, so a crash between the attachment
  commit and `initializeExecution` leaves an attachment whose execution does
  not exist yet — the next replay simply starts it under the same id;
- a Flow's typed failure crosses the sandbox as a structured error, not as a
  typed `Result` value, exactly as an Action's thrown failure does;
- Flow call sites inherit the per-site ordinal caveat: the execution id is
  keyed by function name plus ordinal, which is stable for straight-line
  generated code, not for data-dependent loops; and
- journal rows are digest-verified, not signed or redacted; the redaction
  policy `docs/AGENT_LIBRARY.md` requires for secrets is not implemented, so a
  call input is stored verbatim in `agent_turn_events`.
