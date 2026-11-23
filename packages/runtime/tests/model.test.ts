import { expect, test } from "bun:test"
import fc from "fast-check"
import { ConfigProvider, Effect, Exit, Layer, Schema, Stream } from "effect"
import { AiError, EmbeddingModel, LanguageModel, type Response } from "effect/ai"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"
import { Model } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

interface Sent {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: any
}

// A provider over fetch: it answers each request with the body `reply`
// returns, and records what it was sent.
const provider = (reply: (sent: Sent) => Response | Promise<Response>) => {
  const sent: Array<Sent> = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const text = await request.text()
    const entry = {
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body: text === "" ? undefined : JSON.parse(text)
    }
    sent.push(entry)
    return reply(entry)
  }) as typeof globalThis.fetch
  return { sent, fetch }
}

// Effect's Anthropic client adds a `beta` query parameter.
const endpoint = (url: string) => {
  const parsed = new URL(url)
  return parsed.origin + parsed.pathname
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const anthropicMessage = (text: string) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 3 }
})

const chatCompletion = (text: string) => ({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "llama3:8b",
  choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
})

const responsesReply = (text: string) => ({
  id: "resp_1",
  object: "response",
  created_at: 1,
  status: "completed",
  model: "gpt-6.1-sol",
  output: [{
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }]
  }],
  usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 }
})

const env = (values: Record<string, string>) => ConfigProvider.layer(ConfigProvider.fromEnv({ env: values }))

const run = <A, E>(
  effect: Effect.Effect<A, E, LanguageModel.LanguageModel>,
  layer: Layer.Layer<LanguageModel.LanguageModel, Model.ModelUnresolved>,
  fetch: typeof globalThis.fetch,
  values: Record<string, string> = {}
) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provide(env(values))
    )
  )

const failure = <A, E>(exit: Exit.Exit<A, E>): E => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure, got " + JSON.stringify(exit.value))
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  if (error === undefined) throw new Error("expected a typed failure: " + String(exit.cause))
  return (error as { readonly error: E }).error
}

const key = "sk-ant-test-0123456789"

test("an anthropic seat answers through Effect's Anthropic client with the key from config", async () => {
  const { sent, fetch } = provider(() => json(anthropicMessage("Hello")))
  const exit = await run(
    LanguageModel.generateText({ prompt: "Say hello" }),
    Model.use("anthropic:claude-sonnet-5-5"),
    fetch,
    { ANTHROPIC_API_KEY: key }
  )
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("Hello")
  expect(sent).toHaveLength(1)
  expect(endpoint(sent[0].url)).toBe("https://api.anthropic.com/v1/messages")
  expect(sent[0].headers["x-api-key"]).toBe(key)
  expect(sent[0].body.model).toBe("claude-sonnet-5-5")
})

test("generateObject decodes the answer with the program's schema", async () => {
  const Label = Schema.Struct({ type: Schema.Literals(["bug", "feature", "question", "chore"]) })
  const { fetch } = provider(() => json(anthropicMessage(JSON.stringify({ type: "bug" }))))
  const exit = await run(
    Effect.map(LanguageModel.generateObject({ prompt: "Label: Crash on start", schema: Label }), (r) => r.value),
    Model.use("anthropic:claude-sonnet-5-5"),
    fetch,
    { ANTHROPIC_API_KEY: key }
  )
  expect(Exit.isSuccess(exit) && exit.value).toEqual({ type: "bug" })
})

test("an answer the schema refuses fails with AiError", async () => {
  const Label = Schema.Struct({ type: Schema.Literals(["bug", "feature"]) })
  const { fetch } = provider(() => json(anthropicMessage(JSON.stringify({ type: "poem" }))))
  const exit = await run(
    LanguageModel.generateObject({ prompt: "Label", schema: Label }),
    Model.use("anthropic:claude-sonnet-5-5"),
    fetch,
    { ANTHROPIC_API_KEY: key }
  )
  expect(AiError.isAiError(failure(exit))).toBe(true)
})

test("an openai seat speaks Responses", async () => {
  const { sent, fetch } = provider(() => json(responsesReply("Hi")))
  const exit = await run(
    LanguageModel.generateText({ prompt: "hi" }),
    Model.use("openai:gpt-6.1-sol"),
    fetch,
    { OPENAI_API_KEY: "sk-openai" }
  )
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("Hi")
  expect(sent[0].url).toBe("https://api.openai.com/v1/responses")
  expect(sent[0].headers.authorization).toBe("Bearer sk-openai")
  expect(sent[0].body.model).toBe("gpt-6.1-sol")
})

test("a compatible-provider row speaks Chat Completions at its base URL", async () => {
  const { sent, fetch } = provider(() => json(chatCompletion("Yo")))
  const exit = await run(
    LanguageModel.generateText({ prompt: "hi" }),
    Model.use("cerebras:qwen-3.8-27b"),
    fetch,
    { CEREBRAS_API_KEY: "csk" }
  )
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("Yo")
  expect(sent[0].url).toBe("https://api.cerebras.ai/v1/chat/completions")
  expect(sent[0].headers.authorization).toBe("Bearer csk")
})

test("Model.compatible defaults to Chat Completions and sends no key when it names none", async () => {
  const { sent, fetch } = provider(() => json(chatCompletion("local")))
  const exit = await run(
    LanguageModel.generateText({ prompt: "hi" }),
    Model.compatible({ id: "ollama", baseUrl: "http://localhost:11434/v1", model: "llama3:8b" }),
    fetch
  )
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("local")
  expect(sent[0].url).toBe("http://localhost:11434/v1/chat/completions")
  expect(sent[0].headers.authorization).toBeUndefined()
  expect(sent[0].body.model).toBe("llama3:8b")
})

test("Model.compatible with protocol responses speaks Responses and reads its key variable", async () => {
  const { sent, fetch } = provider(() => json(responsesReply("r")))
  const exit = await run(
    LanguageModel.generateText({ prompt: "hi" }),
    Model.compatible({ id: "local", baseUrl: "http://127.0.0.1:9/v1", model: "m", apiKey: "LOCAL_KEY", protocol: "responses" }),
    fetch,
    { LOCAL_KEY: "lk" }
  )
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("r")
  expect(sent[0].url).toBe("http://127.0.0.1:9/v1/responses")
  expect(sent[0].headers.authorization).toBe("Bearer lk")
})

test("a program's own HttpClient wins over fetch", async () => {
  const { fetch } = provider(() => json(anthropicMessage("from fetch")))
  const seen: Array<string> = []
  const client = HttpClient.make((request) => {
    seen.push(request.url)
    return Effect.succeed(HttpClientResponse.fromWeb(request, json(anthropicMessage("from client"))))
  })
  const exit = await run(
    LanguageModel.generateText({ prompt: "hi" }),
    Model.use("anthropic:claude-sonnet-5-5").pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client))),
    fetch,
    { ANTHROPIC_API_KEY: key }
  )
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("from client")
  expect(seen.map(endpoint)).toEqual(["https://api.anthropic.com/v1/messages"])
})

test("a refusing provider fails the call with AiError, not a defect, and the key is not in it", async () => {
  const { fetch } = provider(() =>
    json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529)
  )
  const exit = await run(
    LanguageModel.generateText({ prompt: "hi" }),
    Model.use("anthropic:claude-sonnet-5-5"),
    fetch,
    { ANTHROPIC_API_KEY: key }
  )
  const error = failure(exit)
  expect(AiError.isAiError(error)).toBe(true)
  expect(JSON.stringify(error) + String(error)).not.toContain(key)
})

test("a transport that throws fails the call with AiError", async () => {
  const fetch = (() => Promise.reject(new TypeError("connection refused"))) as unknown as typeof globalThis.fetch
  const exit = await run(
    LanguageModel.generateText({ prompt: "hi" }),
    Model.use("anthropic:claude-sonnet-5-5"),
    fetch,
    { ANTHROPIC_API_KEY: key }
  )
  expect(AiError.isAiError(failure(exit))).toBe(true)
})

const unresolved = async (seat: string, values: Record<string, string> = {}) => {
  const { sent, fetch } = provider(() => json(anthropicMessage("never")))
  const error = failure(await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(seat), fetch, values))
  expect(sent).toHaveLength(0)
  return error as Model.ModelUnresolved
}

test("an unknown, malformed or keyless seat fails when the layer is built, before any request", async () => {
  expect(await unresolved("claude-sonnet-5-5")).toMatchObject({ _tag: "ModelUnresolved", reason: "Malformed" })
  expect(await unresolved("anthropic:")).toMatchObject({ reason: "Malformed" })
  expect(await unresolved("acme:model-1")).toMatchObject({ reason: "UnknownProvider", seat: "acme:model-1" })
  expect(await unresolved("toString:x")).toMatchObject({ reason: "Malformed" })
  expect(await unresolved("constructor:x")).toMatchObject({ reason: "UnknownProvider" })
  const missing = await unresolved("anthropic:claude-sonnet-5-5")
  expect(missing).toMatchObject({ reason: "MissingKey" })
  expect(missing.message).toContain("ANTHROPIC_API_KEY")
})

test("a seat splits at its first colon", async () => {
  expect(await Effect.runPromise(Model.parse("ollama:llama3:8b"))).toEqual({ provider: "ollama", model: "llama3:8b" })
})

const providerName = fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/)
const modelId = fc.stringMatching(/^\S{1,24}$/)

test("property: every seat either resolves or fails with ModelUnresolved before any request", async () => {
  await checkProperty(fc, {
    name: "experimental-model-seat-resolution",
    rule: "VIP-62 rules 1 and 3: a seat is provider:modelId; an unknown seat fails when the layer is built",
    command: "cd packages/runtime && bun test tests/model.test.ts",
    arbitrary: fc.oneof(
      fc.record({ seat: fc.tuple(providerName, modelId).map(([p, m]) => `${p}:${m}`), keyed: fc.boolean() }),
      fc.record({ seat: fc.tuple(fc.constantFrom(...Object.keys(Model.providers)), modelId).map(([p, m]) => `${p}:${m}`), keyed: fc.boolean() }),
      fc.record({ seat: fc.string({ maxLength: 30 }), keyed: fc.boolean() })
    ),
    check: async ({ seat, keyed }: { readonly seat: string; readonly keyed: boolean }) => {
      const values = keyed ? Object.fromEntries(Object.values(Model.providers).map((row) => [row.key, "k"])) : {}
      const { sent, fetch } = provider(() => json(anthropicMessage("x")))
      const exit = await Effect.runPromiseExit(
        Layer.build(Model.use(seat)).pipe(
          Effect.scoped,
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          Effect.provide(env(values))
        )
      )
      expect(sent).toHaveLength(0)
      const colon = seat.indexOf(":")
      const provider_ = seat.slice(0, colon)
      const wellFormed = /^[a-z][a-z0-9-]*:\S+$/.test(seat)
      const known = wellFormed && Object.hasOwn(Model.providers, provider_)
      if (known && keyed) {
        expect(Exit.isSuccess(exit)).toBe(true)
        return
      }
      const error = failure(exit) as Model.ModelUnresolved
      expect(error._tag).toBe("ModelUnresolved")
      expect(error.seat).toBe(seat)
      expect(error.reason).toBe(!wellFormed ? "Malformed" : !known ? "UnknownProvider" : "MissingKey")
    }
  })
})

// Ordered seats. Every seat below is a Chat Completions row; the model id
// says which seat a request came from.
type Outcome = "ok" | "busy" | "fatal" | "keyless"

const outcomes = (plan: ReadonlyArray<Outcome>) => {
  const seats = plan.map((outcome, i) => outcome === "keyless" ? `openrouter:m${i}` : `cerebras:m${i}`)
  const { sent, fetch } = provider(({ body }) => {
    const i = Number(String(body.model).slice(1))
    switch (plan[i]) {
      case "ok":
        return json(chatCompletion(`answer ${i}`))
      case "busy":
        return json({ error: { message: "overloaded", type: "server_error" } }, 503)
      default:
        return json({ error: { message: "bad key", type: "invalid_request_error" } }, 401)
    }
  })
  return { seats, sent, fetch, asked: () => sent.map(({ body }) => Number(String(body.model).slice(1))) }
}

const chatOnly = { CEREBRAS_API_KEY: "csk" }

test("an ordered list falls back past a busy seat and answers from the next", async () => {
  const { seats, fetch, asked } = outcomes(["busy", "ok", "ok"])
  const exit = await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(seats), fetch, chatOnly)
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("answer 1")
  expect(asked()).toEqual([0, 1])
})

test("a refused key does not fall back", async () => {
  const { seats, fetch, asked } = outcomes(["fatal", "ok"])
  const error = failure(await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(seats), fetch, chatOnly))
  expect(AiError.isAiError(error) && error.reason._tag).toBe("AuthenticationError")
  expect(asked()).toEqual([0])
})

test("an unused fallback never fails a call, and a keyless primary yields to the next seat", async () => {
  const unused = outcomes(["ok", "keyless"])
  const exit = await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(unused.seats), unused.fetch, chatOnly)
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("answer 0")
  const skipped = outcomes(["keyless", "ok"])
  const second = await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(skipped.seats), skipped.fetch, chatOnly)
  expect(Exit.isSuccess(second) && second.value.text).toBe("answer 1")
  expect(skipped.asked()).toEqual([1])
})

test("when every seat is busy the call fails with the last provider's error", async () => {
  const { seats, fetch, asked } = outcomes(["busy", "keyless", "busy"])
  const error = failure(await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(seats), fetch, chatOnly))
  expect(AiError.isAiError(error) && error.reason._tag).toBe("InternalProviderError")
  expect(asked()).toEqual([0, 2])
})

test("a malformed or unknown seat anywhere in the list fails when the layer is built", async () => {
  const { fetch, sent } = outcomes(["ok"])
  for (const seats of [["cerebras:m0", "acme:x"], ["cerebras:m0", "nocolon"], []]) {
    const error = failure(await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(seats), fetch, chatOnly))
    expect((error as Model.ModelUnresolved)._tag).toBe("ModelUnresolved")
  }
  expect(sent).toHaveLength(0)
  const keyless = failure(await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(["openrouter:a", "openrouter:b"]), fetch, chatOnly))
  expect(keyless).toMatchObject({ _tag: "ModelUnresolved", reason: "MissingKey", seat: "openrouter:b" })
})

const sse = (chunks: ReadonlyArray<string>, fail = false) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (const text of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: "c",
            object: "chat.completion.chunk",
            created: 1,
            model: "m",
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
          })}\n\n`))
        }
        // error() discards queued chunks, so fail once the first is read.
        if (fail) setTimeout(() => controller.error(new TypeError("connection reset")), 50)
        else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: "c",
            object: "chat.completion.chunk",
            created: 1,
            model: "m",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
          })}\n\ndata: [DONE]\n\n`))
          controller.close()
        }
      }
    }),
    { headers: { "content-type": "text/event-stream" } }
  )

const streamed = <R>(stream: Stream.Stream<Response.AnyPart, unknown, R>) =>
  Effect.map(Stream.runCollect(stream), (parts) =>
    Array.from(parts).flatMap((part) => part.type === "text-delta" ? [part.delta] : []).join(""))

test("a stream falls back before its first part, and never after", async () => {
  const before = provider(({ body }) => body.model === "m0" ? json({ error: { message: "busy" } }, 503) : sse(["from ", "one"]))
  const exit = await run(
    streamed(LanguageModel.streamText({ prompt: "hi" })),
    Model.use(["cerebras:m0", "cerebras:m1"]),
    before.fetch,
    chatOnly
  )
  expect(Exit.isSuccess(exit) && exit.value).toBe("from one")
  const after = provider(({ body }) => body.model === "m0" ? sse(["partial"], true) : sse(["fallback"]))
  const parts: Array<string> = []
  const broken = await run(
    Stream.runForEach(LanguageModel.streamText({ prompt: "hi" }), (part) =>
      Effect.sync(() => part.type === "text-delta" && parts.push(part.delta))),
    Model.use(["cerebras:m0", "cerebras:m1"]),
    after.fetch,
    chatOnly
  )
  expect(Exit.isFailure(broken)).toBe(true)
  expect(parts).toEqual(["partial"])
  expect(after.sent.map(({ body }) => body.model)).toEqual(["m0"])
})

test("property: an ordered list answers from the first seat that answers and asks no seat after it", async () => {
  await checkProperty(fc, {
    name: "experimental-model-ordered-fallback",
    rule: "VIP-62: Model.use([a, b]) falls back in order; capacity and 5xx fall back, other refusals do not",
    command: "cd packages/runtime && bun test tests/model.test.ts",
    arbitrary: fc.array(fc.constantFrom<Outcome>("ok", "busy", "fatal", "keyless"), { minLength: 1, maxLength: 5 }),
    check: async (plan: ReadonlyArray<Outcome>) => {
      const { seats, fetch, asked } = outcomes(plan)
      const exit = await run(LanguageModel.generateText({ prompt: "hi" }), Model.use(seats), fetch, chatOnly)
      // The oracle: walk the plan as the rule states it.
      const expected: Array<number> = []
      let answer: number | undefined
      let stop: Outcome | undefined
      for (let i = 0; i < plan.length; i++) {
        if (plan[i] === "keyless") continue
        expected.push(i)
        if (plan[i] === "ok") {
          answer = i
          break
        }
        if (plan[i] === "fatal") {
          stop = "fatal"
          break
        }
      }
      expect(asked()).toEqual(expected)
      if (answer !== undefined) {
        expect(Exit.isSuccess(exit) && exit.value.text).toBe(`answer ${answer}`)
        return
      }
      const error = failure(exit)
      if (expected.length === 0) expect((error as Model.ModelUnresolved).reason).toBe("MissingKey")
      else expect(AiError.isAiError(error) && error.reason._tag).toBe(stop === "fatal" ? "AuthenticationError" : "InternalProviderError")
    }
  })
})

const embeddings = (vectors: ReadonlyArray<ReadonlyArray<number>>) => ({
  object: "list",
  data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
  model: "text-embedding-3-small",
  usage: { prompt_tokens: 4, total_tokens: 4 }
})

test("Model.embed serves Effect's EmbeddingModel from an OpenAI or Chat Completions seat", async () => {
  for (const [seat, url, values] of [
    ["openai:text-embedding-3-small", "https://api.openai.com/v1/embeddings", { OPENAI_API_KEY: "sk-openai" }],
    ["openrouter:qwen/qwen3-embedding-8b", "https://openrouter.ai/api/v1/embeddings", { OPENROUTER_API_KEY: "or" }]
  ] as const) {
    const { sent, fetch } = provider(() => json(embeddings([[0.25, -0.5, 1]])))
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(Effect.service(EmbeddingModel.EmbeddingModel), (model) => model.embed("hello")).pipe(
        Effect.provide(Model.embed(seat, { dimensions: 3 })),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.provide(env(values))
      )
    )
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause))
    expect(Array.from(exit.value.vector)).toEqual([0.25, -0.5, 1])
    expect(sent[0].url).toBe(url)
    expect(sent[0].body).toMatchObject({ model: seat.slice(seat.indexOf(":") + 1), dimensions: 3 })
  }
})

test("an embedding seat with no embedding endpoint fails when the layer is built", async () => {
  const { sent, fetch } = provider(() => json(embeddings([[1]])))
  const exit = await Effect.runPromiseExit(
    Effect.flatMap(Effect.service(EmbeddingModel.EmbeddingModel), (model) => model.embed("hello")).pipe(
      Effect.provide(Model.embed("anthropic:claude-sonnet-5-5")),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provide(env({ ANTHROPIC_API_KEY: key }))
    )
  )
  expect(failure(exit)).toMatchObject({ _tag: "ModelUnresolved", reason: "Unsupported" })
  expect(sent).toHaveLength(0)
})
