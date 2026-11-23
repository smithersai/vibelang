import { expect, test } from "bun:test"
import fc from "fast-check"
import { ConfigProvider, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { AiError, LanguageModel, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { Workflow } from "effect/workflow"
import { Durable, Model } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// A tool whose typed failure the model's caller sees (failureMode "error").
const Add = Tool.make("Add", {
  parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
  success: Schema.Number,
  failure: Schema.Struct({ tooBig: Schema.Number }),
  failureMode: "error"
})
const Calc = Toolkit.make(Add)

// An Anthropic Messages endpoint that asks for Add(a, b), and counts requests.
const provider = (a: number, b: number, asked: { n: number }) =>
  (async () => {
    asked.n++
    return new Response(JSON.stringify({
      id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5",
      content: [{ type: "tool_use", id: "toolu_1", name: "Add", input: { a, b } }],
      stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }
    }), { headers: { "content-type": "application/json" } })
  }) as unknown as typeof globalThis.fetch

const Turn = Durable.task("test#ToolTurn", { payload: { prompt: Schema.String }, success: Schema.String, error: AiError.AiError })
const Flow = Workflow.make("test#ToolFlow", {
  payload: { id: Schema.String },
  success: Schema.String,
  error: AiError.AiError,
  idempotencyKey: ({ id }) => id
})

// The task asks once with the toolkit and reports the tool's result or its
// typed failure. With `died`, the process dies inside the task right after
// the call, before the task itself is recorded.
const flowLayer = (store: Durable.Store, ran: { n: number }, died?: Deferred.Deferred<void>) =>
  Flow.toLayer(({ id }) => Turn({ prompt: id })).pipe(
    Layer.provide(Turn.toLayer(({ prompt }) =>
      LanguageModel.generateText({ prompt, toolkit: Calc }).pipe(
        Effect.map((response) => `result ${JSON.stringify(response.toolResults.map((part) => part.result))}`),
        Effect.catch((error) => AiError.isAiError(error) ? Effect.fail(error) : Effect.succeed(`failure ${JSON.stringify(error)}`)),
        Effect.tap(() => died === undefined ? Effect.void : Effect.andThen(Deferred.succeed(died, void 0), Effect.never))
      )
    )),
    Layer.provide(Calc.toLayer({
      Add: ({ a, b }) => Effect.suspend(() => (ran.n++, a + b > 100 ? Effect.fail({ tooBig: a + b }) : Effect.succeed(a + b)))
    })),
    Layer.provide(Model.use("anthropic:claude-sonnet-5-5")),
    Layer.provideMerge(Durable.layerStore(store))
  )

const keys = ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } }))

// One process: runs the flow to its end, or until it dies inside the task.
const process = (store: Durable.Store, id: string, fetch: typeof globalThis.fetch, ran: { n: number }, dies: boolean) =>
  Effect.runPromise(Effect.gen(function*() {
    const died = yield* Deferred.make<void>()
    const fiber = yield* Effect.forkChild(Effect.exit(Flow.execute({ id }).pipe(
      Effect.provide(flowLayer(store, ran, dies ? died : undefined)),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provide(keys)
    )))
    if (!dies) return yield* Fiber.join(fiber)
    yield* Deferred.await(died)
    yield* Fiber.interrupt(fiber)
    return "died"
  }).pipe(Effect.timeout(Duration.seconds(20))))

const modelSteps = async (store: Durable.Store, id: string) => {
  const run = await Effect.runPromise(Flow.executionId({ id }))
  const history = await Effect.runPromise(Stream.runCollect(Durable.history(run)).pipe(Effect.provide(Durable.layerStore(store))))
  return Array.from(history)
    .filter((entry) => entry.eventType === "StepCompleted")
    .map((entry) => (entry.payload as { step: string }).step)
    .filter((step) => /(^|\/)model\/[0-9a-f]+\/\d+$/.test(step))
}

test("a call with a toolkit in a task is a recorded step: a resumed run reads its tool results and runs no handler", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const ran = { n: 0 }
  expect(await process(store, "a", provider(2, 3, asked), ran, true)).toBe("died")
  expect(await process(store, "a", provider(40, 2, asked), ran, false)).toEqual(Exit.succeed("result [5]"))
  expect(asked.n).toBe(1)
  expect(ran.n).toBe(1)
  expect(await modelSteps(store, "a")).toHaveLength(1)
})

test("a tool's typed failure is recorded with the call and replayed as the same failure", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const ran = { n: 0 }
  expect(await process(store, "b", provider(90, 30, asked), ran, true)).toBe("died")
  expect(await process(store, "b", provider(1, 1, asked), ran, false)).toEqual(Exit.succeed('failure {"tooBig":120}'))
  expect(asked.n).toBe(1)
  expect(ran.n).toBe(1)
  expect(await modelSteps(store, "b")).toHaveLength(1)
})

test("property: a replayed toolkit call returns what the live call returned", async () => {
  await checkProperty(fc, {
    name: "experimental-model-toolkit-replay",
    rule: "VIP-62 rule 6: inside a task a call is a recorded step; a resumed run reads the recorded answer",
    command: "cd packages/runtime && bun test tests/model-toolkit-record.test.ts",
    numRuns: 20,
    arbitrary: fc.record({ a: fc.integer({ min: -50, max: 120 }), b: fc.integer({ min: -50, max: 120 }) }),
    check: async ({ a, b }: { readonly a: number; readonly b: number }) => {
      const asked = { n: 0 }
      const live = { n: 0 }
      const liveStore = Durable.makeMemoryStore()
      const expected = await process(liveStore, "p", provider(a, b, asked), live, false)
      const store = Durable.makeMemoryStore()
      const ran = { n: 0 }
      expect(await process(store, "p", provider(a, b, asked), ran, true)).toBe("died")
      expect(await process(store, "p", provider(b, a + 1, asked), ran, false)).toEqual(expected)
      expect(ran.n).toBe(1)
      expect(asked.n).toBe(2)
    }
  })
})
