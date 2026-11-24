# VIP-57: `schema service` and worker imports: threads and other machines behind one typed boundary

**Status:** accepted by Will, 2026-11-23. Will: "57 I accept but I want you to read it and polish it too it's a messy vip". Polished on 2026-11-23 to remove duplicated decision bullets, reconcile the Effect/Stream member rule, scrub internal reference-engine commits, and drop the stale VIP-54 blocker. Implementation queued. *(Previously reopened 2026-11-11 awaiting Will's review.)*

## Will's words
> Vibelang is meant to have most of the features of durable execution agents etc. built into it. What is that status? Are the VIP open or are VIP missing for things like adding llm calls or jev calls to language sandboxing durable execution etc?

## Summary

Agentic programs need first-class multithreading and execution on other machines. This proposal follows the decision in [VIP-44](0044-durable-values.md) to reuse RPC.

**One sentence.** `schema service` declares a service whose calls can cross a boundary, and a layer decides where its implementation runs: this thread, a pool of worker threads, or another machine.

**One paragraph.** Vibe already has typed interfaces (`service`) and typed serialization (`schema`, VIP-44). A service whose every member has a schema is an Rpc group, and Effect already runs Rpc groups over worker threads, HTTP and sockets. This VIP joins the two. `schema service Stats { … }` is to `service` what `schema error` is to `error`: the same declaration, with codecs. Code that calls `stats.summarize(values)` does not change when the implementation moves. One import attribute, `with { type: "worker" }`, tells the compiler to build a module as a worker entry.

```text
                      schema service Stats { summarize(values): Summary!EmptySample }
                                              │
   provide StatsLive            provide Experimental.Rpc.workers(statsWorker, { size: 4 })      provide Experimental.Rpc.client(Stats)
   ─────────────────            ──────────────────────────────────────────────────────────      ──────────────────────────────────────
   this fiber                   4 worker threads, Rpc over postMessage                          another machine, Rpc over HTTP
                                              ▼
                        const stats = try Stats;  try stats.summarize(values)      unchanged in all three
```

## Decision

```ts
// proposed: stats.vibe
schema Summary { mean: number; max: number }
schema error EmptySample {}

export schema service Stats {
  summarize(values: readonly number[]): Summary!EmptySample
}

export default Layer.succeed(Stats, {
  summarize: effect (values) => {
    if (values.length === 0) throw new EmptySample()
    return { mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) }
  }
})
```

```ts
// proposed: main.vibe
import { Stats } from "./stats.vibe"
import statsWorker from "./stats.vibe" with { type: "worker" }

export effect function main(samples: readonly (readonly number[])[]) {
  provide Experimental.Rpc.workers(statsWorker, { size: 4 }) {
    const stats = try Stats
    return try forEach(samples, (values) => stats.summarize(values), { concurrency: "unbounded" })
  }
}
```

### `schema service`

1. Every member is a method returning an `Effect` or a `Stream`. Properties, getters/setters, plain non-Effect methods, and overloaded or generic methods (which have no single wire schema) are compile errors (`schema-service-member`).
2. Every parameter, success/element type, and error type is a durable boundary type ([VIP-44](0044-durable-values.md)). Any type with no schema form is `EK2109`. Optional parameters map to `Schema.optional`.
3. The declaration is still a normal `service`: same key, same `Stats.Shape`, same `Layer.succeed(Stats, …)`. Providing a local layer executes in-process with zero serialization.
4. The compiler also generates the service's `RpcGroup` (one `Rpc` per member, payload keyed by parameter name; `Stream` return types become streaming RPCs).
5. Only the declared method inputs, outputs, and errors cross the boundary. Services used by the implementation are resolved on the worker/server side from its own layer — nothing is serialized from the caller's environment.

### Worker imports

1. `import w from "./m.vibe" with { type: "worker" }` binds `w` to a handle for the module as a worker entry. It imports no code into this thread. Import attributes are ECMAScript 2025; the value `"worker"` is Vibe's.
2. The module's default export is a `Layer`. Every service it provides is a `schema service`. Its requirements are services the worker's host provides.
3. The compiler emits a worker entry that serves those services, and the bundler plugins emit it as its own chunk.
4. A worker is a separate realm with separate module state. **It is not a security boundary.** A sandbox is ([std-sandbox](0067-std-sandbox.md)).
5. Values are copied through their schemas. Nothing is shared or transferred unless a schema says so.

### `Experimental.Rpc`

In scope as `Experimental.Rpc`, named after the Effect module it extends ([VIP-33](0033-platform-stdlib.md)). Its code is `vibelang-runtime/experimental/Rpc`.

| Call | Gives | Effect code underneath |
| --- | --- | --- |
| `Experimental.Rpc.workers(w, { size })` or `{ minSize, maxSize, timeToLive }`, with optional `concurrency` | A layer that provides `w`'s services from a pool of threads | `RpcClient.layerProtocolWorker(options)`, `RpcClient.make(group)`, the host's `Worker.Spawner` |
| `Experimental.Rpc.client(Stats)` | A layer that provides `Stats` by calling a server | `RpcClient.make(group)`; needs `RpcClient.Protocol` |
| `Experimental.Rpc.serve(Stats)` | A layer that serves `Stats` to callers | `RpcServer.layer(group)`; needs `Stats` and `RpcServer.Protocol` |

The transport is Effect's and is chosen with `provide`: `RpcClient.layerProtocolHttp`, `RpcServer.layerProtocolHttp`, the socket protocols, and `RpcSerialization.layerNdjson` or another serializer. VIP-44's serialization rules apply unchanged.

```ts
// proposed: the same Stats on another machine
provide Layer.provide(Experimental.Rpc.client(Stats), RpcClient.layerProtocolHttp({ url: "https://stats.internal/rpc" })) {
  const stats = try Stats
  return try stats.summarize(values)
}
```

- **Failures.** A transport failure is a defect, unless the member's declared error type includes Effect's `RpcClientError`. Then the member fails with it, typed.
- **Limits.** A pool bounds its threads (`size`) and the calls each runs at once (`concurrency`). Message size is the transport's bound.
- **Cancellation.** Interrupting the calling fiber sends Rpc's interrupt to the far side. It does not prove the far side stopped. A pool's scope owns its threads and ends them when it closes.

### Four scales

| To run code | Use | Defined in |
| --- | --- | --- |
| On another thread | A worker import and `Experimental.Rpc.workers` | This VIP |
| On another machine you run | `Experimental.Rpc.serve` there, `Experimental.Rpc.client` here | This VIP |
| On a machine made for the job | `provide Experimental.Sandbox.container(…) { … }`: the same `FileSystem` and `ChildProcess` code runs there | [std-sandbox](0067-std-sandbox.md) |
| As a durable step on another engine | `static readonly placement = { remote: "compute" }` on a `task` | [durable-tasks-workflows](0055-durable-tasks-workflows.md) |

A placed task compiles to remote durable RPC placement ([VIP-55](0055-durable-tasks-workflows.md)), preserving `implementationVersion` and refusing unbound remote targets at startup rather than silently falling back to local execution. A lost reply is retried under the same invocation key so the caller joins the recorded run.

### What the compiler emits

For `stats.vibe`, beside the ordinary service:

```ts
export class EmptySample extends Schema.TaggedError<EmptySample>()("EmptySample", {}) {}
export const Summary = Schema.Struct({ mean: Schema.mutableKey(Schema.Number), max: Schema.mutableKey(Schema.Number) })

export class StatsRpcs extends RpcGroup.make(
  Rpc.make("summarize", {
    payload: { values: Schema.Array(Schema.Number) },
    success: Summary,
    error: EmptySample
  })
) {}
```

For the worker entry of `stats.vibe`:

```ts
const server = RpcServer.layer(StatsRpcs).pipe(
  Layer.provide(StatsRpcs.toLayer({ summarize: ({ values }) => Effect.flatMap(Stats, (stats) => stats.summarize(values)) })),
  Layer.provide(defaultExportLayer),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(hostWorkerRunnerLayer)        // NodeWorkerRunner.layer on Node
)
runMain(Layer.launch(server))
```

For `Experimental.Rpc.workers(statsWorker, { size: 4 })`:

```ts
Layer.effect(Stats, Effect.map(RpcClient.make(StatsRpcs), (client) => ({
  summarize: (values) => client.summarize({ values })
}))).pipe(
  Layer.provide(RpcClient.layerProtocolWorker({ size: 4 })),
  Layer.provide(hostWorkerLayer(statsWorkerUrl))      // NodeWorker.layer(() => new Worker(url)) on Node
)
```

### Diagnostics

Diagnostic codes are allocated from the `EK57xx` block when implemented:

| Slug | When |
| --- | --- |
| `schema-service-member` | A member is a property, accessor, overload, generic method, or does not return an `Effect` or `Stream` |
| `worker-default-export` | A module imported `with { type: "worker" }` has no default-export `Layer`, or provides a service that is not a `schema service` |
| `worker-binding` | A worker import uses named or namespace bindings instead of a default binding |

### Resolved design scope

- **Module name:** Keep `Experimental.Rpc` under [VIP-33](0033-platform-stdlib.md) until a later promotion decision.
- **Transport failures:** Defects by default so call sites stay identical across local, worker, and remote layers; typed when a member explicitly declares `RpcClientError` in its error channel.
- **Zero-copy buffers:** Copy by default; explicit Effect `Transferable` schemas opt into transfer semantics so sender buffers are never silently neutered.
- **Out of scope for VIP-57:** Stateful addressed entities (`effect/cluster` `Entity` — future follow-up VIP) and shared-memory structs.

## Compared

The same program in Effect TypeScript: three files, which type-check on `effect` 4.1.1 and `@effect/platform-node` 4.1.1. The reference engine 1.x has no thread abstraction of its own; a program on the reference engine writes this.

```ts
// Effect TS: stats.ts
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export class EmptySample extends Schema.TaggedError<EmptySample>()("EmptySample", {}) {}

export const Summary = Schema.Struct({ mean: Schema.Number, max: Schema.Number })

export class Stats extends RpcGroup.make(
  Rpc.make("summarize", {
    payload: { values: Schema.Array(Schema.Number) },
    success: Summary,
    error: EmptySample
  })
) {}
```

```ts
// Effect TS: worker.ts
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner"
import { Effect, Layer } from "effect"
import { RpcServer } from "effect/rpc"
import { EmptySample, Stats } from "./stats.ts"

const StatsLive = Stats.toLayer({
  summarize: ({ values }) =>
    values.length === 0
      ? Effect.fail(new EmptySample())
      : Effect.succeed({ mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) })
})

const server = RpcServer.layer(Stats).pipe(
  Layer.provide(StatsLive),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer)
)

NodeRuntime.runMain(Layer.launch(server))
```

```ts
// Effect TS: main.ts
import * as NodeWorker from "@effect/platform-node/NodeWorker"
import { Effect, Layer } from "effect"
import { RpcClient } from "effect/rpc"
import { Worker } from "node:worker_threads"
import { Stats } from "./stats.ts"

const workers = RpcClient.layerProtocolWorker({ size: 4 }).pipe(
  Layer.provide(NodeWorker.layer(() => new Worker(new URL("./worker.ts", import.meta.url))))
)

export const main = (samples: ReadonlyArray<ReadonlyArray<number>>) =>
  Effect.gen(function*() {
    const stats = yield* RpcClient.make(Stats)
    return yield* Effect.all(samples.map((values) => stats.summarize({ values })), { concurrency: "unbounded" })
  }).pipe(Effect.scoped, Effect.provide(workers))
```

| Program | Tokens (o200k_base) | Lines | Files |
| --- | --- | --- | --- |
| Vibe, proposed | 193 | 22 | 2 |
| Effect TypeScript | 451 | 49 | 3 |

**Checked.** The three TypeScript files type-check as shown. The Vibe example with `service` in place of `schema service`, and `provide StatsLive` in place of the worker, compiles under `vibelang` 0.0.13. `schema service` and the worker import are new. Vibe 0.0.13 cannot write `main.ts` at all: `new Worker(…)` is the host binding that `EK4402` bans in `.vibe` code.

## Principles

- **TypeScript-first.** The import attribute is standard ECMAScript syntax. `schema service` joins two keywords Vibe has, in the order `schema error` set.
- **Effect-second.** Everything emitted is Effect's `Rpc`, `RpcGroup`, `RpcClient`, `RpcServer` and `Worker`. Nothing is reinvented, as VIP-44 asked.
- **Optimized for agentic programs.** An agent host runs model streams, parsers and embeddings beside each other. A pool is one `provide`.
- **Highly forkable.** The seam is the layer. A fork adds a transport by writing one layer; no call site changes.
- **Factory-first.** The emitted Rpc group is checkable Effect code.
- **One meaning per form.** `try stats.summarize(values)` means one thing. Where it runs is stated once, at `provide`.
- **Hand-written Effect.** The emitted code is the three-file program above.

## What this changes

- `schema` becomes a modifier of `service`, as it is of `error` ([VIP-29](0029-schema-errors.md)).
- The import attribute `type: "worker"` gains a meaning, and bundler plugins emit a dedicated chunk for it.
- `Experimental.Rpc` is new.
- The proposals page's `spawn module { … }` is replaced.

## Alternatives

- **`worker task T { … }` with a `target` member.** It ties a thread to the durable engine: a pure function that sums numbers would need a journal. It also covers one method a declaration. Durable placement exists for steps that need a journal, in the table above.
- **`spawn module { … }`**, the earlier design, on TC39 Module Expressions (stage 2). `module` already means a TypeScript body in Vibe ([VIP-40](0040-module-declarations.md)), and VIP-44 uses `spawn` for starting a run. Two forms would each mean two things.
- **A module's exports as the contract**: `import * as stats from "./stats.vibe" with { type: "worker" }`, then `stats.summarize(values)`. One declaration fewer. It gives the worker no way to say which layers its functions need, and no interface a remote machine can implement.
- **Library only.** That is the three-file program, and it needs a `.ts` file to construct the worker.

## Depends on

- [VIP-44](0044-durable-values.md), accepted: the Rpc boundary and its serialization.
- [VIP-9](0009-service-declarations.md) and [VIP-29](0029-schema-errors.md), accepted.
- Host worker spawners from `@effect/platform-{node,browser,bun}` (does not block on the VIP-54 RFP).
- Nothing else in this set. Durable placement is [VIP-55](0055-durable-tasks-workflows.md)'s member.
