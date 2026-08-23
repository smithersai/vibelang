# W6-D documentation conformance report

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Files changed

- `docs/src/pages/guide/control-flow.mdx` — replaces the stale bounded warning with the root frontend's general expression placement, labeled block/loop values, closed-union exhaustiveness, diagnostics, and remaining unlabeled-loop boundary.
- `docs/src/pages/reference/standard-library.mdx` — distinguishes design from the source-checkout platform/data POCs and root-exported concurrency POC, inventories implemented surfaces, and preserves absent production/host/compiler pieces.
- `docs/src/pages/guide/concurrency.mdx` — documents exact typed-worker, keyed combinator, Governor, unordered-helper, Cancellation, Stream, Queue, Semaphore, and Channel POC APIs while keeping `spawn module` and shared structs at design stage.
- `docs/src/pages/guide/comptime.mdx` — updates the root project frontend warning for bounded loops/mutation/stdlib evaluation, VCT1012 budgets, value-derived type production, type-only erasure, VCT1013, and honest unsupported syntax.
- `docs/src/pages/reference/comptime.mdx` — records the exact interpreter budgets and type-producing binding behavior and annotates the provisional source-level loader registration evidence.
- `docs/src/pages/guide/asset-imports.mdx` — separates root static-asset integration from programmatic re-export/dynamic/nested-graph support and documents source registration plus provisional Markdown/MDX shapes.
- `docs/ASSET_LOADERS.md` — adds non-normative evidence for widened programmatic graphs, checker-identified sandboxed registration, built-in precedence/duplicate diagnostics, and provisional Markdown/MDX contracts while narrowing the open questions.
- `docs/DURABLE_EXECUTION.md` — adds start/resume execution handles, local-trust HMAC sender tokens, explicit unsafe tokenless delivery, and notifier-plus-sweep wakeup evidence and narrows remaining open runtime work.
- `docs/src/pages/guide/durable-execution.mdx` — documents the provisional Bun execution-handle API, authenticated local signal seam, wakeup correctness guarantee, and remote authorization/transport limitations.
- `docs/src/pages/guide/agent-library.mdx` — adds compiled-Flow call/join behavior and the example-only Anthropic adapter while preserving separate-journal, local-worker, sandbox, and publication limits.
- `docs/AGENT_LIBRARY.md` — annotates the proposed design with current `flowTool` execution-id/join evidence and the unpublished Anthropic `ModelAdapter` example.
- `docs/COMPATIBILITY_API.md` — refreshes package-subpath descriptions and removes stale control-flow, comptime, and programmatic asset-graph limitations.
- `poc/README.md` — updates the implementation/boundary table for expression control flow, standard-library POCs, comptime/type production/assets, source loaders, durable handles/signals/wakeups, Flow-backed agent calls, and the Anthropic example.
- `poc/W6D-REPORT.md` — records this documentation lane's scope, deliberate non-updates, and verification.

## Claims deliberately not updated

- Specification MUST/MAY requirements and open questions were left normative. In particular, `docs/src/pages/specification/durable-execution.mdx` still treats final handle/transport syntax as open because the implemented Bun spellings are explicitly provisional; current evidence is documented in the design draft and guide instead.
- Re-exported, literal-dynamic, and depth-four nested asset graphs were not claimed as root CLI execution support. `poc/src/build/README.md` says the programmatic source-asset seam issues them, but the Smithers emitter, semantic re-export binding, and root relative runtime graph have not caught up.
- Platform and data POCs were not described as root package APIs because `package.json` has no `smthrs/platform` or `smthrs/data` export. Concurrency alone is exported through `smthrs/concurrency`.
- `Sleeper` was not claimed as part of `NodePlatform` or `TestPlatform`; it has live/test implementations, but `poc/src/platform/layers.ts` does not bundle it.
- The Anthropic adapter was not described as the package default or a published export. It lives under `poc/examples/agent`, examples are excluded from POC emit, and `@anthropic-ai/sdk` remains a POC dev dependency.
- `spawn module {}`, shared structs, compiler-derived worker codecs/contracts, unlabeled loop expressions, arbitrary computed/mapped/generic comptime types, remote signal authorization/transport, queues/broadcast, and durable migration remain explicitly unimplemented or open.
- `docs/src/pages/guide/runtime-validation.mdx` was left unchanged: the checker-derived schema path exists programmatically, but root CLI schema-runtime import/package wiring remains incomplete.

## Verification

- `npm --prefix docs run build` — exit 0; Vocs completed static generation and internal-link validation.
- `git diff --check -- docs poc/README.md poc/W6D-REPORT.md` — clean.

SOURCE SETTLED
