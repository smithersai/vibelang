# Smithers production-architecture POC

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

This directory is the executable architecture POC for the current Smithers
design. It is intentionally narrower than a production compiler, but its
frontend, runtime, build graph, durable journal, process sandboxes, and CLI
integration are active implementation evidence rather than archived syntax
experiments.

> **Source-checkout note:** npm includes this nested README alongside the
> compiled POC modules, but it does not ship the POC tests, examples, or private
> workspace. The commands below are maintainer checks for a repository checkout;
> installed consumers should use the root package exports and `smithers` CLI.

The goal is to exercise the boundaries that are expensive to redesign later.
Unsupported whole-program, control-flow, deployment, and security properties
remain explicit limitations; this POC should not be presented as a production
release or a sound TypeScript replacement.

## Verify it

From this directory:

```sh
bun install
bun test
bun run check
bun run demo
```

The complete suite and demo need `deno`, `zig`, `rustc`, and `node` on `PATH`.
Deno is used for the loader/comptime and coding-agent process boundaries; Zig
and Rust are invoked for the real Wasm build proof. The language runtime demo is
transpiled by Bun but executed under Node, because its async `Layer.provide`
scope needs exact Promise-settlement hooks that Bun does not provide — running
it directly under Bun demonstrates the documented fail-closed rejection instead.
Verification is command-based rather than tied to a test count, because the
suite is still growing.

The root package integrates the same implementation:

```sh
cd ..
npm install
npm test
node bin/smithers.js check test/fixtures/basic.sm --format json
node bin/smithers.js run test/fixtures/basic.sm
```

The root CLI supports `.sm` check, project compile, run, inspect, bounded test,
static durable Plan, and doctor paths and delegates ordinary TypeScript/
JavaScript inputs to TypeScript. Declaration and composed source-map output are
implemented. Watch, formatter, and language-server paths fail explicitly.

## Implemented surfaces and honest boundaries

| Surface | Working evidence | Deliberate boundary |
| --- | --- | --- |
| Checked `.sm` frontend | One TypeScript Program for an explicit `.sm` graph; cross-module fixed-point Error and Context rows including generic success values with concrete rows; `Result`/`Optional` lifting; `.unwrap()` early-return lowering; nominal Error matching; braced `if`/`switch` expressions in proven general placements; labeled block values; labeled loop values with `else`; closed-literal-union switch exhaustiveness; known Layer satisfaction; must-consume checks; foreign panic policy; project TypeScript validation; declarations and composed maps | No type-parameter-dependent row polymorphism, stable Context-row declaration encoding, LSP/incremental integration, or unlabeled loop expressions; order-unpreservable hosts, unstable callees, braceless general-placement branches, unsafe label/loop shapes, and unprovable switch coverage fail closed |
| JavaScript/TypeScript interop | Checker-resolved foreign values add checked panic unless trusted `@throws {never}` or checked `@throws {ErrorClass}` metadata narrows the boundary; unsafe constructors and unprovable shapes fail closed | Complete arbitrary-heap provenance and whole-ecosystem declaration annotation remain production compiler/data-flow work |
| Runtime and Layers | Non-forgeable local `Result`/`Optional` identity, strict Result/Optional/Error wire codecs, checked Panic adapters, nominal Error registration, async-safe Context lookup, opaque lean Layers with exact Node Promise-settlement revocation, and bounded cancellation/join helpers | Layers intentionally own neither resources nor child tasks; async scopes reject pre-existing Promises unless adapted with `async () => await promise`, and fail closed on hosts without synchronous settlement hooks |
| Programmatic standard-library POCs | `poc/src/platform` implements all nine designed Node/test capability services, pure `Path`, plus `Config`, `Duration`, `Instant`, and `Schedule`/`Sleeper`, and ships as root `smthrs/platform`; `poc/src/data` implements `Chunk`, `HashMap`, `HashSet`, `Data`, `Equivalence`, `Hash`, and `Match`, and ships as root `smthrs/data`; root `smthrs/concurrency` exposes typed workers, keyed combinators, governors, unordered helpers, Cancellation, Stream, Queue, Semaphore, and Channel | Non-Node/test hosts, a final standard-library contract, compiler-derived data instances, shared structs, `spawn module` syntax/lowering, rendezvous channels, and production worker sandboxing remain absent |
| Comptime and assets | Checker-identity bounded evaluation without author-module execution; locals, assignment, `while`/`do-while`/`for`/`for-of`, break/continue, interpreter-owned mutation, deterministic stdlib operations, VCT1012 budgets, `comptime.target`, tracked `embed`, and value-derived type aliases with type-only erasure/VCT1013; root static attributed assets plus programmatic re-exports, literal dynamic imports, and nested generated-module graphs to depth four; literal JSON/Markdown/MDX modules, schemas, custom loaders, cache/provenance, and file-identity authority | Not general JavaScript or implicit evaluation; spread/destructuring, labeled comptime control flow, closures as values, ambient state, and computed/mapped/generic type results fail closed. Widened re-export/dynamic/nested asset graphs are not yet end-to-end root CLI lowering; one incremental graph and shared compiler-owned type descriptors remain open |
| Third-party build code | Custom registration rejects structurally forged callbacks by default; it accepts `createSandboxedLoader` modules and provisionally recognizes checker-identified project files whose default export is `comptime.loader("type", fn)`. Custom loaders/comptime modules run in fresh Deno processes with no ambient permissions, snapshotted source identity, tracked dependency RPC, strict JSON, time/random denial, timeout, V8 heap, input/output, request, and concurrency limits; built-ins win and duplicate project registrations fail closed | Compiler-owned built-ins run in process, and an explicitly unsafe internal test/migration option remains. Source registration is limited to one lowercase type per real project file; package distribution, globs/extensions, options, and a final typed-module builder remain open. The process boundary is not container/VM isolation, OS-wide resource accounting, or a formal sandbox proof |
| Targets and foreign source | Checker-symbol portability classification with cross-module propagation; canonical checked single-module IR with matching TypeScript-host/Wasm wire hashes for plain, Optional, and Result exits over `f64`/boolean scalars, intra-module calls, locals and assignment, `if`/`while`/`for` under a fixed loop-fuel budget with a canonical `fuel-exhausted` defect, scalar error payloads, and interned printable-ASCII string literals; real bounded `wat2wasm` plus Zig/Rust-to-Wasm invocation; tool identities, deadlines, output limits, and digests | The portable backend is single-module and rejects imports, recursion, call chains deeper than 32, Context, objects, closures, generics, async, string parameters, string concatenation, and non-ASCII strings; external compilers remain trusted; classification is not complete data-flow analysis; no LLVM/native or general Wasm backend is present |
| Durable execution | Static checker-identity lowering of a bounded `durable(function)` subset without executing source; conditional, timer, schema-checked external-signal, stable-key fan-out with bounded multi-step bodies, explicit `sequential(...)`, attached child Flow, and budgeted `loopWhile(...)` round nodes; minimal-version Plan format emission; compiler-derived structural Action/Flow codecs and exact implementation failure rows; portable Plan IR; canonical artifacts; Ed25519-signed local coordinator admission; provider/deployment routing; SQLite WAL journal; provisional start/resume/status/result/cancel/signal handles; local-trust HMAC sender tokens with explicit unsafe tokenless opt-in; post-COMMIT wakeups plus a correctness-preserving sweep; restart, retries, deadlines, leases, fencing, cancellation, memo/content reuse, corruption checks, and coordinator races | General unbudgeted loops, nested fan-out, queues/broadcast, detached children, signals addressable inside a child Plan, separately signed child manifests, recurring/calendar timers, tree-shaken bundle attestation, remote transport/authorization and workers, migration policy, revocation/anti-rollback, and distributed coordination remain open |
| Durable artifact boundary | `compileDurableSource` and `smithers plan` emit canonical Plan bytes; artifact loading reconstructs a compiled Flow without loading the author callback or an Action implementation | Action descriptors are supplied through a temporary pinned binding seam rather than derived from the unified language type descriptor |
| Deployment authority | Provider policy and deployment manifests pin capability grants; a canonical Ed25519 envelope authenticates the exact manifest under out-of-band trust roots; an opaque proof gates worker construction; non-local signed sandboxes require an exact host-issued transport token; and the local worker rejects invocation grants that differ from route/provider policy | The signature authenticates pinned metadata, not callback closures or emitted bundle bytes; the transport token prevents silent kind downgrade but still trusts its host factory; grants are not installed into a remote/container capability system, and freshness, revocation, anti-rollback, remote transport, and sandbox attestation remain open |
| Coding agent | Asset-backed MDX prompt, scripted default model/repair loop, generated callable declarations, TypeScript checks, fresh no-permission Deno execution, strict bounded JSON RPC, compiler-derived bounded structural schemas, resource/call/backpressure/cancellation limits, a typed `ModelAdapter` seam, tool-to-Action adapters, compiled-Flow bindings whose derived execution ids join the same execution on replay, and a real SQLite turn journal whose digest-chained rows replay completed calls without invoking the model or host; a real Anthropic adapter exists as an example only | The published package still defaults to `ScriptedModel`; the Anthropic example and SDK are excluded from its dependency closure. Agent and durable journals are separate databases rather than one atomic history; Flow execution is local/in-process and per-site ordinal identity is not stable for data-dependent loops; rows are neither signed nor redacted; schema coverage/evolution and process isolation remain bounded |
| Package delivery | Root exports include language/runtime/build/target/agent/concurrency and Node-safe/static plus Bun durable surfaces; clean consumers exercise CLI, public types, and runtime APIs; pack verification compares independent tarballs and contents | Publishing/signing and multi-platform release CI remain external operations |

## Current language frontend

`src/language` is the current compiler-shaped frontend POC. Its tests encode
the accepted TypeScript-shaped syntax and intentional Smithers divergences.
They are not obsolete tests and should remain part of the release gate.

The frontend proves the semantics most likely to affect parser/checker/IR
architecture:

- expected failures use `Result<A, E>` and ordinary `Error` subclasses;
- absence uses `Optional<T>` without optional-specific grammar;
- `.unwrap()` is a checked early exit, not JavaScript exception handling;
- `Context.context()` contributes a nominal requirement and known Layers
  satisfy requirements without owning resources or work;
- plain JavaScript `try/catch` retains JavaScript behavior;
- every direct untrusted JavaScript/TypeScript boundary can panic, with
  `@throws` metadata as the explicit trust/narrowing mechanism; and
- retired custom error/optional/catch syntax and unsupported control-flow
  lowering receive diagnostics instead of approximate code generation.

See the repository's [checked-frontend notes](https://github.com/smithersai/smithers/blob/main/poc/src/language/README.md) for its public API,
lowering details, and exact bounded-project limitations.

## Durable planning: two paths that must not be confused

The POC still contains `Flow.define(...)`, a convenient host callback/proxy DSL
used to exercise symbolic Plan IR and the local executor. That callback is not
the accepted language design and is not hermetic compiler lowering.

Separately, the canonical static Plan artifact path is real. The source compiler
recognizes imported `durable` and Actions by checker identity, lowers a bounded
function with conditional, timer, keyed fan-out (single-Action or bounded
multi-step), explicit sequencing, attached child Flow, and budgeted loop-round
primitives without module evaluation, and emits the same validated
artifact consumed by deployment execution. `smithers plan` exposes that path. The
remaining compiler work is broader control-flow lowering, type-derived Action
contracts, and integration into the common frontend/build graph.

## Security interpretation

The Deno boundaries are meaningful adversarial POC evidence: they use fresh
processes, deny ambient filesystem/network/environment/process/import
permissions, constrain V8 heap and wall-clock execution, bound protocol volume
and concurrency, and validate strict JSON messages. They also close or abort
in-flight host work on cancellation and protocol failure.

They are not a claim of hostile multi-tenant production confinement. V8 heap
limits are not total process-memory limits, wall-clock termination is not an OS
CPU quota, source filtering is not a proof, and there is no container/VM image,
seccomp profile, remote capability enforcement, or attestation. The signed
local deployment envelope authenticates the manifest's pinned digests; it does
not turn the named implementation into an attested bundle.

## Remaining highest-risk work

1. Replace the TypeScript-JS frontend instrument with narrow hooks in the pinned
   Go TypeScript fork, retaining project/module rows while adding checked
   control-flow IR, stable row declarations, incremental builds, and editor support.
2. Integrate compiler-owned comptime/type descriptors with the content-addressed
   asset, schema, foreign, target, and generated-code rules already exercised.
3. Expand bounded durable source lowering from its conditional, timer, signal,
   keyed fan-out, sequencing, child-Flow, and budgeted-loop primitives to
   general unbudgeted loops, nested fan-out, queues, detached children, and
   migrations; retire the live host callback path in favor of
   compiler-emitted worker artifacts.
4. Bind signed manifests to emitted tree-shaken worker bundles, add protected
   key custody/revocation/anti-rollback, real remote workers, authenticated
   capability installation, and multi-machine recovery tests.
5. Replace sandbox source-policy heuristics and V8-only bounds with audited
   container/VM confinement and OS-enforced resource controls where the threat
   model requires hostile-code isolation.

See the repository's [architecture findings](https://github.com/smithersai/smithers/blob/main/poc/FINDINGS.md)
and [production-readiness audit](https://github.com/smithersai/smithers/blob/main/poc/PRODUCTION_READINESS.md)
for the roadmap and evidence-based release checklist.
