# VIP-72: `Experimental.Otlp`: logs, metrics and traces over OTLP, scrubbed and bounded

**Status:** accepted optimistically, 2026-11-09, under Will's pre-alpha standing approval (ruling 19:19 PST). Will has not reviewed this VIP's decisions.

## Will's words

> Ok so give me a list of smithers features. We need to figure out what the VIP should look like. Some of the features outside of durable execution likely should simply be in the standard library I'm guessing but we should enumerate all of them

## Summary

**One sentence.** Logging, metrics and tracing are Effect's and already in scope, Effect's own OTLP exporter already compiles in Vibe 0.0.13, and `Experimental.Otlp` adds the three things an agentic program needs on top: redaction, a bounded transport that counts what it drops, and a copy of each run's logs in its journal.

**One paragraph.** This is the smallest VIP in the set, and it says so. A Vibe program already writes `try logInfo(…)`, `try withSpan(effect { … }, "name")` and `Metric.counter(…)`, and `provide Otlp.layerJson({ baseUrl, resource })` already sends all three to a collector. Smithers' `@smthrs/observability` composes that same exporter "with the journal's redaction rules", so a credential in a log line never leaves the process, and bounds the transport so telemetry cannot grow without limit. It allocates no OpenTelemetry SDK and resolves no `node:` built-in, so it runs unchanged on Node, on Bun and in a browser. This VIP ports that composition. Telemetry describes a run; it is never the run's record, and losing it never fails a step.

```text
 try logInfo("triage started")        ─┐
 try withSpan(effect { … }, "triage")  ├─► Effect's Logger, Tracer, Metric ─► Experimental.Otlp.layer ─► scrub ─► batch ─► collector
 Metric.counter("issues_labeled")     ─┘                              │   over the size cap: drop, count, warn once a minute
                                                                      └─► Experimental.Logger.journal ─► the run's journal
```

## Decision

```ts
// proposed
export effect function triage() {
  provide Experimental.Otlp.layer({ url: "http://localhost:4318", service: "triage" }) {
    try withSpan(logInfo("triage started"), "triage")
  }
}
```

The same program compiles under `vibelang` 0.0.13 today with Effect's exporter, unscrubbed and unbounded:

```ts
export effect function triageToday() {
  provide Otlp.layerJson({ baseUrl: "http://localhost:4318", resource: { serviceName: "triage" } }) {
    try withSpan(logInfo("triage started"), "triage")
  }
}
```

### Module

Two additions, each named after the Effect module it extends, as [VIP-33](0033-platform-stdlib.md) rules. Both are in scope with no import, and their code is `vibelang-runtime/experimental/Otlp` and `…/Logger`. They port `@smthrs/observability`. `Logger`, `Tracer`, `Metric`, `Otlp`, `OtlpTracer`, `OtlpLogger`, `OtlpMetrics` and `PrometheusMetrics` stay Effect's.

| Call | Meaning | Smithers |
| --- | --- | --- |
| `Experimental.Otlp.layer({ url, service, version?, attributes?, headers? })` | A layer that exports logs, metrics and traces over OTLP/HTTP, scrubbed and bounded | `Otlp.layerFetch`, `Resource` |
| `Experimental.Otlp.relay(options)` | An HTTP handler that receives a browser's OTLP exports on your own route | `OtlpRelay.serve` |
| `Experimental.Otlp.dropped` | The counter of discarded batches | `flows_observability_otlp_dropped` |
| `Experimental.Logger.journal` | A layer that mirrors each log record of a durable run into that run's journal | `JournalLogger` |

### Rules

1. **Removing the layer removes telemetry and changes nothing else.** An export that fails never fails or retries the step that logged.
2. **Records are scrubbed before export.** The rules are the journal's: a value shaped like a credential becomes `[REDACTED]`.
3. **A resource is validated when the layer is built.** Identity fields and attribute keys hold at most 1,024 UTF-16 code units. A bad resource fails with `InvalidResourceConfiguration`.
4. **The transport is capped at 1 MiB a request.** A batch over the cap is discarded, counted, and reported by one `Warn` log with code `otlp_export_discarded` and a reason (`oversized`, `stalled` or `saturated`), at most once a minute. The warning never enters the exporter.
5. **Ambient resource configuration is ignored.** An environment variable cannot enlarge a resource after it was validated.
6. **No SDK.** `Experimental.Otlp.layer` uses Effect's exporter and `HttpClient`. A host that wants the OpenTelemetry SDK imports Smithers' `NodeOtel` or `BrowserOtel` from npm.
7. **What the standard library emits.** Every module in this set records spans and metrics for its own work: a span per durable step, per model call with token usage, per tool call. A failed span carries its failure's tag and code, never its message. A metric label is a bounded vocabulary: a run id is never a label. A replayed step is not counted as a new model call. Effect's `Telemetry` module in `effect/ai` already defines the model-call attributes, and Smithers' `RunMetrics` in `@smthrs/flow` defines the run and step metrics.
8. **Content is off by default.** Prompts, completions, file contents and shell output are not exported. Turning them on is a separate, named option, not a log level.

### Host needs

`HttpClient`. `Experimental.Logger.journal` also needs the journal, which [std-durable](0060-std-durable.md) provides.

## Claude's decisions

This is the decision record for the design above, including each API signature, rule and diagnostic table entry. The code examples illustrate those decisions. Optimistic acceptance records the authorship below; Will has not reviewed these choices and may overturn them.

- The same program compiles under `vibelang` 0.0.13 today with Effect's exporter, unscrubbed and unbounded: Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#decision) · [Review](reviews/2026-11-09-built-in-set.md).
- Two additions, each named after the Effect module it extends, as [VIP-33](0033-platform-stdlib.md) rules. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Both are in scope with no import, and their code is `vibelang-runtime/experimental/Otlp` and `…/Logger`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- They port `@smthrs/observability`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- `Logger`, `Tracer`, `Metric`, `Otlp`, `OtlpTracer`, `OtlpLogger`, `OtlpMetrics` and `PrometheusMetrics` stay Effect's. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Experimental.Otlp.layer({ url, service, version?, attributes?, headers? })`: Meaning: A layer that exports logs, metrics and traces over OTLP/HTTP, scrubbed and bounded; Smithers: `Otlp.layerFetch`, `Resource`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Experimental.Otlp.relay(options)`: Meaning: An HTTP handler that receives a browser's OTLP exports on your own route; Smithers: `OtlpRelay.serve`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Experimental.Otlp.dropped`: Meaning: The counter of discarded batches; Smithers: `flows_observability_otlp_dropped`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Experimental.Logger.journal`: Meaning: A layer that mirrors each log record of a durable run into that run's journal; Smithers: `JournalLogger`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- **Removing the layer removes telemetry and changes nothing else.** An export that fails never fails or retries the step that logged. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Records are scrubbed before export.** The rules are the journal's: a value shaped like a credential becomes `[REDACTED]`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A resource is validated when the layer is built.** Identity fields and attribute keys hold at most 1,024 UTF-16 code units. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A bad resource fails with `InvalidResourceConfiguration`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **The transport is capped at 1 MiB a request.** A batch over the cap is discarded, counted, and reported by one `Warn` log with code `otlp_export_discarded` and a reason (`oversized`, `stalled` or `saturated`), at most once a minute. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- The warning never enters the exporter. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Ambient resource configuration is ignored.** An environment variable cannot enlarge a resource after it was validated. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **No SDK.** `Experimental.Otlp.layer` uses Effect's exporter and `HttpClient`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A host that wants the OpenTelemetry SDK imports Smithers' `NodeOtel` or `BrowserOtel` from npm. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **What the standard library emits.** Every module in this set records spans and metrics for its own work: a span per durable step, per model call with token usage, per tool call. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A failed span carries its failure's tag and code, never its message. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A metric label is a bounded vocabulary: a run id is never a label. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A replayed step is not counted as a new model call. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Effect's `Telemetry` module in `effect/ai` already defines the model-call attributes, and Smithers' `RunMetrics` in `@smthrs/flow` defines the run and step metrics. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Content is off by default.** Prompts, completions, file contents and shell output are not exported. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Turning them on is a separate, named option, not a log level. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `HttpClient`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- `Experimental.Logger.journal` also needs the journal, which [std-durable](0060-std-durable.md) provides. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).

### Adopted review answers

- Keep `Experimental.X` names under VIP-33. Promotion to a bare module name requires a later decision. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Review question 1](reviews/2026-11-09-built-in-set.md#1-experimentalagent-or-agent).

## Compared

The same program in Smithers 1.x. It type-checks against `@smthrs/observability` 1.0.0-rc.16.

```ts
import { Otlp } from "@smthrs/observability"
import { Effect } from "effect"

const Telemetry = Otlp.layerFetch({ baseUrl: "http://localhost:4318", serviceName: "triage" })

export const program = Effect.logInfo("triage started").pipe(
  Effect.withSpan("triage"),
  Effect.provide(Telemetry)
)
```

| Program | Tokens (o200k_base) | Lines |
| --- | --- | --- |
| Vibe, proposed | 51 | 5 |
| Vibe 0.0.13 today, with Effect's `Otlp.layerJson` | 58 | 5 |
| Smithers 1.x | 83 | 9 |

**Checked.** Both Vibe examples use only existing syntax. The second compiles under `vibelang` 0.0.13 with nothing declared: `Otlp`, `withSpan` and `logInfo` are Effect's. The first compiles against a declaration of `Experimental.Otlp.layer`. The Smithers program type-checks as shown.

## Principles

- **TypeScript-first.** A layer.
- **Effect-second.** The strongest case in the set. Logging, tracing, metrics and the exporter are Effect's. This VIP adds a composition, not a system.
- **Optimized for agentic programs.** A prompt and a tool result are the largest log lines a program writes and the likeliest to hold a secret. Scrubbing and a size cap are the two properties an agent's telemetry needs.
- **Highly forkable.** A fork adds an exporter by providing a layer.
- **Factory-first.** PRINCIPLES 5: "every prompt, LLM call, tool call and decision is public". `Experimental.Logger.journal` is how a run's logs become part of its public record.

## What this changes

- `Experimental.Otlp` and `Experimental.Logger` are new, with four exports between them. No grammar changes.
- The banned `console` global ([VIP-33](0033-platform-stdlib.md)) keeps its replacement: `log`, `logInfo` and `Console`.

## Alternatives

- **Add nothing.** Effect's `Otlp.layerJson` works today. A program then exports whatever it logs, unscrubbed and unbounded. For an agentic program that is the failure this module exists to prevent.
- **One module named `Observe`.** A fifth name beside `Otlp`, `Logger`, `Tracer` and `Metric`. VIP-33 names an addition after the Effect module it extends, and each of these two extends one.
- **The OpenTelemetry SDK as the default.** It pulls `async_hooks` and cannot bundle for a browser. Smithers keeps it at a separate subpath for that reason.
- **A `trace` or `span` keyword.** `withSpan` is one call, and `Effect.fn("name")` already names a function's span.

## Follow-up questions

1. **Scrubbing upstream.** Redaction before export belongs in Effect's exporter. Recommendation: propose it to Effect and retire `Experimental.Otlp.layer` when it lands.
2. **Span and metric names.** Rule 7 defers the table. Smithers' names today carry `smithers_` and `flows_` prefixes. Should Vibe's standard library keep them, so Smithers dashboards work, or rename to `vibe_`? Recommendation: keep Smithers' names; a rename breaks every existing dashboard for no gain.
3. **A local sink when the collector is down.** The drop warning goes to the program's own logger. Is that enough for a headless host? Recommendation: yes for the first release; the counter is the durable signal.

## Depends on

- Nothing in this set. `Experimental.Logger.journal` takes the journal as a requirement.
