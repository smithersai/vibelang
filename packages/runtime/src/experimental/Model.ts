/**
 * Effect's AI services by name. A seat such as `"anthropic:claude-sonnet-5-5"`
 * becomes the layer that serves Effect's `LanguageModel`, built from Effect's
 * own provider packages over the program's `HttpClient`. The calling half,
 * `LanguageModel`, `Chat`, `Tool` and `Toolkit`, stays Effect's.
 *
 * A provider package loads when its seat's layer is built, so a program that
 * never asks for a model loads none of them.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Cause from "effect/Cause"
import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as AiError from "effect/ai/AiError"
import * as DecisionModel from "effect/ai/DecisionModel"
import * as EmbeddingModel from "effect/ai/EmbeddingModel"
import * as LanguageModel from "effect/ai/LanguageModel"
import * as Response from "effect/ai/Response"
import * as Toolkit from "effect/ai/Toolkit"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Activity from "effect/workflow/Activity"
import * as Workflow from "effect/workflow/Workflow"
import * as WorkflowEngine from "effect/workflow/WorkflowEngine"
import * as decision from "./internal/decision.js"
import * as catalog from "./internal/modelCatalog.js"
import { StepScope } from "./internal/modelStepScope.js"
import * as record from "./internal/record.js"

/**
 * Why a seat has no layer. `Malformed`: not `provider:modelId`.
 * `UnknownProvider`: no row in {@link providers}. `MissingKey`: the
 * provider's key variable is unset. `NotInstalled`: the provider package
 * could not be loaded. `Unsupported`: the provider serves no model of the
 * kind asked for, such as embeddings from Anthropic. `Unreachable`: a model
 * proxy did not say which seat it serves.
 *
 * @since 0.0.13
 */
export type UnresolvedReason = "Malformed" | "UnknownProvider" | "MissingKey" | "NotInstalled" | "Unsupported" | "Unreachable"

/**
 * A seat that names no model this program can reach. It fails the layer when
 * it is built, before any call, and never holds a key.
 *
 * @since 0.0.13
 */
export class ModelUnresolved extends /* @__PURE__ */ Data.TaggedError("ModelUnresolved")<{
  readonly seat: string
  readonly reason: UnresolvedReason
  readonly message: string
}> {}

/**
 * The wire format a provider speaks: Anthropic Messages, OpenAI Responses, or
 * OpenAI Chat Completions.
 *
 * @since 0.0.13
 */
export type Protocol = "anthropic" | "responses" | "chat"

/**
 * One provider row: its wire format, the config variable that holds its key,
 * and the API base URL when it is not the protocol's own.
 *
 * @since 0.0.13
 */
export interface Provider {
  readonly protocol: Protocol
  readonly key: string
  readonly baseUrl?: string | undefined
}

/**
 * The providers a seat may name. A fork adds a provider by adding a row.
 *
 * @since 0.0.13
 */
export const providers: Readonly<Record<string, Provider>> = {
  anthropic: { protocol: "anthropic", key: "ANTHROPIC_API_KEY" },
  openai: { protocol: "responses", key: "OPENAI_API_KEY" },
  cerebras: { protocol: "chat", key: "CEREBRAS_API_KEY", baseUrl: "https://api.cerebras.ai/v1" },
  openrouter: { protocol: "chat", key: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1" },
  vercel: { protocol: "chat", key: "AI_GATEWAY_API_KEY", baseUrl: "https://ai-gateway.vercel.sh/v1" }
}

/**
 * A seat split into its provider and model id. The model id is everything
 * after the first colon, so `"ollama:llama3:8b"` names model `llama3:8b`.
 *
 * @since 0.0.13
 */
export interface Seat {
  readonly provider: string
  readonly model: string
}

const seatPattern = /^([a-z][a-z0-9-]*):(\S+)$/

/**
 * Splits a seat, or fails with `Malformed`.
 *
 * @since 0.0.13
 */
export const parse = (seat: string): Effect.Effect<Seat, ModelUnresolved> => {
  const match = seatPattern.exec(seat)
  return match === null
    ? Effect.fail(
      new ModelUnresolved({
        seat,
        reason: "Malformed",
        message: `Seat "${seat}" is not provider:modelId, such as "anthropic:claude-sonnet-5-5"`
      })
    )
    : Effect.succeed({ provider: match[1], model: match[2] })
}

// The program's HttpClient when it provides one, otherwise fetch, which every
// host this runs on has.
const withHttpClient = <A, E>(layer: Layer.Layer<A, E, HttpClient.HttpClient>): Layer.Layer<A, E> =>
  Layer.unwrap(Effect.map(Effect.serviceOption(HttpClient.HttpClient), (client) =>
    Option.isSome(client)
      ? Layer.provide(layer, Layer.succeed(HttpClient.HttpClient, client.value))
      : Layer.provide(layer, FetchHttpClient.layer)))

const load = <A>(seat: string, name: string, module: () => Promise<A>): Effect.Effect<A, ModelUnresolved> =>
  Effect.tryPromise({
    try: module,
    catch: (cause) =>
      new ModelUnresolved({
        seat,
        reason: "NotInstalled",
        message: `${name} could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`
      })
  })

const readKey = (
  seat: string,
  key: string | Config.Config<Redacted.Redacted<string>>
): Effect.Effect<Redacted.Redacted<string>, ModelUnresolved> =>
  Effect.mapError(
    typeof key === "string" ? Config.Redacted(key) : key,
    () =>
      new ModelUnresolved({
        seat,
        reason: "MissingKey",
        message: typeof key === "string" ? `Seat "${seat}" needs ${key}` : `Seat "${seat}" has no key`
      })
  )

interface Endpoint {
  readonly seat: string
  readonly protocol: Protocol
  readonly model: string
  readonly apiKey: Redacted.Redacted<string> | undefined
  readonly apiUrl: string | undefined
}

const languageLayer = (
  endpoint: Endpoint
): Effect.Effect<Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient>, ModelUnresolved> => {
  const { apiKey, apiUrl, model, seat } = endpoint
  switch (endpoint.protocol) {
    case "anthropic":
      return Effect.map(load(seat, "@effect/ai-anthropic", () => import("@effect/ai-anthropic")), (m) =>
        Layer.provide(m.AnthropicLanguageModel.layer({ model }), m.AnthropicClient.layer({ apiKey, apiUrl })))
    case "responses":
      return Effect.map(load(seat, "@effect/ai-openai", () => import("@effect/ai-openai")), (m) =>
        Layer.provide(m.OpenAiLanguageModel.layer({ model }), m.OpenAiClient.layer({ apiKey, apiUrl })))
    case "chat":
      return Effect.map(load(seat, "@effect/ai-openai-compat", () => import("@effect/ai-openai-compat")), (m) =>
        Layer.provide(m.OpenAiLanguageModel.layer({ model }), m.OpenAiClient.layer({ apiKey, apiUrl })))
  }
}

// A seat's provider row, or the error a typo deserves at once: a malformed
// seat or an unknown provider never waits for a fallback to be needed.
const row = (seat: string): Effect.Effect<Seat & { readonly row: Provider }, ModelUnresolved> =>
  Effect.flatMap(parse(seat), ({ provider, model }) =>
    Object.hasOwn(providers, provider)
      ? Effect.succeed({ provider, model, row: providers[provider] })
      : Effect.fail(
        new ModelUnresolved({
          seat,
          reason: "UnknownProvider",
          message: `Seat "${seat}" names provider "${provider}", which is not one of ${Object.keys(providers).join(", ")}`
        })
      ))

const resolve = (seat: string): Effect.Effect<Endpoint, ModelUnresolved> =>
  Effect.gen(function*() {
    const { model, row: provider } = yield* row(seat)
    const apiKey = yield* readKey(seat, provider.key)
    return { seat, protocol: provider.protocol, model, apiKey, apiUrl: provider.baseUrl }
  })

const seatLayer = (seat: string): Layer.Layer<LanguageModel.LanguageModel, ModelUnresolved> =>
  withHttpClient(Layer.unwrap(Effect.flatMap(resolve(seat), languageLayer)))

/**
 * Whether a failed call moves on to the next seat of an ordered list: a
 * capacity refusal (rate limit or exhausted quota), a provider fault (HTTP
 * 5xx), an unreachable provider, or a prompt over the model's context window.
 * Any other failure, such as a refused key, a policy refusal or an answer
 * that does not decode, is the program's to see.
 *
 * @since 0.0.13
 */
export const fallsBack = (error: unknown): boolean => {
  if (!AiError.isAiError(error)) return false
  const reason = error.reason
  switch (reason._tag) {
    case "RateLimitError":
    case "QuotaExhaustedError":
    case "InternalProviderError":
    case "NetworkError":
      return true
    case "InvalidRequestError":
      return /context|too long|too many tokens|maximum.*tokens/i.test(reason.description ?? "")
    default:
      return false
  }
}

type Call = (options: unknown) => Effect.Effect<unknown, unknown, unknown>
type AnyModel = {
  readonly generateText: Call
  readonly generateObject: Call
  readonly streamText: (options: unknown) => Stream.Stream<unknown, unknown, unknown>
}

type Recordable = "generateText" | "generateObject"

// A call to a tool the toolkit does not declare, which Effect's call returns
// under deferred validation.
let undeclaredToolCall: Schema.Top | undefined
const withUndeclaredToolCalls = (part: Schema.Top, deferred: boolean): Schema.Top =>
  deferred
    ? Schema.Union([
      part,
      undeclaredToolCall ??= Response.ToolCallPart("", Schema.Unknown).mapFields((fields: any) => ({
        ...fields,
        name: Schema.String
      })) as unknown as Schema.Top
    ]) as unknown as Schema.Top
    : part

// The schemas the step journals a response's parts with. Effect's call
// decodes a tool call's parameters only to run the tool, so its response
// holds them as the model sent them (in their encoded form when tool
// resolution is off), and under deferred validation it may hold a call to an
// undeclared tool. The journal reads parts the same way, so it encodes what
// the call returned.
const journalParts = (toolkit: any, options: any) => {
  const deferred = options.disableToolCallResolution === true && options.toolCallValidation === "deferred"
  const encoded = options.disableToolCallResolution === true && !deferred
  const tools = toolkit === undefined
    ? (undefined as never)
    : Toolkit.make(
      ...(Object.values(toolkit.tools) as Array<any>).map((tool) =>
        tool.setParameters(encoded ? Schema.toEncoded(tool.parametersSchema) : Schema.Unknown)
      )
    )
  return {
    part: withUndeclaredToolCalls(Response.Part(tools) as unknown as Schema.Top, deferred),
    streamPart: withUndeclaredToolCalls(Response.StreamPart(tools) as unknown as Schema.Top, deferred)
  }
}

// A toolkit given as an Effect (a `Toolkit` whose handlers are provided) is
// resolved in the caller's fiber, as Effect's own call does, so a recorded
// step's errors are the provider's and the tools' alone; with the toolkit's
// schemas, the step journals tool calls, tool results and typed tool
// failures, and a replay runs no handler.
const resolveTools = (options: any) =>
  Effect.map(
    options.toolkit === undefined
      ? Effect.succeed(undefined)
      : Effect.isEffect(options.toolkit)
      ? (options.toolkit as Effect.Effect<any, any, any>)
      : Effect.succeed(options.toolkit),
    (toolkit: any) => ({
      toolkit,
      ...journalParts(toolkit, options),
      request: toolkit === undefined ? options : { ...options, toolkit },
      error: (toolkit === undefined
        ? AiError.AiError
        : Schema.Union([AiError.AiError, ...Object.values(toolkit.tools).map((tool: any) => tool.failureSchema)])) as unknown as Schema.Top
    })
  )

// A call inside a workflow or one of its tasks is a recorded step: an Effect
// Activity named after the request, whose answer, or failure, the engine
// journals. A resumed run reads the recorded result instead of calling the
// provider. A refusal for capacity parks the run until its window reopens.
const recordedCall = (model: LanguageModel.LanguageModel, method: Recordable) => (options: any) => {
  const live = (request: unknown) => (model[method] as (options: unknown) => Effect.Effect<any, any, any>)(request)
  if (options === null || typeof options !== "object") return live(options)
  return Effect.flatMap(Effect.serviceOption(WorkflowEngine.WorkflowInstance), (instance) => {
    if (Option.isNone(instance)) return live(options)
    return Effect.gen(function*() {
      const { error, request, part } = yield* resolveTools(options)
      const content = Schema.Array(part)
      const success = method === "generateObject"
        ? Schema.Struct({ value: options.schema as Schema.Top, content })
        : Schema.Struct({ content })
      const step = (name: string) =>
        Activity.make({
          name,
          success,
          error,
          execute: Effect.provideService(
            Effect.map(live(request), (response: any) =>
              method === "generateObject" ? { value: response.value, content: response.content } : { content: response.content }),
            StepScope,
            name
          )
        })
      const recorded: any = yield* record.parked("model", instance.value, [method, options.prompt, options.objectName ?? null], step)
      return method === "generateObject"
        ? new LanguageModel.GenerateObjectResponse(recorded.value, recorded.content)
        : new LanguageModel.GenerateTextResponse(recorded.content)
    })
  })
}

const recordedStream = (model: LanguageModel.LanguageModel) => (options: any) => {
  const live = (request: unknown) => (model.streamText as (options: unknown) => Stream.Stream<unknown, unknown>)(request)
  if (options === null || typeof options !== "object") return live(options)
  return Stream.unwrap(Effect.flatMap(Effect.serviceOption(WorkflowEngine.WorkflowInstance), (found) => {
    if (Option.isNone(found)) return Effect.succeed(live(options))
    const instance = found.value
    return Effect.gen(function*() {
      const { error, request, streamPart } = yield* resolveTools(options)
      const queue = yield* Queue.unbounded<unknown, unknown>()
      let delivered = false
      const parts = Schema.Array(streamPart)
      const step = (name: string) =>
        Activity.make({
          name,
          success: Schema.Struct({ parts }),
          error,
          execute: Effect.provideService(
            Effect.map(
              Stream.runCollect(Stream.tap(live(request), (part) => Effect.andThen(Effect.sync(() => (delivered = true)), Queue.offer(queue, part)))),
              (all) => ({ parts: Array.from(all) })
            ),
            StepScope,
            name
          )
        })
      // onExit, not a failure handler: a park suspends the run by
      // interrupting this fiber, and the caller must hear of it.
      const fiber = yield* record.parked("model", instance, ["streamText", options.prompt], step, () => !delivered).pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? delivered ? Queue.end(queue) : Effect.andThen(Queue.offerAll(queue, (exit.value as any).parts), Queue.end(queue))
            : Queue.failCause(queue, exit.cause)
        ),
        Effect.forkDetach
      )
      yield* Effect.addFinalizer((exit) => Exit.isSuccess(exit) ? Effect.asVoid(Fiber.await(fiber)) : Fiber.interrupt(fiber))
      return Stream.fromQueue(queue).pipe(
        // The run suspended while the step parked: suspend the caller too,
        // so no handler of the caller's can take the suspension for a failure.
        Stream.catchCause((cause) =>
          instance.suspended && Cause.hasInterruptsOnly(cause)
            ? Stream.fromEffect(Workflow.suspend(instance))
            : Stream.failCause(cause)
        )
      )
    })
  }))
}

const recording = <E>(layer: Layer.Layer<LanguageModel.LanguageModel, E>): Layer.Layer<LanguageModel.LanguageModel, E> =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.map(Effect.map(Layer.build(layer), (built) => Context.get(built, LanguageModel.LanguageModel)), (model) => ({
      ...model,
      generateText: recordedCall(model, "generateText"),
      generateObject: recordedCall(model, "generateObject"),
      streamText: recordedStream(model)
    }) as unknown as LanguageModel.LanguageModel)
  )

interface Ordered<S> {
  readonly models: ReadonlyArray<Effect.Effect<S, ModelUnresolved>>
  readonly primary: number
  readonly first: S
}

// An ordered list of seats, each resolved by `build`. Every seat is checked
// when the layer is built; the first that resolves then is primary, and later
// seats resolve only when a call falls back to them, so an unused fallback
// never fails a call.
const resolveOrdered = <S>(
  name: string,
  seats: ReadonlyArray<string>,
  build: (seat: string) => Layer.Layer<S, ModelUnresolved>,
  key: Context.Key<S, S>
): Effect.Effect<Ordered<S>, ModelUnresolved, Scope.Scope> =>
  Effect.gen(function*() {
    if (seats.length === 0) {
      return yield* new ModelUnresolved({ seat: "", reason: "Malformed", message: `${name} needs at least one seat` })
    }
    for (const seat of seats) yield* row(seat)
    const context = yield* Effect.context<Scope.Scope>()
    const models: Array<Effect.Effect<S, ModelUnresolved>> = []
    for (const seat of seats) {
      const service = Effect.map(Layer.build(build(seat)), (built) => Context.get(built, key))
      models.push(yield* Effect.cached(Effect.provideContext(service, context)))
    }
    let primary = 0
    let last: ModelUnresolved | undefined
    for (; primary < models.length; primary++) {
      const exit = yield* Effect.result(models[primary])
      if (exit._tag === "Success") return { models, primary, first: exit.success }
      last = exit.failure
    }
    return yield* last!
  })

// One call over the list: the primary first, then each later seat that
// resolves, while the failure is one that falls back.
const attempts = <S>({ first, models, primary }: Ordered<S>) =>
<A, E, R>(call: (service: S) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
  const from = (index: number, failure: E): Effect.Effect<A, E, R> =>
    index >= models.length
      ? Effect.fail(failure)
      : Effect.matchEffect(models[index], {
        onFailure: () => from(index + 1, failure),
        onSuccess: (service) =>
          Effect.catch(call(service), (error) => fallsBack(error) ? from(index + 1, error) : Effect.fail(error))
      })
  return Effect.catch(call(first), (error) => fallsBack(error) ? from(primary + 1, error) : Effect.fail(error))
}

// A LanguageModel over an ordered list. A stream falls back only before its
// first part: a prefix is never repeated.
const ordered = (seats: ReadonlyArray<string>): Layer.Layer<LanguageModel.LanguageModel, ModelUnresolved> =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function*() {
      const list = yield* resolveOrdered("Model.use", seats, seatLayer, LanguageModel.LanguageModel)
      const { models, primary } = list
      const first = list.first as unknown as AnyModel
      const attempt = attempts(list as unknown as Ordered<AnyModel>)
      const call = (method: "generateText" | "generateObject"): Call => (options) =>
        attempt((model) => model[method](options))

      const stream = (options: unknown): Stream.Stream<unknown, unknown, unknown> => {
        const from = (index: number, failure: unknown): Stream.Stream<unknown, unknown, unknown> =>
          index >= models.length
            ? Stream.fail(failure)
            : Stream.unwrap(Effect.match(models[index], {
              onFailure: () => from(index + 1, failure),
              onSuccess: (model) => once((model as unknown as AnyModel).streamText(options), index)
            }))
        const once = (source: Stream.Stream<unknown, unknown, unknown>, index: number) =>
          Stream.suspend(() => {
            let emitted = false
            return source.pipe(
              Stream.map((part) => {
                emitted = true
                return part
              }),
              Stream.catch((error) => !emitted && fallsBack(error) ? from(index + 1, error) : Stream.fail(error))
            )
          })
        return once(first.streamText(options), primary)
      }

      return {
        ...first,
        generateText: call("generateText"),
        generateObject: call("generateObject"),
        streamText: stream
      } as unknown as LanguageModel.LanguageModel
    })
  )

/**
 * The `LanguageModel` a seat names, such as `"anthropic:claude-sonnet-5-5"`,
 * or an ordered list of seats. The key comes from the provider's config
 * variable, read when the seat's layer is built; a malformed seat or an
 * unknown provider fails the layer when it is built, with
 * {@link ModelUnresolved}, and so does a list none of whose seats resolves.
 * Requests go through the program's `HttpClient`, or `fetch` when it provides
 * none.
 *
 * With a list, the first seat that resolves answers, and a call that fails
 * as {@link fallsBack} describes moves on to the next seat. When every seat
 * has failed, the call fails with the last error a provider gave.
 *
 * @since 0.0.13
 */
export const use = (seat: string | ReadonlyArray<string>): Layer.Layer<LanguageModel.LanguageModel, ModelUnresolved> =>
  recording(typeof seat === "string" ? seatLayer(seat) : ordered(seat))

/**
 * Options for {@link compatible}.
 *
 * @since 0.0.13
 */
export interface CompatibleOptions {
  /** The provider's name, used in errors. */
  readonly id: string
  /** The API base, such as `http://localhost:11434/v1`; requests append `/chat/completions` or `/responses`. */
  readonly baseUrl: string
  /** The model id the server expects. */
  readonly model: string
  /** The config variable that holds the key, or a config of the key. No key is sent when this is omitted. */
  readonly apiKey?: string | Config.Config<Redacted.Redacted<string>> | undefined
  /** `"chat"` (Chat Completions, the default) or `"responses"`. */
  readonly protocol?: "chat" | "responses" | undefined
}

/**
 * The `LanguageModel` of any OpenAI-compatible server. Chat Completions is the
 * default, because most self-hosted servers speak it. A server that speaks
 * the wire format may still refuse an option.
 *
 * @since 0.0.13
 */
export const compatible = (options: CompatibleOptions): Layer.Layer<LanguageModel.LanguageModel, ModelUnresolved> => {
  const seat = `${options.id}:${options.model}`
  return recording(withHttpClient(Layer.unwrap(Effect.gen(function*() {
    const apiKey = options.apiKey === undefined ? undefined : yield* readKey(seat, options.apiKey)
    return yield* languageLayer({
      seat,
      protocol: options.protocol ?? "chat",
      model: options.model,
      apiKey,
      apiUrl: options.baseUrl
    })
  }))))
}

/**
 * Options for {@link embed}.
 *
 * @since 0.0.13
 */
export interface EmbedOptions {
  /** The vector length to ask for, on models that can shorten their vectors. */
  readonly dimensions?: number | undefined
}

const embeddingLayer = (
  endpoint: Endpoint,
  options: EmbedOptions
): Effect.Effect<Layer.Layer<EmbeddingModel.EmbeddingModel, never, HttpClient.HttpClient>, ModelUnresolved> => {
  const { apiKey, apiUrl, model, seat } = endpoint
  const config = (options.dimensions === undefined ? undefined : { dimensions: options.dimensions }) as never
  switch (endpoint.protocol) {
    case "anthropic":
      return Effect.fail(
        new ModelUnresolved({ seat, reason: "Unsupported", message: `Seat "${seat}" serves no embedding model` })
      )
    case "responses":
      return Effect.map(load(seat, "@effect/ai-openai", () => import("@effect/ai-openai")), (m) =>
        Layer.provide(m.OpenAiEmbeddingModel.layer({ model, config }), m.OpenAiClient.layer({ apiKey, apiUrl })))
    case "chat":
      return Effect.map(load(seat, "@effect/ai-openai-compat", () => import("@effect/ai-openai-compat")), (m) =>
        Layer.provide(m.OpenAiEmbeddingModel.layer({ model, config }), m.OpenAiClient.layer({ apiKey, apiUrl })))
  }
}

/**
 * Effect's `EmbeddingModel` a seat names, such as
 * `"openai:text-embedding-3-small"`, through the provider's OpenAI-style
 * `/embeddings` endpoint. A provider with no embedding endpoint, such as
 * Anthropic, fails when the layer is built with reason `Unsupported`.
 *
 * @since 0.0.13
 */
export const embed = (seat: string, options: EmbedOptions = {}): Layer.Layer<EmbeddingModel.EmbeddingModel, ModelUnresolved> =>
  withHttpClient(Layer.unwrap(Effect.flatMap(resolve(seat), (endpoint) => embeddingLayer(endpoint, options))))

/**
 * The seat {@link decide} asks with no argument: Jev, the evaluation model
 * the Vercel AI Gateway serves. It reads `AI_GATEWAY_API_KEY`.
 *
 * @since 0.0.13
 */
export const jev = "vercel:typesafe-ai/jev"

// The program's HttpClient, or fetch's.
const httpClient: Effect.Effect<HttpClient.HttpClient> = Effect.flatMap(
  Effect.serviceOption(HttpClient.HttpClient),
  (client) =>
    Option.isSome(client)
      ? Effect.succeed(client.value)
      : Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer)
)

const decisionLayer = (seat: string): Layer.Layer<DecisionModel.DecisionModel, ModelUnresolved> =>
  Layer.effect(
    DecisionModel.DecisionModel,
    Effect.gen(function*() {
      const { model, provider, row: provider_ } = yield* row(seat)
      if (provider === "vercel") {
        const apiKey = yield* readKey(seat, provider_.key)
        return yield* decision.gateway({ client: yield* httpClient, apiKey, model })
      }
      const language = Context.get(yield* Layer.build(seatLayer(seat)), LanguageModel.LanguageModel)
      return yield* decision.judge(language, model)
    })
  )

/**
 * Effect's `DecisionModel`, which answers typed questions (`Decision.classify`,
 * `rate` and `probability`) about one input in one call. With no argument it
 * is Jev ({@link jev}). A `vercel` seat asks that model through the gateway's
 * evaluation endpoint; any other seat asks its language model the same
 * questions with Jev's answer format, and the response's `modelId` says which
 * model answered.
 *
 * An unreachable model fails the call; it never answers yes. A list falls
 * back in order as {@link use} does, so a language model behind Jev is
 * opt-in: `Model.decide([Model.jev, "anthropic:claude-sonnet-5-5"])`.
 *
 * @since 0.0.13
 */
export const decide = (
  seat: string | ReadonlyArray<string> = jev
): Layer.Layer<DecisionModel.DecisionModel, ModelUnresolved> =>
  typeof seat === "string" ? decisionLayer(seat) : Layer.effect(
    DecisionModel.DecisionModel,
    Effect.map(
      resolveOrdered("Model.decide", seat, decisionLayer, DecisionModel.DecisionModel),
      (list) => {
        const attempt = attempts(list)
        return {
          ...list.first,
          decide: (definition, options) => attempt((model) => model.decide(definition, options)),
          decideSettled: (definition, options) => attempt((model) => model.decideSettled(definition, options))
        } satisfies DecisionModel.DecisionModel
      }
    )
  )

// The provider paths a proxy forwards, after the API base, per wire format.
const proxyPaths: Readonly<Record<Protocol, ReadonlyArray<string>>> = {
  anthropic: ["/v1/messages"],
  responses: ["/responses"],
  chat: ["/chat/completions"]
}

const defaultBase: Readonly<Record<Protocol, string>> = {
  anthropic: "https://api.anthropic.com",
  responses: "https://api.openai.com/v1",
  chat: "https://api.openai.com/v1"
}

// Request headers a proxy passes on. Credentials and cookies never pass.
const forwardedHeaders = ["content-type", "accept", "anthropic-version", "anthropic-beta", "openai-beta"]

/**
 * Options for {@link proxy}.
 *
 * @since 0.0.13
 */
export interface ProxyOptions {
  /** The one seat the proxy serves. Its key is read from config when the handler is built. */
  readonly seat: string
  /** The largest request body accepted, in bytes; 1 MiB by default. */
  readonly maxBodyBytes?: number | undefined
  /** Admits or refuses each request before anything is forwarded, such as by checking a session. */
  readonly admit?: ((request: HttpServerRequest.HttpServerRequest) => Effect.Effect<boolean>) | undefined
}

/**
 * A model proxy: the HTTP handler a server mounts so that a browser, which
 * holds no key, can call a model. It serves one seat. `GET …/seat` names it,
 * and a `POST` to the provider's own path under the mount (`/v1/messages`,
 * `/responses` or `/chat/completions`) is forwarded with the server's key,
 * and the provider's answer, streamed or not, goes back as it came. A request
 * for another model or another path is refused (403, 404), and so is a body
 * over `maxBodyBytes` (413) and any request `admit` refuses (403). Requests
 * to the provider use the program's `HttpClient`, or `fetch`.
 *
 * @since 0.0.13
 */
export const proxy = (
  options: ProxyOptions
): Effect.Effect<Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest>, ModelUnresolved> =>
  Effect.gen(function*() {
    const endpoint = yield* resolve(options.seat)
    const client = yield* httpClient
    const limit = options.maxBodyBytes ?? 1_048_576
    const base = (endpoint.apiUrl ?? defaultBase[endpoint.protocol]).replace(/\/+$/, "")
    const refuse = (status: number, message: string) =>
      HttpServerResponse.jsonUnsafe({ error: { type: status === 403 ? "permission_error" : "invalid_request_error", message } }, { status })
    return Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (options.admit !== undefined && !(yield* options.admit(request))) return refuse(403, "The proxy refused this request")
      const url = new URL(request.url, "http://proxy.invalid")
      if (request.method === "GET" && url.pathname.endsWith("/seat")) {
        return HttpServerResponse.jsonUnsafe({ seat: options.seat })
      }
      const path = proxyPaths[endpoint.protocol].find((suffix) => url.pathname.endsWith(suffix))
      if (request.method !== "POST" || path === undefined) return refuse(404, "The proxy serves no such path")
      const bytes = yield* Effect.option(request.arrayBuffer)
      if (bytes._tag === "None") return refuse(400, "The request body could not be read")
      if (bytes.value.byteLength > limit) return refuse(413, `The request body exceeds ${limit} bytes`)
      const body = yield* Effect.option(Effect.try(() => JSON.parse(new TextDecoder().decode(bytes.value)) as unknown))
      if (body._tag === "None" || typeof body.value !== "object" || body.value === null || (body.value as { model?: unknown }).model !== endpoint.model) {
        return refuse(403, `The proxy serves model ${endpoint.model} only`)
      }
      const headers: Record<string, string> = {}
      for (const name of forwardedHeaders) {
        const value = request.headers[name]
        if (value !== undefined) headers[name] = value
      }
      const key = endpoint.apiKey === undefined ? undefined : Redacted.value(endpoint.apiKey)
      if (key !== undefined) {
        if (endpoint.protocol === "anthropic") headers["x-api-key"] = key
        else headers.authorization = `Bearer ${key}`
      }
      const forwarded = HttpClientRequest.post(base + path + url.search, {
        headers,
        body: HttpBody.uint8Array(new Uint8Array(bytes.value), headers["content-type"] ?? "application/json")
      })
      const answer = yield* Effect.option(client.execute(forwarded))
      if (answer._tag === "None") return refuse(502, "The provider could not be reached")
      const type = answer.value.headers["content-type"]
      return HttpServerResponse.stream(answer.value.stream, {
        status: answer.value.status,
        ...(type === undefined ? {} : { headers: { "content-type": type } })
      })
    })
  })

/**
 * The `LanguageModel` a {@link proxy} serves: it asks the proxy at `url`
 * which seat it serves, then speaks that provider's wire format to the proxy,
 * with no key. This is how a browser calls a model.
 *
 * @since 0.0.13
 */
export const proxied = (options: { readonly url: string }): Layer.Layer<LanguageModel.LanguageModel, ModelUnresolved> => {
  const url = options.url.replace(/\/+$/, "")
  return recording(withHttpClient(Layer.unwrap(Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const unreachable = (message: string) => new ModelUnresolved({ seat: url, reason: "Unreachable", message })
    const response = yield* client.get(`${url}/seat`).pipe(
      Effect.mapError(() => unreachable(`The model proxy at ${url} could not be reached`))
    )
    const answer = yield* response.json.pipe(Effect.orElseSucceed(() => undefined))
    const seat = typeof answer === "object" && answer !== null ? (answer as { seat?: unknown }).seat : undefined
    if (response.status !== 200 || typeof seat !== "string") {
      return yield* unreachable(`The model proxy at ${url} did not name its seat (${response.status})`)
    }
    const { model, row: provider } = yield* row(seat)
    return yield* languageLayer({ seat, protocol: provider.protocol, model, apiKey: undefined, apiUrl: url })
  }))))
}

// A seat's model id, or the id itself. Only a provider this module knows is
// stripped, because a bare model id may hold a colon (`llama3:8b`).
const modelOf = (modelId: string): string => {
  const colon = modelId.indexOf(":")
  return colon > 0 && Object.hasOwn(providers, modelId.slice(0, colon)) ? modelId.slice(colon + 1) : modelId
}

/**
 * The context window, in tokens, of a model id or a seat. A model the
 * catalog has not met gets a conservative 128,000; never zero.
 *
 * @since 0.0.13
 */
export const contextWindow = (modelId: string): number => catalog.contextWindow(modelOf(modelId))

/**
 * The context window of a model the catalog has met, or `undefined`, for a
 * display that must not invent one.
 *
 * @since 0.0.13
 */
export const knownContextWindow = (modelId: string): number | undefined =>
  catalog.knownContextWindow(modelOf(modelId))

/**
 * The largest output budget, in tokens, a known model accepts, or
 * `undefined`.
 *
 * @since 0.0.13
 */
export const maxOutputTokens = (modelId: string): number | undefined => catalog.maxOutputTokens(modelOf(modelId))

/**
 * USD per million tokens for each token class.
 *
 * @since 0.0.13
 */
export interface Rates {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

/**
 * One model's rate card: standard rates (`cacheWrite` is the 5-minute cache
 * write, `cacheWrite1h` the 1-hour one), an optional long-context card that
 * prices the whole call from `longContextFrom` prompt tokens, and an optional
 * dated successor from `nextFrom`.
 *
 * @since 0.0.13
 */
export interface Price extends Rates {
  readonly cacheWrite1h: number
  readonly provider: string
  readonly context: string
  readonly longContextFrom?: number | undefined
  readonly longContext?: Rates & { readonly cacheWrite1h: number } | undefined
  readonly nextFrom?: string | undefined
  readonly next?: Price | undefined
}

/**
 * The rate card, keyed by the model id sent on the wire.
 *
 * @since 0.0.13
 */
export const prices: Readonly<Record<string, Price>> = catalog.prices

/**
 * One call's USD cost, and whether the provider reported it or it was priced
 * from usage.
 *
 * @since 0.0.13
 */
export interface Cost {
  readonly costUsd: number
  readonly costSource: "reported" | "estimated"
}

/**
 * Options for {@link cost}: rate cards to use instead of {@link prices}
 * (spread `prices` to override single rows; a row may be plain
 * {@link Rates}), and the instant whose prices apply, in epoch milliseconds.
 *
 * @since 0.0.13
 */
export interface CostOptions {
  readonly table?: Readonly<Record<string, Rates | Price>> | undefined
  readonly at?: number | undefined
}

/**
 * One call's token counts, with cache reads and writes inside `inputTokens`,
 * and the provider's own charge when it reports one.
 *
 * @since 0.0.13
 */
export interface Counts {
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
  readonly cachedInputTokens?: number | undefined
  readonly cacheWriteTokens?: number | undefined
  readonly costUsd?: number | undefined
}

/**
 * A call's usage: Effect's, as a response's `usage`, or {@link Counts}.
 *
 * @since 0.0.13
 */
export type Usage = Response.Usage | Counts

const counts = (usage: Usage): Counts => {
  if (typeof usage.inputTokens !== "object") return usage as Counts
  const { inputTokens: input, outputTokens: output } = usage as Response.Usage
  const parts = [input.uncached, input.cacheRead, input.cacheWrite]
  return {
    inputTokens: input.total ?? (input.uncached === undefined ? undefined : parts.reduce<number>((sum, n) => sum + (n ?? 0), 0)),
    outputTokens: output.total,
    cachedInputTokens: input.cacheRead,
    cacheWriteTokens: input.cacheWrite
  }
}

/**
 * The USD cost of one call: the provider's reported charge when it has a
 * valid one, otherwise its usage priced under the model's rate card. A seat
 * or a gateway id resolves to its model, and a dated snapshot to its family.
 * `undefined` for a model the card does not price or for malformed usage,
 * which is never priced low.
 *
 * @since 0.0.13
 */
export const cost = (usage: Usage, modelId: string | undefined, options?: CostOptions): Cost | undefined =>
  catalog.cost(counts(usage), modelId, options)
