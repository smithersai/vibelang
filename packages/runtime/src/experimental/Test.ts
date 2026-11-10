/**
 * Test doubles for agentic programs (VIP-71).
 *
 * A unit test cannot hold a model still: the same prompt costs money, needs a
 * key and a network, and answers differently each time. This module adds
 * doubles, each an Effect layer a test provides, for what Effect has no
 * double of. Effect's own `TestClock` and `TestConsole` stay as they are, and
 * the runner stays `@effect/vitest`.
 *
 * {@link replay} stands in for Effect's `LanguageModel`. It answers each
 * request from a {@link Fixture}, a recording of what a provider once
 * answered, and never calls a provider:
 *
 * - A recorded call is claimed once. Two equal requests need two recordings.
 * - A request no unclaimed recording matches is a defect,
 *   {@link UnrecordedCall}: the fixture does not describe this run, which is
 *   a broken test, not a provider failure the program should handle.
 * - Matching reads the request a provider receives (the prompt, the tools,
 *   the response format and the tool choice), never a model id, so a
 *   recording made with one model replays under another.
 *
 * {@link record} makes recordings. It replays a file and sends a request the
 * file is missing to a live model the test names, then appends the answer.
 * Recording and replaying are two calls, so a deleted fixture never turns a
 * free test run into a paid one.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { AiError, LanguageModel, Prompt, Response, Tool, Toolkit } from "effect/ai"
import { ChildProcessSpawner } from "effect/process"
import { WorkflowEngine } from "effect/workflow"
import type { Workflow } from "effect/workflow"
import * as Durable from "./Durable.js"
import * as canonical from "./internal/canonical.js"
import * as testHost from "./internal/testHost.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Test"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Test"

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const Json = Schema.Json

const RecordedTool = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  parameters: Schema.optional(Json)
})

const RecordedResponseFormat = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text") }),
  Schema.Struct({ type: Schema.Literal("json"), objectName: Schema.String, schema: Schema.optional(Json) })
])

const RecordedRequest = Schema.Struct({
  prompt: Json,
  tools: Schema.optional(Schema.Array(RecordedTool)),
  responseFormat: Schema.optional(RecordedResponseFormat),
  toolChoice: Schema.optional(Json)
})

const RecordedPart = Schema.Record(Schema.String, Json)

const RecordedCallSchema = Schema.Struct({
  request: RecordedRequest,
  response: Schema.optional(Schema.Array(RecordedPart)),
  stream: Schema.optional(Schema.Array(RecordedPart)),
  failure: Schema.optional(Json)
})

const FixtureSchema = Schema.Struct({ calls: Schema.Array(RecordedCallSchema) })

/**
 * One recorded model call: the request a provider received and what it
 * answered.
 *
 * - `request.prompt` is a prompt as `Prompt.make` accepts it: a string, or
 *   messages in their encoded form.
 * - `request.tools`, `request.responseFormat` and `request.toolChoice` are
 *   compared only when present. A recording that {@link record} writes has
 *   them all; a hand-written one may name the prompt alone.
 * - `response` holds the encoded response parts `generateText` and
 *   `generateObject` decode; `stream` holds the encoded stream parts
 *   `streamText` decodes. `failure` is an encoded `AiError` the call fails
 *   with instead.
 *
 * @category models
 * @since 0.0.13
 */
export interface RecordedCall {
  readonly request: {
    readonly prompt: unknown
    readonly tools?: ReadonlyArray<{ readonly name: string; readonly description?: string; readonly parameters?: unknown }>
    readonly responseFormat?: { readonly type: string; readonly objectName?: string; readonly schema?: unknown }
    readonly toolChoice?: unknown
  }
  readonly response?: ReadonlyArray<{ readonly type: string; readonly [key: string]: unknown }>
  readonly stream?: ReadonlyArray<{ readonly type: string; readonly [key: string]: unknown }>
  readonly failure?: unknown
}

/**
 * A recording of model calls: a JSON value, usually a file imported beside
 * the test with `with { type: "json" }`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Fixture {
  readonly calls: ReadonlyArray<RecordedCall>
}

/**
 * A fixture that is not a recording. The layer that reads it dies with this
 * defect, because a test with a broken fixture cannot run.
 *
 * @category errors
 * @since 0.0.13
 */
export class InvalidFixture extends Data.TaggedError("InvalidFixture")<{
  readonly message: string
}> {}

/**
 * A model request that no unclaimed recording describes. It is a defect,
 * never a typed error: the test's fixture is out of date, and replay never
 * falls back to a provider. The message names the request's size, its tools
 * and the end of its last message, not the whole transcript.
 *
 * @category errors
 * @since 0.0.13
 */
export class UnrecordedCall extends Data.TaggedError("UnrecordedCall")<{
  readonly method: "generateText" | "streamText"
  readonly messages: number
  readonly tools: ReadonlyArray<string>
  readonly responseFormat: string
  readonly lastMessage: string
  readonly message: string
}> {}

// -----------------------------------------------------------------------------
// Request canonicalization
// -----------------------------------------------------------------------------

interface CanonicalRequest {
  readonly prompt: string
  readonly tools: string
  readonly responseFormat: string
  readonly toolChoice: string
}

const encodePrompt = Schema.encodeSync(Prompt.Prompt)

const promptJson = (prompt: Prompt.Prompt): string => canonical.canonicalJson(plain(encodePrompt(prompt).content))

// JSON has no `undefined`; a recording read back from a file has none either.
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null))

const toolJson = (tools: ReadonlyArray<Tool.Any>): string =>
  canonical.canonicalJson(plain(tools.map((tool) => ({
    name: tool.name,
    description: Tool.getDescription(tool),
    parameters: Tool.getJsonSchema(tool)
  }))))

const formatJson = (format: LanguageModel.ProviderOptions["responseFormat"]): string =>
  canonical.canonicalJson(plain(
    format.type === "text"
      ? { type: "text" }
      : { type: "json", objectName: format.objectName, schema: Tool.getJsonSchemaFromSchema(format.schema) }
  ))

const canonicalRequest = (options: LanguageModel.ProviderOptions): CanonicalRequest => ({
  prompt: promptJson(options.prompt),
  tools: toolJson(options.tools),
  responseFormat: formatJson(options.responseFormat),
  toolChoice: canonical.canonicalJson(plain(options.toolChoice))
})

// A recorded request keeps only the fields it names; an absent field matches
// any request.
interface RecordedKey {
  readonly prompt: string
  readonly tools: string | undefined
  readonly responseFormat: string | undefined
  readonly toolChoice: string | undefined
}

const recordedKey = (call: RecordedCall, index: number): RecordedKey => {
  let prompt: string
  try {
    prompt = promptJson(Prompt.make(call.request.prompt as Prompt.RawInput))
  } catch (error) {
    throw new InvalidFixture({ message: `calls[${index}].request.prompt is not a prompt: ${String(error)}` })
  }
  const { responseFormat, toolChoice, tools } = call.request
  return {
    prompt,
    tools: tools === undefined ? undefined : canonical.canonicalJson(plain(tools)),
    responseFormat: responseFormat === undefined ? undefined : canonical.canonicalJson(plain(responseFormat)),
    toolChoice: toolChoice === undefined ? undefined : canonical.canonicalJson(plain(toolChoice))
  }
}

const matches = (key: RecordedKey, request: CanonicalRequest): boolean =>
  key.prompt === request.prompt &&
  (key.tools === undefined || key.tools === request.tools) &&
  (key.responseFormat === undefined || key.responseFormat === request.responseFormat) &&
  (key.toolChoice === undefined || key.toolChoice === request.toolChoice)

const decodeFixture = (fixture: unknown): Fixture => {
  const decoded = Schema.decodeUnknownExit(FixtureSchema)(fixture)
  if (decoded._tag === "Failure") {
    throw new InvalidFixture({ message: `not a model recording: ${String(decoded.cause)}` })
  }
  return decoded.value as Fixture
}

const decodeAiError = Schema.decodeUnknownSync(AiError.AiError)

const recordedFailure = (call: RecordedCall, index: number): AiError.AiError => {
  try {
    return decodeAiError(call.failure)
  } catch (error) {
    throw new InvalidFixture({ message: `calls[${index}].failure is not an encoded AiError: ${String(error)}` })
  }
}

const lastText = (prompt: Prompt.Prompt): string => {
  const last = prompt.content[prompt.content.length - 1]
  if (last === undefined) return ""
  const text = typeof last.content === "string"
    ? last.content
    : last.content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : `[${part.type}]`)).join(" ")
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

const unrecorded = (method: UnrecordedCall["method"], options: LanguageModel.ProviderOptions): UnrecordedCall => {
  const tools = options.tools.map((tool) => tool.name)
  const responseFormat = options.responseFormat.type === "text" ? "text" : `json ${options.responseFormat.objectName}`
  const lastMessage = lastText(options.prompt)
  return new UnrecordedCall({
    method,
    messages: options.prompt.content.length,
    tools,
    responseFormat,
    lastMessage,
    message: `no unclaimed recording matches this ${method} request (${options.prompt.content.length} messages, ` +
      `tools [${tools.join(", ")}], response ${responseFormat}); its last message is ${JSON.stringify(lastMessage)}`
  })
}

// -----------------------------------------------------------------------------
// Replay
// -----------------------------------------------------------------------------

/**
 * What a replay has left: the recorded calls no request has claimed. A test
 * that must use its whole recording asserts this is empty.
 *
 * @category services
 * @since 0.0.13
 */
export class Recording extends /* @__PURE__ */ Context.Service<Recording, {
  readonly unconsumed: Effect.Effect<ReadonlyArray<RecordedCall>>
}>()("vibelang/experimental/Test/Recording") {}

/**
 * The recorded calls the current replay has not served.
 *
 * @category accessors
 * @since 0.0.13
 */
export const unconsumed: Effect.Effect<ReadonlyArray<RecordedCall>, never, Recording> = Effect.gen(function*() {
  const recording = yield* Recording
  return yield* recording.unconsumed
})

interface State {
  readonly calls: ReadonlyArray<RecordedCall>
  readonly keys: ReadonlyArray<RecordedKey>
  readonly used: ReadonlyArray<boolean>
}

type Claim =
  | { readonly _tag: "Call"; readonly index: number; readonly call: RecordedCall }
  | { readonly _tag: "None" }

// What a model does with a request no unclaimed recording matches.
interface Miss {
  readonly generateText: (
    options: LanguageModel.ProviderOptions
  ) => Effect.Effect<Array<Response.PartEncoded>, AiError.AiError>
  readonly streamText: (
    options: LanguageModel.ProviderOptions
  ) => Stream.Stream<Response.StreamPartEncoded, AiError.AiError>
}

const initialState = (fixture: Fixture): State => ({
  calls: fixture.calls,
  keys: fixture.calls.map(recordedKey),
  used: fixture.calls.map(() => false)
})

const makeModel = (state: Ref.Ref<State>, miss: Miss) =>
  Effect.gen(function*() {
    // The first unclaimed recording that matches, claimed in the same step
    // that finds it, so concurrent requests never share one.
    const claim = (options: LanguageModel.ProviderOptions) => {
      const request = canonicalRequest(options)
      return Ref.modify(state, (current): readonly [Claim, State] => {
        const index = current.keys.findIndex((key, i) => !current.used[i] && matches(key, request))
        if (index < 0) return [{ _tag: "None" }, current]
        return [
          { _tag: "Call", index, call: current.calls[index]! },
          { ...current, used: current.used.map((value, i) => value || i === index) }
        ]
      })
    }
    const model = yield* LanguageModel.make({
      generateText: (options) =>
        Effect.flatMap(claim(options), (claimed) => {
          if (claimed._tag === "None") return miss.generateText(options)
          const { call, index } = claimed
          if (call.failure !== undefined) return Effect.fail(recordedFailure(call, index))
          if (call.response === undefined) {
            return Effect.die(new InvalidFixture({ message: `calls[${index}] has no response for generateText` }))
          }
          return Effect.succeed([...call.response] as unknown as Array<Response.PartEncoded>)
        }),
      streamText: (options) =>
        Stream.unwrap(Effect.map(claim(options), (claimed) => {
          if (claimed._tag === "None") return miss.streamText(options)
          const { call, index } = claimed
          const parts = call.stream === undefined
            ? Stream.die(new InvalidFixture({ message: `calls[${index}] has no stream for streamText` }))
            : Stream.fromIterable(call.stream as unknown as Array<Response.StreamPartEncoded>)
          return call.failure === undefined ? parts : parts.pipe(Stream.concat(Stream.fail(recordedFailure(call, index))))
        }))
    })
    const recording = Recording.of({
      unconsumed: Effect.map(Ref.get(state), (current) => current.calls.filter((_, i) => !current.used[i]))
    })
    return Context.make(LanguageModel.LanguageModel, model).pipe(Context.add(Recording, recording))
  })

const strict: Miss = {
  generateText: (options) => Effect.die(unrecorded("generateText", options)),
  streamText: (options) => Stream.die(unrecorded("streamText", options))
}

/**
 * A `LanguageModel` that answers from a recording and never calls a
 * provider. It also provides {@link Recording}.
 *
 * A malformed fixture dies with {@link InvalidFixture} when the layer is
 * built; a request no unclaimed recording matches dies with
 * {@link UnrecordedCall}.
 *
 * @category layers
 * @since 0.0.13
 */
export const replay = (fixture: Fixture): Layer.Layer<LanguageModel.LanguageModel | Recording> =>
  Layer.effectContext(Effect.suspend(() => Effect.flatMap(Ref.make(initialState(decodeFixture(fixture))), (state) => makeModel(state, strict))))

// -----------------------------------------------------------------------------
// Record
// -----------------------------------------------------------------------------

/**
 * A model call {@link record} would not write, because the call holds a
 * credential: a recording is meant to be committed. The defect names the rule
 * that matched, never the text. Nothing is written for the call.
 *
 * @category errors
 * @since 0.0.13
 */
export class CredentialInRecording extends Data.TaggedError("CredentialInRecording")<{
  readonly rule: string
  readonly message: string
}> {}

// The token-shaped rules of a journal redactor: each matches a credential by
// its own shape, not by a field name, so an ordinary schema field named
// `token` or `maxTokens` never matches.
const credentialRules: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> = [
  {
    id: "private-key-block",
    pattern: /-----BEGIN[^-]*PRIVATE KEY(?: BLOCK)?-----/
  },
  {
    id: "jwt",
    pattern:
      /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-])([A-Za-z0-9_-]*?)\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
  },
  { id: "api-key", pattern: /(?<![A-Za-z0-9])(?:sk|pk)[-_][A-Za-z0-9][A-Za-z0-9_-]{7,}/ },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/ },
  { id: "github-fine-grained-token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])/ },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])/ },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35,}(?![0-9A-Za-z_-])/ }
]

// A provider streams a few characters per delta, so a credential the model
// emitted is split across parts. Each streamed text is joined in order and
// scanned beside the serialized call.
const streamedTexts = (parts: ReadonlyArray<{ readonly type: string; readonly [key: string]: unknown }>) => {
  const joined = new Map<string, string>()
  for (const part of parts) {
    if (typeof part.delta === "string") {
      const key = `${part.type}\u0000${String(part.id)}`
      joined.set(key, (joined.get(key) ?? "") + part.delta)
    }
  }
  return [...joined.values()]
}

const credentialIn = (call: RecordedCall): string | undefined => {
  const texts = [JSON.stringify(call), ...streamedTexts(call.stream ?? [])]
  return credentialRules.find((rule) => texts.some((text) => rule.pattern.test(text)))?.id
}

// The request as a provider received it, in the form a recording stores.
const recordedRequest = (options: LanguageModel.ProviderOptions): RecordedCall["request"] =>
  plain({
    prompt: encodePrompt(options.prompt).content,
    tools: options.tools.map((tool) => ({
      name: tool.name,
      description: Tool.getDescription(tool),
      parameters: Tool.getJsonSchema(tool)
    })),
    responseFormat: options.responseFormat.type === "text"
      ? { type: "text" }
      : {
        type: "json",
        objectName: options.responseFormat.objectName,
        schema: Tool.getJsonSchemaFromSchema(options.responseFormat.schema)
      },
    toolChoice: options.toolChoice
  }) as RecordedCall["request"]

const encodeFailure = (error: AiError.AiError): unknown => plain(Schema.encodeSync(AiError.AiError)(error))

/**
 * Options for {@link record}.
 *
 * @category models
 * @since 0.0.13
 */
export interface RecordOptions<E, R> {
  /** The model a miss calls, such as a provider's layer. It is built at the first miss. */
  readonly live: Layer.Layer<LanguageModel.LanguageModel, E, R>
}

/**
 * A `LanguageModel` that replays the recording at `path` and records what it
 * is missing. A request an unclaimed recording matches is answered from it,
 * as {@link replay} answers; a request none matches goes to the `live`
 * model, and its answer is appended to the file before the caller sees it.
 * A file that does not exist is an empty recording.
 *
 * What it writes:
 *
 * - A finished call: its request as the provider received it and its
 *   encoded response parts or stream parts. A typed `AiError` the provider
 *   answered with is written as `failure`.
 * - Never an interrupted call or a defect: a truncated stream would replay
 *   as an aborted turn.
 * - Never a call that holds a credential: the call dies with
 *   {@link CredentialInRecording} and nothing is written.
 *
 * Each append rewrites the file through a temporary file and a rename, so a
 * crash leaves the old recording or the new one. The live layer is built at
 * the first miss, so a complete recording runs without a key; a live layer
 * that fails to build is a defect. The path is resolved as Effect's
 * `FileSystem` resolves it, from the working directory.
 *
 * @category layers
 * @since 0.0.13
 */
export const record = <E, R>(
  path: string,
  options: RecordOptions<E, R>
): Layer.Layer<LanguageModel.LanguageModel | Recording, PlatformError, FileSystem.FileSystem | Exclude<R, Scope.Scope>> =>
  Layer.effectContext(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const existing = (yield* fs.exists(path)) ? yield* fs.readFileString(path) : undefined
    const fixture = existing === undefined ? { calls: [] } : yield* Effect.try({
      try: () => decodeFixture(JSON.parse(existing)),
      catch: (error) => error
    }).pipe(Effect.orDie)
    const state = yield* Ref.make(initialState(fixture))
    const scope = yield* Effect.scope
    const services = yield* Effect.context<Exclude<R, Scope.Scope>>()
    const live = yield* Effect.cached(
      Layer.buildWithScope(options.live, scope).pipe(
        Effect.map((context) => Context.get(context, LanguageModel.LanguageModel)),
        Effect.provideContext(services as Context.Context<R>),
        Effect.orDie
      )
    )
    const lock = yield* Semaphore.make(1)
    const slash = path.lastIndexOf("/")
    const directory = slash > 0 ? path.slice(0, slash) : undefined
    const save = (call: RecordedCall) => {
      const rule = credentialIn(call)
      if (rule !== undefined) {
        return Effect.die(
          new CredentialInRecording({ rule, message: `the model call holds a credential (${rule}); it was not recorded` })
        )
      }
      return lock.withPermits(1)(Effect.gen(function*() {
        const current = yield* Ref.updateAndGet(state, (current) => ({
          calls: [...current.calls, call],
          keys: [...current.keys, recordedKey(call, current.calls.length)],
          used: [...current.used, true]
        }))
        if (directory !== undefined) yield* fs.makeDirectory(directory, { recursive: true })
        const temporary = `${path}.${Date.now()}.tmp`
        yield* fs.writeFileString(temporary, `${JSON.stringify({ calls: current.calls }, null, 2)}\n`)
        yield* fs.rename(temporary, path)
      })).pipe(Effect.orDie)
    }
    const miss: Miss = {
      generateText: (request) =>
        Effect.gen(function*() {
          const model = yield* live
          const toolkit = Toolkit.make(...request.tools)
          const generate = {
            prompt: request.prompt,
            toolkit,
            toolChoice: request.toolChoice,
            disableToolCallResolution: true
          } as const
          const response = request.responseFormat.type === "json"
            ? model.generateObject({
              ...generate,
              objectName: request.responseFormat.objectName,
              schema: request.responseFormat.schema as Schema.Codec<Record<string, unknown>, Record<string, unknown>>
            } as never)
            : model.generateText(generate as never)
          const answered = yield* (response as Effect.Effect<LanguageModel.GenerateTextResponse<any>, AiError.AiError>).pipe(
            Effect.tapError((error) => save({ request: recordedRequest(request), failure: encodeFailure(error) }))
          )
          const encode = Schema.encodeSync(Response.Part(toolkit) as unknown as Schema.Codec<unknown, Response.PartEncoded>)
          const parts = answered.content.map((part) => plain(encode(part)) as Response.PartEncoded)
          yield* save({ request: recordedRequest(request), response: parts as unknown as RecordedCall["response"] })
          return parts
        }),
      streamText: (request) =>
        Stream.unwrap(Effect.map(live, (model) => {
          const toolkit = Toolkit.make(...request.tools)
          const encode = Schema.encodeSync(
            Response.StreamPart(toolkit) as unknown as Schema.Codec<unknown, Response.StreamPartEncoded>
          )
          const parts: Array<Response.StreamPartEncoded> = []
          const stream = model.streamText({
            prompt: request.prompt,
            toolkit,
            toolChoice: request.toolChoice,
            disableToolCallResolution: true
          } as never) as Stream.Stream<Response.AnyPart, AiError.AiError>
          return stream.pipe(
            Stream.map((part) => plain(encode(part)) as Response.StreamPartEncoded),
            Stream.tap((part) => Effect.sync(() => void parts.push(part))),
            Stream.onExit((exit) => {
              const stored = { request: recordedRequest(request), stream: parts as unknown as RecordedCall["stream"] }
              if (Exit.isSuccess(exit)) return save(stored)
              if (Cause.hasInterrupts(exit.cause) || Cause.hasDies(exit.cause)) return Effect.void
              const error = Cause.findErrorOption(exit.cause)
              return error._tag === "Some" ? save({ ...stored, failure: encodeFailure(error.value) }) : Effect.void
            })
          )
        }))
    }
    return yield* makeModel(state, miss)
  }))

// -----------------------------------------------------------------------------
// Durable engines
// -----------------------------------------------------------------------------

/**
 * A durable engine for tests: `Experimental.Durable.memory`, a journaled
 * engine over a fresh in-memory store. Under `@effect/vitest`'s `it.effect`
 * its clock is Effect's `TestClock`.
 *
 * It proves a plan and a journal, never recovery: a memory engine that is not
 * restarted never replays. Use {@link restartable} for a crash test.
 *
 * @category layers
 * @since 0.0.13
 */
export const durable: Layer.Layer<WorkflowEngine.WorkflowEngine | Durable.Durable> = Durable.memory

/**
 * The controls of a {@link restartable} engine.
 *
 * @category services
 * @since 0.0.13
 */
export class Restartable extends /* @__PURE__ */ Context.Service<Restartable, {
  readonly crash: Effect.Effect<void>
}>()("vibelang/experimental/Test/Restartable") {}

/**
 * Kills the {@link restartable} engine as a process death and starts a fresh
 * engine over the same store. Every run the old engine was driving stops at
 * once, with no orderly suspension; the next execution of a stopped run
 * resumes it, finished steps return their recorded results and an
 * unfinished step runs again.
 *
 * @category accessors
 * @since 0.0.13
 */
export const crash: Effect.Effect<void, never, Restartable> = Effect.gen(function*() {
  const restartable = yield* Restartable
  yield* restartable.crash
})

interface EngineInstance {
  readonly scope: Scope.Closeable
  readonly engine: WorkflowEngine.WorkflowEngine["Service"]
  readonly durable: Durable.Durable
}

interface Registration {
  readonly workflow: Workflow.Any
  readonly execute: (payload: any, executionId: string) => Effect.Effect<any, any, any>
  readonly context: Context.Context<never>
}

/**
 * A journaled engine over one in-memory store that a test can crash with
 * {@link crash}. Provide it where a program provides its engine:
 * `W.toLayer(body).pipe(Layer.provide(tasks), Layer.provideMerge(Experimental.Test.restartable))`.
 *
 * The engine a program sees is a stable front for the current instance. A
 * crash closes the current instance's scope, which stops its run fibers the
 * way a killed process stops, then builds a fresh instance over the same
 * store and registers on it every workflow the program registered. Only this
 * engine, or a real store closed and reopened, proves recovery.
 *
 * @category layers
 * @since 0.0.13
 */
export const restartable: Layer.Layer<WorkflowEngine.WorkflowEngine | Durable.Durable | Restartable> = Layer
  .effectContext(Effect.gen(function*() {
    const store = Durable.makeMemoryStore()
    const build = Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(Durable.layerStore(store), scope)
      return {
        scope,
        engine: Context.get(context, WorkflowEngine.WorkflowEngine),
        durable: Context.get(context, Durable.Durable)
      } satisfies EngineInstance
    })
    let current: EngineInstance = yield* build
    yield* Effect.addFinalizer((exit) => Scope.close(current.scope, exit))
    const registrations: Array<Registration> = []
    const register = (workflow: Workflow.Any, execute: Registration["execute"]) =>
      Effect.gen(function*() {
        const context = yield* Effect.context<never>()
        registrations.push({ workflow, execute, context })
        yield* current.engine.register(workflow as any, execute)
      })
    // Each member is read from the current instance when it is used, so an
    // engine captured before a crash talks to the instance after it.
    const engine = new Proxy(current.engine, {
      get: (_, key) => (key === "register" ? register : Reflect.get(current.engine, key))
    }) as WorkflowEngine.WorkflowEngine["Service"]
    const durableFront = new Proxy(current.durable, {
      get: (_, key) => Reflect.get(current.durable, key)
    })
    const crashNow: Effect.Effect<void> = Effect.gen(function*() {
      yield* Scope.close(current.scope, Exit.void)
      current = yield* build
      for (const registration of registrations) {
        yield* current.engine.register(registration.workflow as any, registration.execute).pipe(
          Effect.provideContext(
            registration.context.pipe(
              Context.add(WorkflowEngine.WorkflowEngine, engine),
              Context.add(Scope.Scope, current.scope)
            ) as Context.Context<any>
          )
        ) as Effect.Effect<void>
      }
    })
    return Context.make(WorkflowEngine.WorkflowEngine, engine).pipe(
      Context.add(Durable.Durable, durableFront),
      Context.add(Restartable, Restartable.of({ crash: crashNow }))
    )
  }))

// -----------------------------------------------------------------------------
// Host
// -----------------------------------------------------------------------------

/**
 * The machine {@link host} provides.
 *
 * - `files`: the files that exist, by path, with their text. Their parent
 *   directories exist too.
 * - `commands`: what each command prints and the code it exits with, keyed
 *   by its command line, the command and its arguments joined by spaces,
 *   such as `"git status --short"`.
 *
 * @category models
 * @since 0.0.13
 */
export interface HostOptions {
  readonly files?: Readonly<Record<string, string>> | undefined
  readonly commands?: Readonly<Record<string, testHost.ScriptedCommand>> | undefined
}

/**
 * A deterministic machine: Effect's `FileSystem` over the files in
 * `options`, held in memory, Effect's POSIX `Path`, and a
 * `ChildProcessSpawner` that answers from a table of commands. Nothing
 * reaches the operating system, so the test runs the same on any machine and
 * in a browser.
 *
 * - Paths are POSIX; a relative path starts at `/`. Reading, writing,
 *   appending, directories, `stat`, `remove`, `rename` and `copyFile` work;
 *   other members fail with `NotFound`, as Effect's `FileSystem.makeNoop`
 *   does. File times are fixed.
 * - A command the table does not list fails to spawn with a `NotFound`
 *   `PlatformError`, as a missing binary does. A piped command fails with
 *   `BadArgument`.
 * - Each build of the layer starts from `options` again.
 *
 * @category layers
 * @since 0.0.13
 */
export const host = (
  options: HostOptions = {}
): Layer.Layer<FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.mergeAll(
    Layer.effect(FileSystem.FileSystem, Effect.sync(() => testHost.makeMemoryFileSystem(options.files ?? {}))),
    Path.layer,
    Layer.effect(
      ChildProcessSpawner.ChildProcessSpawner,
      Effect.sync(() => testHost.makeScriptedSpawner(options.commands ?? {}))
    )
  )
