# VibeLang architecture risk spike

This directory is the intentionally quick, disposable proof of concept for the
current repository specifications. It is broad enough to exercise the risky
boundaries; it is not a candidate production compiler or runtime.

## Run it

```sh
cd poc
bun install
bun test
bun run check
bun run demo
```

The individual demos live under `examples/` and can be run directly with Bun.
The agent sandbox additionally needs Deno; the Zig/Rust demo needs those
toolchains.

Final spike verification is `56` passing tests, the TypeScript 7 native
typecheck, the full eight-surface demo, and a negative CLI check that rejects a
missing `Logger` layer without emitting output.

## What the spike covers

| Surface | Working proof | Deliberate boundary |
| --- | --- | --- |
| Language + rows | Token-aware `.vibe` lowering, fixed-point failure/requirement inference, pinned rows, exhaustive recovery, and a plain-TypeScript identity gate | Same-file syntactic rows are illustrative; the real TypeScript resolver/checker must own call, scope, provider, and CFG facts |
| Failures + layers | Invariant failure/defect split, named `uses`, nominal layers, nested and overlapping async scopes | Layer acquisition/disposal, child joining/revocation, and compiler-threaded environments remain open |
| Optionals + control | Simple `?T`, `orelse`, `.?`, throw and simple if expressions | General blocks/switch/loops and defer forms are rejected until control-flow IR exists |
| Comptime + assets | JSON/Markdown/MDX/custom loaders keyed by immutable option snapshots, source, target, explicit loader-artifact digest, and tracked dependencies; real-path authority, strict JSON IR, generated-syntax checks, and cache-output digests | Custom loader callbacks are not hermetically sandboxed; module shapes and explicit artifact-digest plumbing are provisional |
| Type reification | TypeScript declaration AST to validator/schema IR with branded validation failures | Uses a TS 5.9 API alias because the TS 7 preview exposes no JavaScript compiler API |
| Targets + interop | Transitive `TypeScript` requirement/native-pin heuristics; real Zig and Rust to Wasm compilation, calls, tool identity, and common source-dependency invalidation | Native backend, sound symbol/data-flow classification, ABI metadata, and complete foreign dependency discovery are not built |
| Concurrency | Bounded task scope that retains/joins children, branded cancellation, typed-shaped joins, cancellation-safe completion-order iteration | Module-expression workers, cross-realm codecs, and capability-inferred cancellation are not built |
| Durable execution | Action contract descriptors, symbolic projections, portable Plan IR, provider/deployment manifests, SQLite journal, deadlines/retries/fencing/replay, and distinct memo/content reuse | The accepted `durable(...)` source intrinsic and static compiler lowering, real compiler-derived codecs, remote workers, capability enforcement, and signed/tree-shaken artifacts are not built |
| Coding agent | Asset-backed MDX prompts, fake model/repair loop, generated callable declarations, TS check/policy, fresh zero-permission Deno process, bounded JSON RPC, cancellation, and journal hooks | Signatures/codecs remain explicit, source policy is defense-in-depth rather than a security proof, and container-grade isolation is future work |

## Important honesty notes

- The official specs and historical `prototype/` were not rewritten for this
  spike. The old prototype still demonstrates obsolete unnamed `uses` and
  `provide {}` syntax; this POC follows the current named/layer design.
- TypeScript 7.0.2 in this workspace is the Go-native preview. Its npm package
  provides the compiler CLI but not the historical JavaScript compiler API.
  `typescript-js` 5.9 is scaffolding for the schema and agent experiments only.
- This is not a fork or plugin for the Go compiler. The token/AST transforms are
  disposable instruments for discovering where parser, resolver, checked IR,
  and control-flow hooks are mandatory; they are not evidence of conformance.
- The target classifier and provider-row checker intentionally prove diagnostic
  shape and dependency-path UX, not sound transitive closure.
- `Layer` proves overlapping async lookup scopes, not resource lifetime:
  acquisition, structured child ownership, revocation, and disposal are absent.
- Flow authoring still uses the obsolete `Flow.define(...)` POC API and executes
  its callback in the host process. The accepted design instead imports
  `durable` from `vibelang:flows` and statically lowers the passed function's
  checked body without invoking it. The POC proves only the symbolic IR/runtime
  boundary. Loader callbacks have a similar hermeticity limitation even though
  their declared inputs and real paths are now tracked.
- Durable `capabilityGrant` values are caller-selected protocol metadata in this
  POC; they are neither authenticated nor enforced by a real worker sandbox.
- The Deno agent process denies OS permissions and obvious realm escape syntax,
  but source filtering and a language runtime are not a production sandbox. It
  also lacks OS-enforced memory/CPU/output quotas and transport backpressure.
- Runtime implementation IDs, loader artifact digests, and temporary Action
  contract digests are explicitly supplied. Production must derive these from
  compiler output and actual signed artifact bytes.
- The foreign graph tracks common Zig/Rust source dependencies for the demo,
  not every include, package, build-script input, environment fact, or tool file.
- JSON is a temporary canonical persistence/wire format. The durable runtime's
  schema fields are marked as compiler-derived stubs rather than pretending
  runtime TypeScript generics can be reflected.

See [FINDINGS.md](FINDINGS.md) for the architecture conclusions and proposed
production roadmap.
