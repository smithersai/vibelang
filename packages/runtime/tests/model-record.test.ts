import { expect, test } from "bun:test"
import fc from "fast-check"
import { ConfigProvider, Context, Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { Decision, DecisionModel, LanguageModel } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { Workflow } from "effect/workflow"
import { Durable, Model } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// The provider: answers "<prompt> answered", and records every prompt it was
// sent. When `crash` names a prompt, it records it, kills the process and
// never answers: the call happened and nothing was recorded.
const provider = (asked: Array<string>, crash: { readonly prompt?: string; readonly died?: Deferred.Deferred<void> } = {}) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(await new Request(input, init).text())
    const prompt = body.messages[0].content.map((part: { text: string }) => part.text).join("")
    asked.push(prompt)
    if (prompt === crash.prompt && crash.died !== undefined) {
      Effect.runSync(Deferred.succeed(crash.died, void 0))
      return new Promise<Response>(() => {})
    }
    return new Response(JSON.stringify({
      id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5",
      content: [{ type: "text", text: prompt.startsWith("{") ? prompt : `${prompt} answered` }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }
    }), { headers: { "content-type": "application/json" } })
  }) as unknown as typeof globalThis.fetch

// A point in the task body where the injected fault kills the process.
interface CheckpointShape {
  readonly reach: (name: string) => Effect.Effect<void>
}
const Checkpoint = Context.Service<CheckpointShape>("test/Model/Checkpoint")
const passes = Layer.succeed(Checkpoint, { reach: () => Effect.void })
const diesAt = (at: string, died: Deferred.Deferred<void>) =>
  Layer.succeed(Checkpoint, {
    reach: (name: string) => name === at ? Effect.andThen(Deferred.succeed(died, void 0), Effect.never) : Effect.void
  })

const Summarize = Durable.task("test#Summarize", {
  payload: { text: Schema.String, calls: Schema.Number },
  success: Schema.String
})

const Flow = Workflow.make("test#ModelFlow", {
  payload: { id: Schema.String, calls: Schema.Number },
  success: Schema.String,
  idempotencyKey: ({ id }) => id
})

const flowLayer = (store: Durable.Store, checkpoint: Layer.Layer<Context.Service.Identifier<typeof Checkpoint>>) =>
  Flow.toLayer(({ calls, id }) => Summarize({ text: id, calls })).pipe(
    Layer.provide(Summarize.toLayer(({ calls, text }) =>
      Effect.gen(function*() {
        const answers: Array<string> = []
        for (let i = 1; i <= calls; i++) {
          answers.push((yield* LanguageModel.generateText({ prompt: `${text} ${i}` })).text)
          yield* (yield* Effect.service(Checkpoint)).reach(`after ${i}`)
        }
        return answers.join("|")
      })
    )),
    Layer.provide(Model.use("anthropic:claude-sonnet-5-5")),
    Layer.provide(checkpoint),
    Layer.provideMerge(Durable.layerStore(store))
  )

const keyed = ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } }))

// One process: runs the flow until it finishes or the fault kills it.
const process = (
  store: Durable.Store,
  payload: { readonly id: string; readonly calls: number },
  fetch: typeof globalThis.fetch,
  checkpoint: Layer.Layer<Context.Service.Identifier<typeof Checkpoint>>,
  died: Deferred.Deferred<void>
) =>
  Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(
      Flow.execute(payload).pipe(
        Effect.provide(flowLayer(store, checkpoint)),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.provide(keyed)
      )
    )
    const ended = yield* Effect.raceFirst(
      Effect.as(Deferred.await(died), "died" as const),
      Effect.map(Fiber.join(fiber), (value) => ({ value }))
    )
    if (ended === "died") yield* Fiber.interrupt(fiber)
    return ended
  }))

const fresh = () => Effect.runSync(Deferred.make<void>())

test("a model call inside a task is a recorded step: a resumed run reads its answer", async () => {
  const store = Durable.makeMemoryStore()
  const asked: Array<string> = []
  const died = fresh()
  // The process dies after the first call was answered and recorded.
  expect(await process(store, { id: "a", calls: 2 }, provider(asked), diesAt("after 1", died), died)).toBe("died")
  expect(await process(store, { id: "a", calls: 2 }, provider(asked), passes, fresh())).toEqual({ value: "a 1 answered|a 2 answered" })
  expect(asked).toEqual(["a 1", "a 2"])
  const run = await Effect.runPromise(Flow.executionId({ id: "a", calls: 2 }))
  const steps = await Effect.runPromise(
    Stream.runCollect(Durable.history(run)).pipe(Effect.provide(Durable.layerStore(store)))
  )
  const recorded = Array.from(steps).filter((entry) => entry.eventType === "StepCompleted")
    .map((entry) => (entry.payload as { step: string }).step)
  // A step inside a task may carry the task's step name before its own.
  expect(recorded.filter((step) => /(^|\/)model\//.test(step))).toHaveLength(2)
})

test("a crash during a call, before its answer is recorded, calls the provider again", async () => {
  const store = Durable.makeMemoryStore()
  const asked: Array<string> = []
  const died = fresh()
  expect(await process(store, { id: "b", calls: 2 }, provider(asked, { prompt: "b 2", died }), passes, died)).toBe("died")
  expect(await process(store, { id: "b", calls: 2 }, provider(asked), passes, fresh())).toEqual({ value: "b 1 answered|b 2 answered" })
  expect(asked).toEqual(["b 1", "b 2", "b 2"])
})

test("an answer is never shared across runs, and equal calls in one body are separate steps", async () => {
  const store = Durable.makeMemoryStore()
  const asked: Array<string> = []
  const twice = Flow.toLayer(({ id }) =>
    Effect.gen(function*() {
      const first = yield* LanguageModel.generateText({ prompt: `same ${id}` })
      const second = yield* LanguageModel.generateText({ prompt: `same ${id}` })
      return `${first.text}|${second.text}`
    })
  ).pipe(Layer.provide(Model.use("anthropic:claude-sonnet-5-5")), Layer.provideMerge(Durable.layerStore(store)))
  const run = (id: string) =>
    Effect.runPromise(Flow.execute({ id, calls: 0 }).pipe(
      Effect.provide(twice),
      Effect.provideService(FetchHttpClient.Fetch, provider(asked)),
      Effect.provide(keyed)
    ))
  expect(await run("x")).toBe("same x answered|same x answered")
  expect(await run("y")).toBe("same y answered|same y answered")
  expect(asked).toEqual(["same x", "same x", "same y", "same y"])
  // The finished run answers from its journal.
  expect(await run("x")).toBe("same x answered|same x answered")
  expect(asked).toHaveLength(4)
})

test("generateObject replays its decoded value in a resumed run", async () => {
  const store = Durable.makeMemoryStore()
  const asked: Array<string> = []
  const Label = Schema.Struct({ type: Schema.Literals(["bug", "feature"]), at: Schema.DateTimeUtcFromString })
  const flow = (checkpoint: Layer.Layer<Context.Service.Identifier<typeof Checkpoint>>) =>
    Flow.toLayer(({ id }) =>
      Effect.gen(function*() {
        const reply = yield* LanguageModel.generateObject({
          prompt: JSON.stringify({ type: "bug", at: "2026-11-10T00:00:00.000Z", id }),
          schema: Label
        })
        yield* (yield* Effect.service(Checkpoint)).reach("after object")
        return `${reply.value.type}@${reply.value.at.epochMilliseconds}`
      })
    ).pipe(
      Layer.provide(Model.use("anthropic:claude-sonnet-5-5")),
      Layer.provide(checkpoint),
      Layer.provideMerge(Durable.layerStore(store))
    )
  const run = (checkpoint: Layer.Layer<Context.Service.Identifier<typeof Checkpoint>>, died: Deferred.Deferred<void>) =>
    Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Flow.execute({ id: "o", calls: 0 }).pipe(
        Effect.provide(flow(checkpoint)),
        Effect.provideService(FetchHttpClient.Fetch, provider(asked)),
        Effect.provide(keyed)
      ))
      const ended = yield* Effect.raceFirst(Effect.as(Deferred.await(died), "died" as const), Fiber.join(fiber))
      if (ended === "died") yield* Fiber.interrupt(fiber)
      return ended
    }))
  const died = fresh()
  expect(await run(diesAt("after object", died), died)).toBe("died")
  expect(await run(passes, fresh())).toBe(`bug@${Date.parse("2026-11-10T00:00:00.000Z")}`)
  expect(asked).toHaveLength(1)
})

test("property: after any crash, each model call ran once plus once per crash during it", async () => {
  await checkProperty(fc, {
    name: "experimental-model-recorded-calls",
    rule: "VIP-62 rule 6: inside a task a call is a recorded step; delivery is at-least-once",
    command: "cd packages/runtime && bun test tests/model-record.test.ts",
    numRuns: 30,
    arbitrary: fc.record({
      calls: fc.integer({ min: 1, max: 4 }),
      crashes: fc.array(fc.record({ at: fc.integer({ min: 1, max: 4 }), during: fc.boolean() }), { maxLength: 3 })
    }),
    check: async ({ calls, crashes }: { readonly calls: number; readonly crashes: ReadonlyArray<{ readonly at: number; readonly during: boolean }> }) => {
      const store = Durable.makeMemoryStore()
      const asked: Array<string> = []
      const id = "p"
      const recorded = new Set<number>()
      const expected = new Map<number, number>()
      for (const crash of crashes) {
        if (crash.at > calls) continue
        const died = fresh()
        const ended = crash.during
          ? await process(store, { id, calls }, provider(asked, { prompt: `${id} ${crash.at}`, died }), passes, died)
          : await process(store, { id, calls }, provider(asked), diesAt(`after ${crash.at}`, died), died)
        if (ended !== "died") {
          // The fault never fired (its call was already recorded): the run finished.
          for (let i = 1; i <= calls; i++) {
            if (!recorded.has(i)) expected.set(i, (expected.get(i) ?? 0) + 1)
            recorded.add(i)
          }
          continue
        }
        // The oracle: every call before the crash point is recorded once; a
        // call that was in flight was made and not recorded.
        for (let i = 1; i < crash.at; i++) {
          if (!recorded.has(i)) expected.set(i, (expected.get(i) ?? 0) + 1)
          recorded.add(i)
        }
        if (!recorded.has(crash.at)) {
          expected.set(crash.at, (expected.get(crash.at) ?? 0) + 1)
          if (!crash.during) recorded.add(crash.at)
        }
      }
      const done = await process(store, { id, calls }, provider(asked), passes, fresh())
      expect(done).toEqual({ value: Array.from({ length: calls }, (_, i) => `${id} ${i + 1} answered`).join("|") })
      for (let i = 1; i <= calls; i++) {
        if (!recorded.has(i)) expected.set(i, (expected.get(i) ?? 0) + 1)
        expect(asked.filter((prompt) => prompt === `${id} ${i}`)).toHaveLength(expected.get(i)!)
      }
    }
  })
})

test("a decision inside a workflow is a recorded step: a resumed run reads its answers", async () => {
  const store = Durable.makeMemoryStore()
  let asked = 0
  const gateway = (async () => {
    asked++
    return new Response(JSON.stringify({ answers: { urgent: { type: "boolean", probability: 0.75 } } }), {
      headers: { "content-type": "application/json" }
    })
  }) as unknown as typeof globalThis.fetch
  const Urgent = Decision.make({ input: Schema.String, decisions: { urgent: Decision.probability({ instructions: "Is it urgent?" }) } })
  const flow = (checkpoint: Layer.Layer<Context.Service.Identifier<typeof Checkpoint>>) =>
    Flow.toLayer(({ id }) =>
      Effect.gen(function*() {
        const decided = yield* DecisionModel.decide(Urgent, { input: id })
        yield* (yield* Effect.service(Checkpoint)).reach("after decision")
        return String(decided.answers.urgent.probability)
      }).pipe(Effect.orDie)
    ).pipe(Layer.provide(Model.decide()), Layer.provide(checkpoint), Layer.provideMerge(Durable.layerStore(store)))
  const run = (checkpoint: Layer.Layer<Context.Service.Identifier<typeof Checkpoint>>, died: Deferred.Deferred<void>) =>
    Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Flow.execute({ id: "d", calls: 0 }).pipe(
        Effect.provide(flow(checkpoint)),
        Effect.provideService(FetchHttpClient.Fetch, gateway),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { AI_GATEWAY_API_KEY: "vck" } })))
      ))
      const ended = yield* Effect.raceFirst(Effect.as(Deferred.await(died), "died" as const), Fiber.join(fiber))
      if (ended === "died") yield* Fiber.interrupt(fiber)
      return ended
    }))
  const died = fresh()
  expect(await run(diesAt("after decision", died), died)).toBe("died")
  expect(await run(passes, fresh())).toBe("0.75")
  expect(asked).toBe(1)
})
