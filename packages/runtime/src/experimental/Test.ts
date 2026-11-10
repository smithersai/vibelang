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
 * @experimental
 * @since 0.0.13
 */
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { AiError, LanguageModel, Prompt, Tool } from "effect/ai"
import type { Response } from "effect/ai"
import * as canonical from "./internal/canonical.js"

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

type Claim =
  | { readonly _tag: "Call"; readonly index: number; readonly call: RecordedCall }
  | { readonly _tag: "None" }

const makeReplay = (fixture: Fixture) =>
  Effect.gen(function*() {
    const keys = fixture.calls.map(recordedKey)
    const used = yield* Ref.make<ReadonlyArray<boolean>>(fixture.calls.map(() => false))
    // The first unclaimed recording that matches, claimed in the same step
    // that finds it, so concurrent requests never share one.
    const claim = (options: LanguageModel.ProviderOptions) => {
      const request = canonicalRequest(options)
      return Ref.modify(used, (claimed): readonly [Claim, ReadonlyArray<boolean>] => {
        const index = keys.findIndex((key, i) => !claimed[i] && matches(key, request))
        if (index < 0) return [{ _tag: "None" }, claimed]
        return [{ _tag: "Call", index, call: fixture.calls[index]! }, claimed.map((value, i) => value || i === index)]
      })
    }
    const model = yield* LanguageModel.make({
      generateText: (options) =>
        Effect.flatMap(claim(options), (claimed) => {
          if (claimed._tag === "None") return Effect.die(unrecorded("generateText", options))
          const { call, index } = claimed
          if (call.failure !== undefined) return Effect.fail(recordedFailure(call, index))
          if (call.response === undefined) {
            return Effect.die(new InvalidFixture({ message: `calls[${index}] has no response for generateText` }))
          }
          return Effect.succeed([...call.response] as unknown as Array<Response.PartEncoded>)
        }),
      streamText: (options) =>
        Stream.unwrap(Effect.map(claim(options), (claimed) => {
          if (claimed._tag === "None") return Stream.die(unrecorded("streamText", options))
          const { call, index } = claimed
          const parts = call.stream === undefined
            ? Stream.die(new InvalidFixture({ message: `calls[${index}] has no stream for streamText` }))
            : Stream.fromIterable(call.stream as unknown as Array<Response.StreamPartEncoded>)
          return call.failure === undefined ? parts : parts.pipe(Stream.concat(Stream.fail(recordedFailure(call, index))))
        }))
    })
    const recording = Recording.of({
      unconsumed: Effect.map(Ref.get(used), (claimed) => fixture.calls.filter((_, i) => !claimed[i]))
    })
    return Context.make(LanguageModel.LanguageModel, model).pipe(Context.add(Recording, recording))
  })

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
  Layer.effectContext(Effect.suspend(() => makeReplay(decodeFixture(fixture))))
