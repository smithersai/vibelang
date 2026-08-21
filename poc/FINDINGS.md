# Findings and production roadmap

## Outcome

The core product model hangs together: ordinary eager functions can keep typed
failure and requirement rows; the compiler can lower a statically resolvable
function passed to `durable(...)` into a durable plan without infecting normal
execution; and agent code can remain a library consumer of the same typed
callable boundaries.

The POC also found four places where a shortcut would create the wrong
architecture:

1. **The TypeScript 7 extension seam comes first.** The Go-native preview has no
   JavaScript compiler API, so a language-service plugin or JS transform cannot
   be the foundation. VibeLang needs narrow parser/checker/emitter/IR hooks in
   the upstream Go compiler.
2. **Rows and control flow belong in checked compiler IR.** Text lowering is
   adequate for syntax feel, but aliases, methods, higher-order functions,
   async cleanup, exhaustive switches, and expression loops require the real
   resolver and control-flow graph.
3. **Runtime type metadata must be emitted before erasure.** Schema derivation,
   Action codecs, RPC bindings, and generated-agent declarations all need one
   compiler-owned structural descriptor. Reconstructing it from JavaScript
   callbacks or generics is impossible.
4. **Symbolic Flow values need compiler lowering.** A Proxy can safely record
   property projections, but JavaScript cannot intercept `if (symbolic)` or
   operators. The POC's explicit `Expr.*` and `Flow.branch` are useful IR
   targets, not the desired source API.

## What is real and what is mocked

The spike deliberately uses real machinery where behavior, identity, or a
process boundary is the risk: SQLite transactions and restart, Deno process
isolation and JSON-lines RPC, TypeScript checking, Zig/Rust tool invocation,
Wasm instantiation, content keys, dependency invalidation, and overlapping
async layer scopes all execute for real.

The replaceable plumbing is fake: the model adapter is scripted, workers are
local processes/callbacks rather than a fleet, deployment artifacts are
manifests rather than signed bundles, schemas are temporary descriptors, and
the language frontend is a token/TypeScript-AST instrument rather than a Go
compiler fork. Those fakes expose the intended contracts without hiding the
parts that need production architecture.

Keep the negative evidence explicit when planning: row/provider conclusions
are syntactic rather than checker proofs; `Layer` has lookup scope but no
resource lifetime; Flow and loader callbacks can observe host ambient state;
implementation/contract digests and capability grants are declared metadata,
not measured or authenticated authority; foreign dependency discovery is
representative rather than complete; and the agent sandbox has no OS-enforced
memory/CPU/output budgets or transport backpressure.

## Adversarial results that changed the design

| Reproduced failure | POC response | Production implication |
| --- | --- | --- |
| Plain TypeScript was accidentally rewritten as Vibe syntax and scripts became modules | Added contextual scanning, conditional helpers, and identity regressions | Superset compatibility needs a renamed TypeScript corpus gate and upstream parser ownership |
| A shared asset cache reused dependency paths from another project; mutable options, exotic values, symlinks, `__proto__`, loader changes, and poisoned envelopes broke key/output equivalence | Snapshot options, require strict JSON IR, emit safe literals, resolve real paths, key loader artifacts, and verify output digests | One hermetic graph rule ABI must own identity, authority, normalization, and dependency discovery |
| Settled/unconsumed async work and early iterator exit could outlive their owner | Retain scope children; cancel and join unordered mapping on exit | Layer lifetime and cancellation must integrate with structured scopes, not only async context propagation |
| Durable retries lost deadline/backoff state; stale fenced attempts could race global reuse; mutable manifests changed behavior under a fixed digest | Persist timing state and make fencing, cache publication, and pinned immutable artifacts explicit invariants | Kill/restart and two-coordinator race suites are release gates, not optional unit tests |
| Generated code returned before host RPC finished, returned non-JSON values, and escaped deterministic globals through fresh realms | Reject unawaited calls, validate strict JSON, abort in-flight calls, deny obvious realm creation, and use a fresh zero-permission process | Compiler-emitted codecs plus an audited container/VM sandbox and bounded transport are required |
| Runtime failure payloads could overwrite their nominal discriminant | Reserve/freeze identity fields and recognize same-realm instances nominally | Cross-realm failures need an explicit checked codec; a forgeable global symbol is insufficient |

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
- `defer`/`errdefer`, block values, loop values, and typed catches must be
  represented in the compiler's control-flow graph before lowering.

### Comptime, schemas, and builds

- Content keys can cleanly include loader identity/artifact digest, immutable
  option snapshots, normalized source, target, and tracked dependencies. A
  persistent logical index avoids loader execution when all prior evidence and
  the cached-output digest still match.
- Loader code needs a hermetic execution boundary, stable typed output IR,
  deterministic resource limits, and compiler-owned dependency APIs. Merely
  asking a normal JavaScript callback not to use ambient state is insufficient.
- Structural validator derivation is mechanically feasible. Recursive types,
  refinements, nominal facts, functions, `any`, and custom durable encodings
  need an explicit reification policy.
- Actual Zig/Rust-to-Wasm compilation works as graph work. Production bindings
  must come from compiler/ABI metadata and include every imported foreign file;
  source regex is intentionally not retained.

### Durable execution

- Keep four phases as separate artifact contracts: template compilation,
  deployment build, plan/preview, and execution. Template compilation lowers
  checked syntax and control flow without invoking the source function;
  plan/preview loads only emitted Plan IR and runs no Action implementation.
- The POC's `Flow.define(...)` and host callback execution are disposable
  instrumentation, not the accepted authoring or planning mechanism.
- Keep four identities separate in storage and APIs: run-local node,
  downstream idempotency, nondeterministic memo generation, and deterministic
  content key.
- A cache or memo hit must first become a run-local terminal record before its
  value is returned. This makes replay independent of later cache eviction.
- Provider/policy digests and Plan/schema versions must be pinned per execution.
  Placement is a route/implementation decision, not part of the abstract Action.
- Leases and fencing protect journal commits from zombie workers. They do not
  make an external side effect exactly-once unless the destination participates.

### Coding agents

- The passed-function table is a clean authority-boundary shape. This POC wires
  local callbacks; Actions, Flows, tools, and MCP still need checked adapters.
- Type declarations are valuable diagnostics but not confinement. The POC's
  fresh Deno process with no permissions proves the process/RPC shape; production
  still needs audited sandbox images, memory/CPU/output enforcement, redaction,
  cancellation, and transport backpressure.
- Model responses are nondeterministic memo candidates, never deterministic
  content-cache entries. Generated source and compiler diagnostics are ordinary
  content-addressed artifacts.

## Proposed implementation sequence

### P0 — Upstream seam and identity lowering

- Track the `smithersai/TypeScript` fork at a pinned revision and vendor that
  snapshot into the VibeLang repository.
- Add `.vibe` identity parsing/emission, source maps, declarations, and language
  service support.
- Establish narrow hooks for syntax extensions, row metadata, checked IR,
  comptime rules, and generated modules.
- Gate: rename a representative `.ts` corpus to `.vibe` with identical TS-target
  behavior and diagnostics.

### P1 — Function rows, failures, and requirements

- Add declared errors, `E`/`R` row representation and fixed-point inference.
- Implement `try`, failure-only catch, exhaustive matching, async propagation,
  named `uses`, and provider satisfaction.
- Ship the TypeScript layer kernel and decide acquisition/disposal semantics.
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

- Implement the compiler-owned `vibelang:flows` binding and lower the checked
  body of statically resolvable functions passed to `durable(...)` into symbolic
  expression/Plan IR without invoking them.
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
- Emit signed coordinator/worker artifacts, schemas, RPC bindings, and routing
  manifests; implement remote workers with real sandbox/capability grants.
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
2. Layer acquisition, memoization, override, disposal, and lowering semantics.
3. `?T` conversions and type-assertion/native-cast rules.
4. Loader registration, typed module IR, Markdown/MDX shapes, and sandbox ABI.
5. Complete portable/TypeScript-required/forbidden feature table.
6. Stable Action/Flow IDs, loop/fan-out identity, explicit sequencing, wire
   encoding, artifact model, and in-flight migration.
7. Worker deployment syntax, manifest signing, capability grants, and sandbox
   attestation.
