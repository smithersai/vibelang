import { expect, test } from "bun:test"
import { ConfigProvider, Effect, Exit, Stream } from "effect"
import { AiError, LanguageModel } from "effect/ai"
import { FetchHttpClient, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Model } from "vibelang-runtime/experimental"

interface Sent {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: any
}

const record = async (sent: Array<Sent>, request: Request) => {
  const text = await request.clone().text()
  sent.push({ url: request.url, headers: Object.fromEntries(request.headers.entries()), body: text === "" ? undefined : JSON.parse(text) })
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
  usage: { input_tokens: 5, output_tokens: 1 }
})

const serverKey = "sk-ant-server-only"

// The server: a proxy handler whose requests to the provider go to `provider`.
const server = async (
  options: Omit<Model.ProxyOptions, "seat"> & { readonly seat?: string },
  provider: (request: Request) => Response | Promise<Response>,
  env: Record<string, string> = { ANTHROPIC_API_KEY: serverKey, CEREBRAS_API_KEY: "csk-server" }
) => {
  const upstream: Array<Sent> = []
  const providerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    await record(upstream, request)
    return provider(request)
  }) as typeof globalThis.fetch
  const handler = await Effect.runPromise(
    Model.proxy({ seat: "anthropic:claude-sonnet-5-5", ...options }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, providerFetch),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))
    )
  )
  const incoming: Array<Sent> = []
  const serve = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    await record(incoming, request)
    const response = await Effect.runPromise(
      handler.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
        Effect.provideService(FetchHttpClient.Fetch, providerFetch)
      )
    )
    return HttpServerResponse.toWeb(response)
  }) as typeof globalThis.fetch
  return { serve, upstream, incoming }
}

// The browser: no key in its config, and every request goes to the server.
const browser = <A, E>(effect: Effect.Effect<A, E, LanguageModel.LanguageModel>, serve: typeof globalThis.fetch) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(Model.proxied({ url: "https://app.example/api/model/" })),
      Effect.provideService(FetchHttpClient.Fetch, serve),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))
    )
  )

const failure = <A, E>(exit: Exit.Exit<A, E>): E => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure, got " + JSON.stringify(exit.value))
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  if (error === undefined) throw new Error("expected a typed failure: " + String(exit.cause))
  return (error as { readonly error: E }).error
}

test("a browser with no key calls the model through the proxy, which adds the server's key", async () => {
  const { incoming, serve, upstream } = await server({}, () => json(anthropicMessage("proxied hello")))
  const exit = await browser(LanguageModel.generateText({ prompt: "hi" }), serve)
  expect(Exit.isSuccess(exit) && exit.value.text).toBe("proxied hello")
  expect(incoming.map(({ url }) => new URL(url).pathname)).toEqual(["/api/model/seat", "/api/model/v1/messages"])
  for (const { headers } of incoming) {
    expect(headers["x-api-key"]).toBeUndefined()
    expect(headers.authorization).toBeUndefined()
  }
  expect(upstream).toHaveLength(1)
  expect(new URL(upstream[0].url).origin + new URL(upstream[0].url).pathname).toBe("https://api.anthropic.com/v1/messages")
  expect(upstream[0].headers["x-api-key"]).toBe(serverKey)
  expect(upstream[0].headers["anthropic-version"]).toBeDefined()
  expect(upstream[0].body.model).toBe("claude-sonnet-5-5")
})

test("a streamed answer passes through the proxy part by part", async () => {
  const chunk = (content: string, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: content === "" ? {} : { content }, finish_reason: finish }] })}\n\n`
  const { serve, upstream } = await server(
    { seat: "cerebras:qwen-3.8-27b" },
    () => new Response(chunk("one ") + chunk("two") + chunk("", "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  )
  const exit = await browser(
    Effect.map(Stream.runCollect(LanguageModel.streamText({ prompt: "hi" })), (parts) =>
      Array.from(parts).flatMap((part) => part.type === "text-delta" ? [part.delta] : []).join("")),
    serve
  )
  expect(Exit.isSuccess(exit) && exit.value).toBe("one two")
  expect(upstream[0].url).toBe("https://api.cerebras.ai/v1/chat/completions")
  expect(upstream[0].headers.authorization).toBe("Bearer csk-server")
})

test("the proxy refuses another model, another path, a large body and a refused admission", async () => {
  const { serve, upstream } = await server({ maxBodyBytes: 2_000, admit: (request) => Effect.succeed(request.headers["x-session"] !== "banned") }, () => json(anthropicMessage("never")))
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    serve(`https://app.example/api/model${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
  expect((await post("/v1/messages", { model: "claude-opus-5-5", messages: [] })).status).toBe(403)
  expect((await post("/v1/complete", { model: "claude-sonnet-5-5" })).status).toBe(404)
  expect((await post("/v1/messages", { model: "claude-sonnet-5-5", pad: "x".repeat(3_000) })).status).toBe(413)
  expect((await post("/v1/messages", { model: "claude-sonnet-5-5" }, { "x-session": "banned" })).status).toBe(403)
  expect((await post("/v1/messages", "not an object")).status).toBe(403)
  expect(upstream).toHaveLength(0)
  // A caller's own credentials never reach the provider.
  await post("/v1/messages", { model: "claude-sonnet-5-5", messages: [] }, { authorization: "Bearer stolen", cookie: "s=1" })
  expect(upstream[0].headers.authorization).toBeUndefined()
  expect(upstream[0].headers.cookie).toBeUndefined()
})

test("a provider's refusal reaches the browser as Effect's AiError", async () => {
  const { serve } = await server({}, () => json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429))
  const error = failure(await browser(LanguageModel.generateText({ prompt: "hi" }), serve))
  expect(AiError.isAiError(error) && error.reason._tag).toBe("RateLimitError")
})

test("a proxy with no key, or a browser that cannot reach one, fails when built", async () => {
  const keyless = await Effect.runPromiseExit(
    Model.proxy({ seat: "anthropic:claude-sonnet-5-5" }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))))
  )
  expect(failure(keyless)).toMatchObject({ _tag: "ModelUnresolved", reason: "MissingKey" })
  const down = (() => Promise.reject(new TypeError("refused"))) as unknown as typeof globalThis.fetch
  expect(failure(await browser(LanguageModel.generateText({ prompt: "hi" }), down))).toMatchObject({ _tag: "ModelUnresolved", reason: "Unreachable" })
  const notProxy = (async () => new Response("<html>", { status: 404 })) as unknown as typeof globalThis.fetch
  expect(failure(await browser(LanguageModel.generateText({ prompt: "hi" }), notProxy))).toMatchObject({ reason: "Unreachable" })
})
