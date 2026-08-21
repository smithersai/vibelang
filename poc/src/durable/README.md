# Durable execution risk spike

This directory is a deliberately small end-to-end implementation of the risky
parts of `docs/DURABLE_EXECUTION.md`. It is not the proposed production runtime.

Run the executable self-test from the repository root:

```sh
bun poc/examples/durable/demo.ts
```

The demo proves:

- an Action descriptor contains identity and a temporary contract digest but no
  implementation (its schema bodies remain explicit stubs);
- providers install ordinary callbacks and independently select recovery and
  reuse policy;
- the obsolete POC `Flow.define(...)` callback can record strict symbolic
  input/results and disappear into serializable Plan IR, validating the IR
  boundary but not the accepted compiler lowering;
- projection and argument passing produce data edges, independent Actions run
  concurrently, and explicit parallel, branch, and sequence topology works;
- deployment building rejects missing/ambiguous/incompatible providers and
  emits a coordinator digest, pool-specific artifact digests, and pinned routes;
- the same schema-versioned invocation crosses an in-process JSON worker
  boundary with manifest verification;
- SQLite commits node state and its journal event in one transaction, and a
  restart reuses that exit even when the coordinator died after commit but
  before exposing the value;
- attempts retry with persisted deadlines/backoff, leases, monotonically
  increasing fencing tokens, and cooperative provider abort signals;
- run-local node identity, downstream idempotency identity, nondeterministic
  memo identity, and deterministic content identity are separate;
- memo is atomic first-success-wins, while content reuse verifies input/output
  evidence and reports unequal output as an integrity defect;
- cache publication and run-local success commit share one fenced transaction,
  so a zombie attempt cannot poison later executions; and
- every memo/content hit is first adopted into the current execution journal.

The most important finding is visible in `authoring.ts`: a JavaScript proxy can
record projections and reject coercion, enumeration, and calls, but JavaScript
offers no trap for truthiness, strict equality, or its operators. Consequently
ordinary `if (symbolic)` cannot implement the language contract. `Expr.*` and
`Flow.branch` in this spike are explicit versions of the expression/branch IR
that the real VibeLang compiler must lower ordinary source syntax into.

The accepted source API imports `durable` from `vibelang:flows` and passes it an
inline or otherwise statically resolvable function. Production template
compilation lowers that function's checked syntax and control flow without
invoking it. Plan/preview then reads the emitted IR without the source function
or Action implementations present. Nothing in this POC implements that
compiler-owned surface.

Deliberate omissions are compiler-derived real schemas/codecs (the descriptor
marks a canonical-JSON stub), runtime-sized loop/fan-out templates, catch and
compensation topology, timers/signals/children, artifact CAS, real remote
transport, bundle generation/signatures, authenticated capability grants and
artifact-byte identities, sandbox enforcement, heartbeats from remote workers,
full cancellation, migration, and distributed consensus. Providers still run
as host callbacks, so abort is cooperative. Action call-site IDs are
deterministic ordinals only; production needs compiler-stable source identities
that tolerate unrelated edits.
