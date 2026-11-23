import { expect, test } from "bun:test"
import fc from "fast-check"
import { ConfigProvider, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { AiError, LanguageModel, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { Workflow, WorkflowEngine } from "effect/workflow"
import { Durable, Model } from "vibelang-runtime/experimental"
import * as record from "../dist/experimental/internal/record.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const encoder = new TextEncoder()
const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  encoder.encode(`data: ${JSON.stringify({
    id: "c", object: "chat.completion.chunk", created: 1, model: "m",
    choices: [{ index: 0, delta, finish_reason: finish }]
  })}\n\n`)

// One scripted answer: a refusal, or a stream of text chunks. `hangAfter`
// sends that many chunks and then never ends; `gate` holds every chunk after
// the first until it resolves.
interface Reply {
  readonly status?: 429
  readonly retryAfter?: string
  readonly chunks?: ReadonlyArray<string>
  readonly hangAfter?: number
  readonly gate?: Promise<void>
  readonly pauseMs?: number
}

// A Chat Completions endpoint that answers request n from script[n], the last
// reply repeating, and counts the requests it was sent.
const provider = (script: ReadonlyArray<Reply>, asked: { n: number }) =>
  (async () => {
    const reply = script[Math.min(asked.n++, script.length - 1)]!
    if (reply.status === 429) {
      return new Response(JSON.stringify({ error: { message: "slow down", type: "rate_limit_error" } }), {
        status: 429, headers: { "content-type": "application/json", "retry-after": reply.retryAfter ?? "0" }
      })
    }
    const chunks = reply.chunks ?? []
    return new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const [i, text] of chunks.entries()) {
          if (reply.hangAfter !== undefined && i >= reply.hangAfter) return
          if (i === 1 && reply.gate !== undefined) await reply.gate
          if (i === 1 && reply.pauseMs !== undefined) await new Promise((resolve) => setTimeout(resolve, reply.pauseMs))
          controller.enqueue(chunk({ content: text }))
        }
        if (reply.hangAfter !== undefined) return
        controller.enqueue(chunk({}, "stop"))
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      }
    }), { headers: { "content-type": "text/event-stream" } })
  }) as unknown as typeof globalThis.fetch

// What the task body sees as the stream arrives.
interface ObserverShape {
  readonly part: (text: string) => Effect.Effect<void>
  readonly after: Effect.Effect<void>
}
const Observer = Context.Service<ObserverShape>("test/Model/StreamObserver")
const watching = (seen: Array<string>, options: { readonly onPart?: (text: string) => void; readonly dieAfter?: Deferred.Deferred<void> } = {}) =>
  Layer.succeed(Observer, {
    part: (text) => Effect.sync(() => (seen.push(text), options.onPart?.(text))),
    after: options.dieAfter === undefined ? Effect.void : Effect.andThen(Deferred.succeed(options.dieAfter, void 0), Effect.never)
  })

const Stream_ = Durable.task("test#StreamAsk", { payload: { prompt: Schema.String }, success: Schema.String, error: AiError.AiError })
const Flow = Workflow.make("test#StreamFlow", {
  payload: { id: Schema.String },
  success: Schema.String,
  error: AiError.AiError,
  idempotencyKey: ({ id }) => id
})

const model = Model.compatible({ id: "local", baseUrl: "https://models.example/v1", model: "m", apiKey: "OPENAI_API_KEY" })
const keys = ConfigProvider.layer(ConfigProvider.fromEnv({ env: { OPENAI_API_KEY: "sk-test" } }))

const flowLayer = (store: Durable.Store, observer: Layer.Layer<Context.Service.Identifier<typeof Observer>>) =>
  Flow.toLayer(({ id }) => Stream_({ prompt: id })).pipe(
    Layer.provide(Stream_.toLayer(({ prompt }) =>
      Effect.gen(function*() {
        const watch = yield* Effect.service(Observer)
        let text = ""
        yield* Stream.runForEach(LanguageModel.streamText({ prompt }), (part) =>
          part.type === "text-delta" ? Effect.andThen(Effect.sync(() => (text += part.delta)), watch.part(part.delta)) : Effect.void)
        yield* watch.after
        return text
      })
    )),
    Layer.provide(model),
    Layer.provide(observer),
    Layer.provideMerge(Durable.layerStore(store))
  )

// One process: runs the flow until it ends, or until `died` resolves, when
// the process stops and its engine goes with it.
const process = (
  store: Durable.Store,
  id: string,
  fetch: typeof globalThis.fetch,
  observer: Layer.Layer<Context.Service.Identifier<typeof Observer>>,
  died: Deferred.Deferred<void> = Effect.runSync(Deferred.make<void>())
) =>
  Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Effect.exit(Flow.execute({ id }).pipe(
      Effect.provide(flowLayer(store, observer)),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provide(keys)
    )))
    const ended = yield* Effect.raceFirst(Effect.as(Deferred.await(died), "died" as const), Fiber.join(fiber))
    if (ended === "died") yield* Fiber.interrupt(fiber)
    return ended
  }).pipe(Effect.timeout(Duration.seconds(20))))

const fresh = () => Effect.runSync(Deferred.make<void>())

test("a streamed call in a task reaches the caller part by part, and a resumed run replays its recorded parts", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  // The provider sends its second chunk only once the task has seen the
  // first, so a stream held back until the call ends would never finish.
  let open!: () => void
  const gate = new Promise<void>((resolve) => (open = resolve))
  const seen: Array<string> = []
  const died = fresh()
  const first = await process(store, "a", provider([{ chunks: ["one ", "two ", "three"], gate }], asked), watching(seen, {
    onPart: () => open(),
    dieAfter: died
  }), died)
  expect(first).toBe("died")
  expect(seen).toEqual(["one ", "two ", "three"])
  // The process died after the stream was recorded: the resumed run reads
  // the same parts and asks nothing.
  const replayed: Array<string> = []
  expect(await process(store, "a", provider([{ chunks: ["other"] }], asked), watching(replayed))).toEqual(Exit.succeed("one two three"))
  expect(replayed).toEqual(["one ", "two ", "three"])
  expect(asked.n).toBe(1)
})

test("a run stopped part way through a stream asks again when it resumes", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const seen: Array<string> = []
  const died = fresh()
  const fetch = provider([{ chunks: ["half", "rest"], hangAfter: 1 }, { chunks: ["whole ", "answer"] }], asked)
  expect(await process(store, "b", fetch, watching(seen, { onPart: () => Effect.runSync(Deferred.succeed(died, void 0)) }), died)).toBe("died")
  expect(seen).toEqual(["half"])
  const resumed: Array<string> = []
  expect(await process(store, "b", fetch, watching(resumed))).toEqual(Exit.succeed("whole answer"))
  expect(resumed).toEqual(["whole ", "answer"])
  expect(asked.n).toBe(2)
})

test("a stream refused for capacity before its first part parks the run, then streams", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const seen: Array<string> = []
  const exit = await process(store, "c", provider([{ status: 429 }, { chunks: ["after ", "park"] }], asked), watching(seen))
  expect(exit).toEqual(Exit.succeed("after park"))
  expect(seen).toEqual(["after ", "park"])
  expect(asked.n).toBe(2)
})

test("a stream parked before its first part suspends its run, even when the task handles stream failures", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const Guarded = Durable.task("test#GuardedStream", { payload: { prompt: Schema.String }, success: Schema.String })
  const Outer = Workflow.make("test#GuardedFlow", { payload: { id: Schema.String }, success: Schema.String, idempotencyKey: ({ id }) => id })
  const layer = Outer.toLayer(({ id }) => Guarded({ prompt: id })).pipe(
    Layer.provide(Guarded.toLayer(({ prompt }) =>
      Effect.map(
        Effect.exit(Stream.runCollect(LanguageModel.streamText({ prompt }))),
        (exit) => Exit.isSuccess(exit) ? Array.from(exit.value).flatMap((part) => part.type === "text-delta" ? [part.delta] : []).join("") : "fallback"
      )
    )),
    Layer.provide(model),
    Layer.provideMerge(Durable.layerStore(store))
  )
  const fetch = provider([{ status: 429, retryAfter: "1" }, { chunks: ["after ", "park"] }], asked)
  const exit = await Effect.runPromise(Effect.exit(Outer.execute({ id: "g" }).pipe(
    Effect.provide(layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
    Effect.provide(keys),
    Effect.timeout(Duration.seconds(20))
  )))
  expect(exit).toEqual(Exit.succeed("after park"))
  expect(asked.n).toBe(2)
})

test("a caller that stops reading a stream early still leaves the whole call recorded", async () => {
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const First = Durable.task("test#FirstPart", { payload: { prompt: Schema.String }, success: Schema.String, error: AiError.AiError })
  const Outer = Workflow.make("test#FirstPartFlow", { payload: { id: Schema.String }, success: Schema.String, error: AiError.AiError, idempotencyKey: ({ id }) => id })
  const layer = (died?: Deferred.Deferred<void>) =>
    Outer.toLayer(({ id }) =>
      Effect.gen(function*() {
        const first = yield* First({ prompt: id })
        if (died !== undefined) yield* Effect.andThen(Deferred.succeed(died, void 0), Effect.never)
        return first
      })
    ).pipe(
      Layer.provide(First.toLayer(({ prompt }) =>
        Effect.map(
          Stream.runCollect(LanguageModel.streamText({ prompt }).pipe(Stream.filter((part) => part.type === "text-delta"), Stream.take(1))),
          (parts) => Array.from(parts).map((part) => (part as { delta: string }).delta).join("")
        )
      )),
      Layer.provide(model),
      Layer.provideMerge(Durable.layerStore(store))
    )
  const once = (fetch: typeof globalThis.fetch, died?: Deferred.Deferred<void>) =>
    Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Effect.exit(Outer.execute({ id: "t" }).pipe(
        Effect.provide(layer(died)),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.provide(keys)
      )))
      if (died === undefined) return yield* Fiber.join(fiber)
      yield* Deferred.await(died)
      yield* Fiber.interrupt(fiber)
      return "died"
    }).pipe(Effect.timeout(Duration.seconds(20))))
  // The task returns after one part; the process dies after the task is
  // recorded, so the resumed run replays the task and asks nothing.
  // The provider pauses after the first part, so the caller stops reading
  // while the call is still running.
  expect(await once(provider([{ chunks: ["first ", "second"], pauseMs: 300 }], asked), fresh())).toBe("died")
  expect(await once(provider([{ chunks: ["other"] }], asked))).toEqual(Exit.succeed("first "))
  expect(asked.n).toBe(1)
  // Within the task: the cut-short call itself is a completed model step.
  const run = await Effect.runPromise(Outer.executionId({ id: "t" }))
  const history = await Effect.runPromise(Stream.runCollect(Durable.history(run)).pipe(Effect.provide(Durable.layerStore(store))))
  const steps = Array.from(history).filter((entry) => entry.eventType === "StepCompleted").map((entry) => (entry.payload as { step: string }).step)
  expect(steps.filter((step) => /(^|\/)model\/[0-9a-f]+\/1$/.test(step))).toHaveLength(1)
})

test("a streamed call with a toolkit is recorded too, and replays its parts", async () => {
  const Echo = Tool.make("Echo", { parameters: Schema.Struct({ text: Schema.String }), success: Schema.String })
  const Tools = Toolkit.make(Echo)
  const store = Durable.makeMemoryStore()
  const asked = { n: 0 }
  const WithTools = Durable.task("test#StreamWithTools", { payload: { prompt: Schema.String }, success: Schema.String, error: AiError.AiError })
  const Outer = Workflow.make("test#StreamWithToolsFlow", { payload: { id: Schema.String }, success: Schema.String, error: AiError.AiError, idempotencyKey: ({ id }) => id })
  const layer = (died?: Deferred.Deferred<void>) =>
    Outer.toLayer(({ id }) => WithTools({ prompt: id })).pipe(
      Layer.provide(WithTools.toLayer(({ prompt }) =>
        Stream.runCollect(LanguageModel.streamText({ prompt, toolkit: Tools })).pipe(
          Effect.map((parts) => Array.from(parts).flatMap((part) => part.type === "text-delta" ? [part.delta] : []).join("")),
          Effect.tap(() => died === undefined ? Effect.void : Effect.andThen(Deferred.succeed(died, void 0), Effect.never))
        )
      )),
      Layer.provide(Tools.toLayer({ Echo: ({ text }) => Effect.succeed(text) })),
      Layer.provide(model),
      Layer.provideMerge(Durable.layerStore(store))
    )
  const once = (fetch: typeof globalThis.fetch, died?: Deferred.Deferred<void>) =>
    Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Effect.exit(Outer.execute({ id: "k" }).pipe(
        Effect.provide(layer(died)),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.provide(keys)
      )))
      if (died === undefined) return yield* Fiber.join(fiber)
      yield* Deferred.await(died)
      yield* Fiber.interrupt(fiber)
      return "died"
    }).pipe(Effect.timeout(Duration.seconds(20))))
  // The process dies inside the task after the stream, before the task is
  // recorded: the resumed run replays the recorded stream and asks nothing.
  expect(await once(provider([{ chunks: ["with ", "tools"] }], asked), fresh())).toBe("died")
  expect(await once(provider([{ chunks: ["other"] }], asked))).toEqual(Exit.succeed("with tools"))
  expect(asked.n).toBe(1)
})

test("a recorded call that may no longer park fails on a refusal it would otherwise wait out", async () => {
  const Probe = Workflow.make("test#ParkableProbe", {
    payload: { parkable: Schema.Boolean },
    success: Schema.Number,
    error: AiError.AiError,
    idempotencyKey: ({ parkable }) => String(parkable)
  })
  const run = (parkable: boolean) => {
    let calls = 0
    const step = () =>
      Effect.suspend(() =>
        ++calls === 1
          ? Effect.fail(AiError.make({ module: "Test", method: "stream", reason: new AiError.RateLimitError({ retryAfter: Duration.zero }) }))
          : Effect.succeed(calls)
      )
    const layer = Probe.toLayer(({ parkable }) =>
      Effect.gen(function*() {
        const instance = yield* WorkflowEngine.WorkflowInstance
        return yield* record.parked("probe", instance, "same", step, () => parkable)
      })
    ).pipe(Layer.provideMerge(Durable.memory))
    return Effect.runPromise(Effect.exit(Probe.execute({ parkable }).pipe(Effect.provide(layer)))).then((exit) => ({ exit, calls }))
  }
  const waits = await run(true)
  expect(waits.exit).toEqual(Exit.succeed(2))
  const refuses = await run(false)
  expect(Exit.isFailure(refuses.exit)).toBe(true)
  expect(refuses.calls).toBe(1)
})

test("property: a replayed stream delivers exactly the parts the live stream delivered", async () => {
  await checkProperty(fc, {
    name: "experimental-model-stream-replay",
    rule: "VIP-62 rule 6: inside a task a streamed call is a recorded step; a resumed run reads the recorded answer",
    command: "cd packages/runtime && bun test tests/model-stream-record.test.ts",
    numRuns: 25,
    arbitrary: fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 6 }),
    check: async (chunks: ReadonlyArray<string>) => {
      const store = Durable.makeMemoryStore()
      const asked = { n: 0 }
      const live: Array<string> = []
      const died = fresh()
      expect(await process(store, "p", provider([{ chunks }], asked), watching(live, { dieAfter: died }), died)).toBe("died")
      const replayed: Array<string> = []
      expect(await process(store, "p", provider([{ chunks: ["never"] }], asked), watching(replayed))).toEqual(Exit.succeed(chunks.join("")))
      expect(replayed).toEqual(live)
      expect(live.join("")).toBe(chunks.join(""))
      expect(asked.n).toBe(1)
    }
  })
})
