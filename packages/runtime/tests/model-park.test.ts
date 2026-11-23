import { expect, test } from "bun:test"
import fc from "fast-check"
import { ConfigProvider, DateTime, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { AiError, Decision, DecisionModel, LanguageModel } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { Activity, Workflow, WorkflowEngine } from "effect/workflow"
import { Durable, Model } from "vibelang-runtime/experimental"
import * as quota from "../dist/experimental/internal/quota.js"
import * as record from "../dist/experimental/internal/record.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// One scripted provider answer: a refusal with its status and Retry-After, or
// an answer.
type Reply =
  | { readonly status: 429; readonly retryAfter?: string }
  | { readonly status: 503 }
  | { readonly status: 200 }

// An Anthropic Messages endpoint that answers from `script` in order and
// records when each request arrived.
const provider = (script: ReadonlyArray<Reply>, asked: Array<number>) =>
  (async () => {
    asked.push(Date.now())
    const reply = script[Math.min(asked.length, script.length) - 1]!
    if (reply.status === 200) {
      return new Response(JSON.stringify({
        id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5",
        content: [{ type: "text", text: "answered" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }
      }), { headers: { "content-type": "application/json" } })
    }
    const type = reply.status === 429 ? "rate_limit_error" : "api_error"
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (reply.status === 429 && reply.retryAfter !== undefined) headers["retry-after"] = reply.retryAfter
    return new Response(JSON.stringify({ type: "error", error: { type, message: "refused" } }), { status: reply.status, headers })
  }) as unknown as typeof globalThis.fetch

const Ask = Durable.task("test#ParkAsk", { payload: { prompt: Schema.String }, success: Schema.String, error: AiError.AiError })
const Flow = Workflow.make("test#ParkFlow", {
  payload: { id: Schema.String },
  success: Schema.String,
  error: AiError.AiError,
  idempotencyKey: ({ id }) => id
})

const flowLayer = (store: Durable.Store, model: Layer.Layer<LanguageModel.LanguageModel, Model.ModelUnresolved>) =>
  Flow.toLayer(({ id }) => Ask({ prompt: id })).pipe(
    Layer.provide(Ask.toLayer(({ prompt }) => Effect.map(LanguageModel.generateText({ prompt }), (response) => response.text))),
    Layer.provide(model),
    Layer.provideMerge(Durable.layerStore(store))
  )

const keys = ConfigProvider.layer(ConfigProvider.fromEnv({
  env: { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-test", AI_GATEWAY_API_KEY: "vck-test" }
}))

// One process: runs the flow until it ends, or until `stopAfterMs` passes,
// when the process stops and its engine goes with it.
const process = (
  store: Durable.Store,
  id: string,
  fetch: typeof globalThis.fetch,
  options: { readonly stopAfterMs?: number; readonly model?: Layer.Layer<LanguageModel.LanguageModel, Model.ModelUnresolved> } = {}
) =>
  Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Effect.exit(Flow.execute({ id }).pipe(
      Effect.provide(flowLayer(store, options.model ?? Model.use("anthropic:claude-sonnet-5-5"))),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provide(keys)
    )))
    if (options.stopAfterMs === undefined) return yield* Fiber.join(fiber)
    const ended = yield* Effect.raceFirst(
      Effect.as(Effect.sleep(options.stopAfterMs), "stopped" as const),
      Fiber.join(fiber)
    )
    if (ended === "stopped") yield* Fiber.interrupt(fiber)
    return ended
  }))

const reasonOf = (exit: unknown): string | undefined => {
  if (exit === "stopped" || !Exit.isExit(exit) || Exit.isSuccess(exit)) return undefined
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  return error && AiError.isAiError((error as { error: unknown }).error)
    ? ((error as { error: AiError.AiError }).error).reason._tag
    : String(exit.cause)
}

const steps = async (store: Durable.Store, id: string) => {
  const run = await Effect.runPromise(Flow.executionId({ id }))
  const history = await Effect.runPromise(Stream.runCollect(Durable.history(run)).pipe(Effect.provide(Durable.layerStore(store))))
  return Array.from(history).filter((entry) => entry.eventType === "StepCompleted").map((entry) => entry.payload as { step: string; result?: unknown })
}

test("a rate limit naming Retry-After parks a durable run, which asks again when the window reopens", async () => {
  const store = Durable.makeMemoryStore()
  const asked: Array<number> = []
  const exit = await process(store, "a", provider([{ status: 429, retryAfter: "1" }, { status: 200 }], asked))
  expect(exit).toEqual(Exit.succeed("answered"))
  expect(asked).toHaveLength(2)
  expect(asked[1]! - asked[0]!).toBeGreaterThanOrEqual(1000)
  // The park is a recorded step that names its wake time and its source.
  const parks = (await steps(store, "a")).filter((step) => /(^|\/)model\/[0-9a-f]+\/1\/park$/.test(step.step))
  expect(parks).toHaveLength(1)
  expect(JSON.stringify(parks[0])).toContain("retry-after")
})

test("a run stopped while parked resumes into the same window and asks once more", async () => {
  const store = Durable.makeMemoryStore()
  const asked: Array<number> = []
  const fetch = provider([{ status: 429, retryAfter: "3" }, { status: 200 }], asked)
  expect(await process(store, "b", fetch, { stopAfterMs: 1500 })).toBe("stopped")
  expect(asked).toHaveLength(1)
  // The park is a durable wait: the stored run is suspended, not running.
  const run = await Effect.runPromise(Flow.executionId({ id: "b" }))
  const suspended = await Effect.runPromise(
    Stream.runCollect(Durable.runs({ status: "suspended" })).pipe(Effect.provide(Durable.layerStore(store)))
  )
  expect(Array.from(suspended).map((row) => row.run)).toContain(run)
  expect(await process(store, "b", fetch)).toEqual(Exit.succeed("answered"))
  expect(asked).toHaveLength(2)
  // The resumed run waits out the recorded deadline, not a new three seconds
  // from the restart, and does not ask the refused request again.
  const waited = asked[1]! - asked[0]!
  expect(waited).toBeGreaterThanOrEqual(3000)
  expect(waited).toBeLessThan(4400)
})

test("outside a durable run a rate limit fails the call at once", async () => {
  const asked: Array<number> = []
  const exit = await Effect.runPromise(Effect.exit(LanguageModel.generateText({ prompt: "x" }).pipe(
    Effect.provide(Model.use("anthropic:claude-sonnet-5-5")),
    Effect.provideService(FetchHttpClient.Fetch, provider([{ status: 429, retryAfter: "1" }], asked)),
    Effect.provide(keys)
  )))
  expect(reasonOf(exit)).toBe("RateLimitError")
  expect(asked).toHaveLength(1)
})

test("a window over an hour is not waited out: the step fails on the first refusal", async () => {
  const store = Durable.makeMemoryStore()
  const asked: Array<number> = []
  const exit = await process(store, "c", provider([{ status: 429, retryAfter: "7200" }, { status: 200 }], asked))
  expect(reasonOf(exit)).toBe("RateLimitError")
  expect(asked).toHaveLength(1)
})

test("an exhausted quota that names no reset time fails at once", async () => {
  const store = Durable.makeMemoryStore()
  let asked = 0
  const fetch = (async () => {
    asked++
    return new Response(JSON.stringify({ error: { type: "insufficient_quota", code: "insufficient_quota", message: "out of credit" } }), {
      status: 429, headers: { "content-type": "application/json" }
    })
  }) as unknown as typeof globalThis.fetch
  const model = Model.compatible({ id: "local", baseUrl: "https://models.example/v1", model: "m", apiKey: "OPENAI_API_KEY" })
  const exit = await process(store, "d", fetch, { model })
  expect(reasonOf(exit)).toBe("QuotaExhaustedError")
  expect(asked).toBe(1)
})

test("one call parks at most eight times, then its refusal fails the step", async () => {
  const store = Durable.makeMemoryStore()
  const asked: Array<number> = []
  const exit = await process(store, "e", provider([{ status: 429, retryAfter: "0" }], asked))
  expect(reasonOf(exit)).toBe("RateLimitError")
  expect(asked).toHaveLength(quota.maxParks + 1)
})

test("a decision refused for capacity parks the same way", async () => {
  const store = Durable.makeMemoryStore()
  let asked = 0
  const gateway = (async () => {
    asked++
    return asked === 1
      ? new Response("busy", { status: 429, headers: { "retry-after": "0" } })
      : new Response(JSON.stringify({ answers: { urgent: { type: "boolean", probability: 0.25 } } }), {
        headers: { "content-type": "application/json" }
      })
  }) as unknown as typeof globalThis.fetch
  const Urgent = Decision.make({ input: Schema.String, decisions: { urgent: Decision.probability({ instructions: "Is it urgent?" }) } })
  const layer = Flow.toLayer(({ id }) =>
    Effect.map(DecisionModel.decide(Urgent, { input: id }), (decided) => String(decided.answers.urgent.probability))
  ).pipe(Layer.provide(Model.decide()), Layer.provideMerge(Durable.layerStore(store)))
  const exit = await Effect.runPromise(Effect.exit(Flow.execute({ id: "f" }).pipe(
    Effect.provide(layer),
    Effect.provideService(FetchHttpClient.Fetch, gateway),
    Effect.provide(keys)
  )))
  expect(exit).toEqual(Exit.succeed("0.25"))
  expect(asked).toBe(2)
})

test("a resumed run follows the recorded park decision, not the state it resumes in", async () => {
  // The first run may not park (a stream that had delivered a part), so it
  // records that and carries on; the resumed run could park, but it reads the
  // recorded decision and asks nothing.
  const store = Durable.makeMemoryStore()
  const Probe = Workflow.make("test#ParkDecision", { payload: { id: Schema.String }, success: Schema.String, idempotencyKey: ({ id }) => id })
  let calls = 0
  const refused = AiError.make({ module: "Test", method: "call", reason: new AiError.RateLimitError({ retryAfter: Duration.zero }) })
  const run = (parkable: boolean, died?: Deferred.Deferred<void>) =>
    Effect.runPromise(Effect.gen(function*() {
      const layer = Probe.toLayer(() =>
        Effect.gen(function*() {
          const instance = yield* WorkflowEngine.WorkflowInstance
          const step = (name: string) =>
            Activity.make({ name, success: Schema.Number, error: AiError.AiError, execute: Effect.suspend(() => (calls++, Effect.fail(refused))) })
          const outcome = yield* Effect.result(record.parked("probe", instance, "same", step, () => parkable))
          if (died !== undefined) yield* Effect.andThen(Deferred.succeed(died, void 0), Effect.never)
          return outcome._tag
        })
      ).pipe(Layer.provideMerge(Durable.layerStore(store)))
      const fiber = yield* Effect.forkChild(Probe.execute({ id: "x" }).pipe(Effect.provide(layer)))
      if (died === undefined) return yield* Fiber.join(fiber)
      yield* Deferred.await(died)
      yield* Fiber.interrupt(fiber)
      return "died"
    }))
  expect(await run(false, Effect.runSync(Deferred.make<void>()))).toBe("died")
  expect(calls).toBe(1)
  expect(await run(true)).toBe("Failure")
  expect(calls).toBe(1)
})

const reasonArbitrary = fc.oneof(
  fc.record({ tag: fc.constant("RateLimitError" as const), afterMs: fc.option(fc.integer({ min: 0, max: 3 * 3_600_000 })) }),
  fc.record({ tag: fc.constant("QuotaExhaustedError" as const), resetInMs: fc.option(fc.integer({ min: -3_600_000, max: 3 * 3_600_000 })) }),
  fc.record({ tag: fc.constantFrom("InternalProviderError" as const, "NetworkError" as const, "AuthenticationError" as const) })
)

test("property: a park is only ever a capacity refusal's window, at most an hour away", async () => {
  await checkProperty(fc, {
    name: "experimental-model-quota-park",
    rule: "VIP-62 rule 9: a provider refusal that names a reset time parks a durable run until then",
    command: "cd packages/runtime && bun test tests/model-park.test.ts",
    numRuns: 200,
    arbitrary: fc.record({ now: fc.integer({ min: 0, max: 2 ** 41 }), reason: reasonArbitrary }),
    check: ({ now, reason }: { readonly now: number; readonly reason: any }) => {
      const made = reason.tag === "RateLimitError"
        ? new AiError.RateLimitError(reason.afterMs === null ? {} : { retryAfter: Duration.millis(reason.afterMs) })
        : reason.tag === "QuotaExhaustedError"
        ? new AiError.QuotaExhaustedError(reason.resetInMs === null ? {} : { resetAt: DateTime.makeUnsafe(now + reason.resetInMs) })
        : reason.tag === "InternalProviderError"
        ? new AiError.InternalProviderError({ description: "x" })
        : reason.tag === "NetworkError"
        ? new AiError.NetworkError({ reason: "TransportError", method: "POST", url: "https://x" })
        : new AiError.AuthenticationError({ kind: "InvalidKey" })
      const park = quota.classify(AiError.make({ module: "Test", method: "call", reason: made }), now)
      // The oracle, from the rule: a rate limit is a window (named, or a
      // minute when it names none); an exhausted quota is one only when it
      // names its reset; nothing else is; and no window is over an hour.
      const expected = reason.tag === "RateLimitError"
        ? reason.afterMs === null
          ? { wakeAt: now + quota.defaultWaitMillis, source: "default" }
          : { wakeAt: now + reason.afterMs, source: "retry-after" }
        : reason.tag === "QuotaExhaustedError" && reason.resetInMs !== null
        ? { wakeAt: now + reason.resetInMs, source: "reset" }
        : null
      expect(park).toEqual(expected === null || expected.wakeAt - now > quota.maxWaitMillis ? null : expected)
      // Not an AiError at all: never a park.
      expect(quota.classify(made, now)).toBeNull()
    }
  })
})

test("property: a durable call is asked once per refusal it parks on, up to the bound, and fails on any other", async () => {
  await checkProperty(fc, {
    name: "experimental-model-park-sequence",
    rule: "VIP-62 rule 9: a quota parks a durable run instead of failing it",
    command: "cd packages/runtime && bun test tests/model-park.test.ts",
    numRuns: 15,
    arbitrary: fc.array(fc.constantFrom<Reply>({ status: 429, retryAfter: "0" }, { status: 503 }, { status: 200 }), { minLength: 1, maxLength: 12 }),
    check: async (script: ReadonlyArray<Reply>) => {
      const store = Durable.makeMemoryStore()
      const asked: Array<number> = []
      const exit = await process(store, "p", provider(script, asked))
      // The oracle walks the script: each 429 parks until the bound, a 503
      // fails, a 200 answers; past the script the last reply repeats.
      let n = 0
      let outcome: string = "answered"
      for (let parks = 0; ; parks++) {
        const reply = script[Math.min(n, script.length - 1)]!
        n++
        if (reply.status === 200) break
        if (reply.status === 503) { outcome = "InternalProviderError"; break }
        if (parks >= quota.maxParks) { outcome = "RateLimitError"; break }
      }
      expect(asked).toHaveLength(n)
      expect(outcome === "answered" ? exit : reasonOf(exit)).toEqual(outcome === "answered" ? Exit.succeed("answered") : outcome)
    }
  })
})
