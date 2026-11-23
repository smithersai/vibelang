import { expect, test } from "bun:test"
import fc from "fast-check"
import { ConfigProvider, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { AiError, LanguageModel, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { Workflow } from "effect/workflow"
import { Durable, Model } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// VIP-62 rules 6 and 7: a call inside a task is a recorded step of that task.
// Two tasks of one run that make the same request are two calls, each with
// its own answer, and a resumed run replays each task's own answer.

const keys = ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } }))

const reply = (content: ReadonlyArray<unknown>) =>
  new Response(JSON.stringify({
    id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", content,
    stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }
  }), { headers: { "content-type": "application/json" } })

// A provider that answers "answer <n>" to its n-th request.
const counting = (asked: { n: number }) =>
  (async () => reply([{ type: "text", text: `answer ${++asked.n}` }])) as unknown as typeof globalThis.fetch

const Ask = Durable.task("scope#Ask", { payload: { prompt: Schema.String, slot: Schema.Number }, success: Schema.String, error: AiError.AiError })
const Other = Durable.task("scope#Other", { payload: { prompt: Schema.String }, success: Schema.String, error: AiError.AiError })
const Flow = Workflow.make("scope#Flow", {
  payload: { id: Schema.String, prompts: Schema.Array(Schema.String) },
  success: Schema.Array(Schema.String),
  error: AiError.AiError,
  idempotencyKey: ({ id }) => id
})

const ask = (prompt: string) => Effect.map(LanguageModel.generateText({ prompt }), (response) => response.text)

const flowLayer = (store: Durable.Store) =>
  Flow.toLayer(({ prompts }) =>
    Effect.gen(function*() {
      const answers: Array<string> = []
      for (const [slot, prompt] of prompts.entries()) answers.push(yield* Ask({ prompt, slot }))
      answers.push(yield* Other({ prompt: prompts[0] ?? "" }))
      return answers
    })
  ).pipe(
    Layer.provide(Ask.toLayer(({ prompt }) => ask(prompt))),
    Layer.provide(Other.toLayer(({ prompt }) => ask(prompt))),
    Layer.provide(Model.use("anthropic:claude-sonnet-5-5")),
    Layer.provideMerge(Durable.layerStore(store))
  )

const run = (store: Durable.Store, id: string, prompts: ReadonlyArray<string>, fetch: typeof globalThis.fetch) =>
  Effect.runPromise(Flow.execute({ id, prompts }).pipe(
    Effect.provide(flowLayer(store)),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
    Effect.provide(keys),
    Effect.exit,
    Effect.timeout(Duration.seconds(20))
  ))

test("two tasks of one run that make the same request each get their own answer", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  expect(await run(store, "a", ["next", "next"], counting(asked))).toEqual(Exit.succeed(["answer 1", "answer 2", "answer 3"]))
  expect(asked.n).toBe(3)
})

test("a task and its model call persist under distinct replay keys", async () => {
  const store = Durable.makeMemoryStore()
  const prompts = ["next"]
  await run(store, "journal", prompts, counting({ n: 0 }))
  const id = await Effect.runPromise(Flow.executionId({ id: "journal", prompts }))
  const entries = await Effect.runPromise(store.entries(id))
  const keys = entries.filter((entry) => entry.eventType === "StepCompleted").map(({ payload }) => {
    const { step, stepKey, attempt } = payload as { step: string; stepKey?: string; attempt: number }
    return [stepKey ?? step, attempt].join("/")
  })
  // One call inside each of two tasks.
  expect(keys).toHaveLength(4)
  expect(new Set(keys).size).toBe(keys.length)
})

test("equal model requests in separate recorded races and the workflow body have distinct answers", async () => {
  const store = Durable.makeMemoryStore()
  const flow = Durable.workflow("scope#Races", { payload: {}, success: Schema.Array(Schema.String), error: AiError.AiError })
  const asked = { n: 0 }
  const racing = (name: string) => Durable.race({
    name, success: Schema.String, error: AiError.AiError, effects: [ask("same")]
  })
  const layer = flow.toLayer(() => Effect.gen(function*() {
    return [yield* racing("first"), yield* racing("second"), yield* ask("same")]
  })).pipe(
    Layer.provide(Model.use("anthropic:claude-sonnet-5-5")),
    Layer.provideMerge(Durable.layerStore(store))
  )
  const answers = await Effect.runPromise(flow.execute({}).pipe(
    Effect.provide(layer), Effect.provideService(FetchHttpClient.Fetch, counting(asked)), Effect.provide(keys)
  ))
  expect(answers).toEqual(["answer 1", "answer 2", "answer 3"])
  expect(asked.n).toBe(3)
})

test("property: every task's call is asked once, answered on its own, and replayed as its own", async () => {
  await checkProperty(fc, {
    name: "experimental-model-task-scoped-steps",
    rule: "VIP-62 rules 6 and 7: inside a task a call is a recorded step; a resumed run reads the recorded answer",
    command: "cd packages/runtime && bun test tests/model-step-scope.test.ts",
    numRuns: 25,
    arbitrary: fc.array(fc.constantFrom("a", "b", "c"), { minLength: 1, maxLength: 5 }),
    check: async (prompts: ReadonlyArray<string>) => {
      const store = Durable.makeMemoryStore()
      const asked = { n: 0 }
      const first = await run(store, "p", prompts, counting(asked))
      const expected = Array.from({ length: prompts.length + 1 }, (_, i) => `answer ${i + 1}`)
      expect(first).toEqual(Exit.succeed(expected))
      expect(asked.n).toBe(prompts.length + 1)
      const again = { n: 100 }
      expect(await run(store, "p", prompts, counting(again))).toEqual(Exit.succeed(expected))
      expect(again.n).toBe(100)
    }
  })
})

// A tool whose parameters decode: the model sends the encoded form.
const Double = Tool.make("Double", {
  parameters: Schema.Struct({ n: Schema.NumberFromString }),
  success: Schema.Number
})
const Doubler = Toolkit.make(Double)

const Turn = Durable.task("scope#Turn", { payload: { prompt: Schema.String }, success: Schema.String, error: AiError.AiError })
const ToolFlow = Workflow.make("scope#ToolFlow", {
  payload: { id: Schema.String },
  success: Schema.String,
  error: AiError.AiError,
  idempotencyKey: ({ id }) => id
})

const toolRun = (
  store: Durable.Store,
  id: string,
  fetch: typeof globalThis.fetch,
  ran: { n: number },
  call: (prompt: string) => Effect.Effect<string, AiError.AiError, any>,
  dies: boolean
) =>
  Effect.runPromise(Effect.gen(function*() {
    const died = yield* Deferred.make<void>()
    const layer = ToolFlow.toLayer(({ id }) => Turn({ prompt: id })).pipe(
      Layer.provide(Turn.toLayer(({ prompt }) =>
        call(prompt).pipe(Effect.tap(() => dies ? Effect.andThen(Deferred.succeed(died, void 0), Effect.never) : Effect.void))
      )),
      Layer.provide(Doubler.toLayer({ Double: ({ n }) => Effect.sync(() => (ran.n++, n * 2)) })),
      Layer.provide(Model.use("anthropic:claude-sonnet-5-5")),
      Layer.provideMerge(Durable.layerStore(store))
    )
    const fiber = yield* Effect.forkChild(Effect.exit(ToolFlow.execute({ id }).pipe(
      Effect.provide(layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provide(keys)
    )))
    if (!dies) return yield* Fiber.join(fiber)
    yield* Deferred.await(died)
    yield* Fiber.interrupt(fiber)
    return "died"
  }).pipe(Effect.timeout(Duration.seconds(20))))

const toolUse = (name: string, input: unknown, asked: { n: number }) =>
  (async () => (asked.n++, reply([{ type: "tool_use", id: "toolu_1", name, input }]))) as unknown as typeof globalThis.fetch

test("a recorded tool call keeps the parameters the model sent, so a decoding parameter schema replays", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const ran = { n: 0 }
  const call = (prompt: string) =>
    Effect.map(LanguageModel.generateText({ prompt, toolkit: Doubler }), (response) =>
      `${JSON.stringify(response.toolCalls.map((part) => part.params))} ${JSON.stringify(response.toolResults.map((part) => part.result))}`)
  expect(await toolRun(store, "t", toolUse("Double", { n: "21" }, asked), ran, call, true)).toBe("died")
  expect(await toolRun(store, "t", toolUse("Double", { n: "5" }, asked), ran, call, false)).toEqual(Exit.succeed('[{"n":"21"}] [42]'))
  expect(asked.n).toBe(1)
  expect(ran.n).toBe(1)
})

test("with resolution off, a recorded tool call keeps its encoded parameters", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const ran = { n: 0 }
  const call = (prompt: string) =>
    Effect.map(LanguageModel.generateText({ prompt, toolkit: Doubler, disableToolCallResolution: true }), (response) =>
      JSON.stringify(response.toolCalls.map((part) => [part.name, part.params])))
  expect(await toolRun(store, "e", toolUse("Double", { n: "21" }, asked), ran, call, true)).toBe("died")
  expect(await toolRun(store, "e", toolUse("Double", { n: "5" }, asked), ran, call, false)).toEqual(Exit.succeed('[["Double",{"n":"21"}]]'))
  expect(asked.n).toBe(1)
  expect(ran.n).toBe(0)
})

test("with deferred validation, a recorded call keeps a call to a tool the toolkit does not declare", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const ran = { n: 0 }
  const call = (prompt: string) =>
    Effect.map(
      LanguageModel.generateText({ prompt, toolkit: Doubler, disableToolCallResolution: true, toolCallValidation: "deferred" }),
      (response) => JSON.stringify(response.toolCalls.map((part) => [part.name, part.params]))
    )
  expect(await toolRun(store, "d", toolUse("Search", { q: "x" }, asked), ran, call, true)).toBe("died")
  expect(await toolRun(store, "d", toolUse("Search", { q: "y" }, asked), ran, call, false)).toEqual(Exit.succeed('[["Search",{"q":"x"}]]'))
  expect(asked.n).toBe(1)
})
