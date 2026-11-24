// VIP-57 fixture: what the compiler emits for a worker module, written by hand.
//
//   export schema service Stats { summarize(values: readonly number[]): Summary!EmptySample; ... }
//   export schema service Labels { thread(): string }
//   export default Layer.mergeAll(StatsLive, LabelsLive)
import { appendFileSync } from "node:fs"
import { threadId } from "node:worker_threads"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as runtime from "vibelang-runtime/internal"

export class EmptySample extends Schema.TaggedError()("EmptySample", {}) {}
export const Summary = Schema.Struct({ mean: Schema.Number, max: Schema.Number })

export class StatsRpcs extends RpcGroup.make(
  Rpc.make("summarize", { payload: { values: Schema.Array(Schema.Number) }, success: Summary, error: EmptySample }),
  Rpc.make("ticks", { payload: { n: Schema.Number }, success: Schema.Number, error: EmptySample, stream: true }),
  Rpc.make("arity", { payload: { a: Schema.optional(Schema.Number), b: Schema.optional(Schema.Number) }, success: Schema.Number }),
  Rpc.make("thread", { payload: {}, success: Schema.Number }),
  Rpc.make("slow", { payload: { ms: Schema.Number }, success: Schema.Number }),
  Rpc.make("probe", { payload: {}, success: Schema.Number }),
  Rpc.make("reset", { payload: {} })
) {}
export class Stats extends runtime.$schemaService("test/rpc-stats#Stats", () => StatsRpcs, ["probe"]) {}

export class LabelsRpcs extends RpcGroup.make(
  Rpc.make("thread", { payload: {}, success: Schema.String })
) {}
export class Labels extends runtime.$schemaService("test/rpc-stats#Labels", () => LabelsRpcs) {}

export const StatsLive = Layer.succeed(Stats, {
  summarize: (values) =>
    values.length === 0
      ? Effect.fail(new EmptySample())
      : Effect.succeed({ mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) }),
  ticks: (n) => n < 0 ? Stream.fail(new EmptySample()) : Stream.fromIterable(Array.from({ length: n }, (_, i) => i + 1)),
  arity: (...args) => Effect.succeed(args.length),
  thread: () => Effect.succeed(threadId),
  slow: (ms) => Effect.as(Effect.sleep(ms), threadId),
  probe: () => Effect.succeed(1),
  reset: () => Effect.void
})

export const LabelsLive = Layer.succeed(Labels, { thread: () => Effect.succeed(`labels:${threadId}`) })

// Records each thread's start and the release of its layer, when the host asks.
const log = (event) => {
  if (process.env.RPC_FIXTURE_LOG) appendFileSync(process.env.RPC_FIXTURE_LOG, `${event} ${threadId}\n`)
}
const Lifecycle = Layer.effectDiscard(Effect.acquireRelease(Effect.sync(() => log("start")), () => Effect.sync(() => log("stop"))))

export default Layer.mergeAll(StatsLive, LabelsLive, Lifecycle)
