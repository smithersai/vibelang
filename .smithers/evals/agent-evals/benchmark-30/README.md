# Agent Evals — 30-Task Public AI Agent Reliability Benchmark (`benchmark-30/v1`)

A public, deterministic 30-task benchmark suite covering the core reliability failure modes coding agents hit when writing Effect 4 programs in VibeLang (`.vibe`) versus Effect TypeScript (`.ts`). It sits alongside the existing 4-task regression suite (`../agent-evals.eval.ts` / `../agent-evals.baseline.json`) without modifying that baseline.

## Categories (6 × 5 = 30 tasks)

| # | Category | Directory Module | Tasks | Failure modes tested |
| --- | --- | --- | --- | --- |
| 1 | Typed Errors & Recovery | `categories/01-typed-errors.mjs` | 5 | Tagged fallbacks, selective `match` recovery without swallowing, transient-only retries, boundary error enrichment, structured `Exit` inspection |
| 2 | Services & Layers | `categories/02-services-layers.mjs` | 5 | `service` DI lookup, dependent `Layer.effect` composition, lexically scoped `provide`, `Context.Reference` `defaultValue`, deterministic test-layer swapping |
| 3 | Structured Concurrency | `categories/03-structured-concurrency.mjs` | 5 | `try.all` fan-out, `try.race` loser interruption, `try.allSettled` partial failure isolation, bounded `for concurrent(2)`, `fork`/`join` + `Deferred` |
| 4 | Resource Safety & Streams | `categories/04-resources-streams.mjs` | 5 | `scoped` + `acquireRelease` on success/failure, LIFO nested finalizers, `uninterruptible`/`restore`, `effect function*` + `for try` (`continue`/`break`), `ensuring` |
| 5 | Platform & Boundary Soundness | `categories/05-platform-boundaries.mjs` | 5 | `Effect.try` around throwing `JSON.parse`, `module` + `@throws` VIP-40 boundaries, `Config`/`ConfigProvider` vs ambient `process.env`, injectable `Clock`, `tryPromise` |
| 6 | Effect UI Components | `categories/06-effect-ui.mjs` | 5 | `schema` Models + `data` Messages, Command state transitions, exhaustive `match` view rendering, service-injected UI Commands, deterministic Story replay |

Each task ships three verified artifacts:
1. **Vibe reference (`vibe`)**: idiomatic `.vibe` implementation compiled with the checkout's native `vibelang` compiler.
2. **Effect TypeScript reference (`effectTs`)**: equivalent strict Effect 4 `.ts` implementation compiled with `tsc --strict`.
3. **Fault-injection control (`fault`)**: a realistic LLM mistake (18 compile-time diagnostic controls covering `EK0401`, `EK0403`, `EK0501`, `EK0909`, `EK2121`, `EK2128`, `EK3002`, `EK3003`, `EK4402`, exhaustiveness, `await`-in-`effect`, `try/finally`, `restore` placement; plus 12 runtime behavioral failure controls) proving the harness rejects broken solutions.

## Reproduce (offline, deterministic)

Build the native compiler and runtime first, then run the verifier or Bun test suite:

```sh
sh scripts/build-vibelang.sh
(cd packages/runtime && bun install --frozen-lockfile && bun run build)

# Run all 30 tasks (90 checks: 30 Vibe + 30 Effect TS + 30 fault controls)
node .smithers/evals/agent-evals/benchmark-30/verify.mjs

# Filter by category or task, or emit machine-readable JSON
node .smithers/evals/agent-evals/benchmark-30/verify.mjs --category=effect-ui
node .smithers/evals/agent-evals/benchmark-30/verify.mjs --task=err-02-selective-match --json

# Run manifest & offline verification tests
bun test ./.smithers/evals/agent-evals/benchmark-30/benchmark-30.test.ts
```

The benchmark is also wired as a standalone `@smthrs/evals` suite at `.smithers/evals/agent-evals-benchmark-30.eval.ts` (`name: "agent-evals-benchmark-30"`, 90 cases).

## Verified Offline Reference Baseline

Pinned environment & inputs measured on `linux/x64`:
- **VibeLang compiler**: `0.0.14 (TypeScript 7.1.0-dev)` (built from checkout)
- **Effect**: `effect@4.1.1` (`packages/runtime/node_modules`)
- **TypeScript**: `typescript@5.9.3` (`strict: true`, `module: NodeNext`)
- **Tokenizer**: `js-tiktoken@1.0.21`, encoding `o200k_base` (counted across exact complete `.vibe` and `.ts` reference sources, including imports, whitespace, and trailing newline)
- **Unit**: pass/fail count per check (`90` total checks) and `o200k_base` tokens

Observed offline verification output:
- **Vibe references**: `30 / 30` compile cleanly and match `expectedOutput`
- **Effect TS references**: `30 / 30` compile under `tsc --strict` and match `expectedOutput`
- **Fault-injection controls**: `30 / 30` rejected (`18` compile-time diagnostics, `12` runtime mismatches/failures)
- **Reference token footprint (`o200k_base`)**: `4,688` tokens (Vibe) vs `6,183` tokens (Effect TS) — `24.2%` fewer tokens across the 30 paired reference solutions

## Limits

- Offline verification proves reference parity and fault-control sensitivity; it is **not** a live LLM pass-rate measurement. Any published model pass rate must come from live agent runs with pinned model IDs, prompts, seeds/trials, and archived transcripts per `MAINTAINERS.md`.
- Category 6 (`effect-ui`) models pure Elm/TEA component architecture (Schema models, tagged messages, Effect commands, exhaustive `match` views, and Story replay) offline without external DOM or `@effect/ui` network dependencies.
- `o200k_base` token counts reflect OpenAI's tokenizer; other model tokenizers produce different totals.
