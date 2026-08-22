/**
 * A real `ModelAdapter` for the Anthropic Messages API.
 *
 * This is the drop-in replacement for `ScriptedModel`: it implements exactly
 * the same boundary — a pinned `ComponentIdentity`, a `ModelDescriptor` that
 * flows into the turn id, one `generate` call, and the same fenced-TypeScript
 * extraction — but it asks Claude instead of replaying a script.
 *
 * It deliberately lives under `examples/`, not `src/`: `poc/tsconfig.emit.json`
 * emits `src/**` only, so `@anthropic-ai/sdk` stays a `poc` devDependency and
 * never enters the published package's dependency closure. The `ModelAdapter`
 * interface in `src/agent/types.ts` is unchanged — that is the whole point of
 * the seam.
 */
import Anthropic from "@anthropic-ai/sdk"
import {
  declareCallableSurface,
  defineFunction,
  defineModelIdentity,
  extractTypeScript,
  sha256File,
  snapshotModelDescriptor,
} from "../../src/agent/index.ts"
import type {
  ComponentIdentity,
  JsonValue,
  ModelAdapter,
  ModelDescriptor,
  ModelRequest,
  ModelResponse,
} from "../../src/agent/index.ts"

/** Hash of this adapter's own source, exactly as `ScriptedModel` does. */
const ADAPTER_ARTIFACT = sha256File(new URL(import.meta.url))

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5"
/** Non-streaming default: large enough for a module, under the HTTP timeout. */
export const DEFAULT_MAX_TOKENS = 16_000
/** Server-side refusal fallbacks, routed by category by the server. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01"

/**
 * Prepended to the rendered system prompt, ahead of the turn's callable
 * surface. `ModelRequest.callableSurface` is the compiler-derived `Functions`
 * interface; a scripted model can ignore it, a real one cannot — without it the
 * model has no idea what it is allowed to call.
 */
const SURFACE_INSTRUCTION = [
  "Reply with one complete TypeScript module inside a single ```ts fenced code block, and nothing else.",
  "The module must `export default` an async function whose only parameter is the `Functions` object declared below.",
  "Only these declarations are in scope. There are no imports and no ambient globals:",
  "`process`, `Deno`, `fetch`, `Date`, and `Math.random` are all unavailable inside the sandbox.",
].join(" ")

/**
 * The slice of the Anthropic client this adapter uses. Narrowing it to two
 * methods is what lets a test inject a fake without a network or a key; the
 * real `new Anthropic()` satisfies it structurally.
 */
export interface AnthropicMessagesClient {
  readonly beta: {
    readonly messages: {
      create(
        params: Anthropic.Beta.MessageCreateParamsNonStreaming,
      ): Promise<Anthropic.Beta.BetaMessage>
    }
  }
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
  }
}

export interface AnthropicModelOptions {
  /** Model id, e.g. `claude-opus-5`. Recorded as the served model version. */
  readonly model?: string
  readonly maxTokens?: number
  /**
   * Server-side refusal fallbacks. On by default; `false` drops both the beta
   * flag and the `fallbacks` parameter and calls the stable endpoint.
   */
  readonly fallbacks?: boolean
  /** Component identity name; defaults to `model/anthropic`. */
  readonly name?: string
  /** Extra behavior-affecting configuration folded into the identity digest. */
  readonly config?: JsonValue
  /** Injected client. Omit in production; supply a fake in tests. */
  readonly client?: AnthropicMessagesClient
}

/**
 * Every failure this adapter raises, with a stable `name` per provider error
 * class. `CodingAgent` does not catch model failures — `generate` rejecting
 * aborts the turn — so the name is the only thing a caller can branch on.
 */
export class AnthropicModelError extends Error {
  readonly status?: number
  readonly requestId?: string

  constructor(
    name: string,
    message: string,
    options: { cause?: unknown; status?: number; requestId?: string } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = name
    if (options.status !== undefined) this.status = options.status
    if (options.requestId !== undefined) this.requestId = options.requestId
  }
}

export interface AnthropicPrompt {
  readonly system: string
  readonly messages: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly content: string }>
}

/**
 * Project a `ModelRequest` onto the Messages API shape: leading `system`
 * messages become the `system` parameter, the remaining turns are passed
 * through verbatim. Anything the API cannot represent fails here, before the
 * request is spent, rather than as a provider 400.
 *
 * `request.diagnostics` is not resent separately: `CodingAgent` already appends
 * the formatted diagnostics as the repair turn's user message.
 */
export function renderAnthropicPrompt(request: ModelRequest): AnthropicPrompt {
  const systems: string[] = []
  const turns: Array<{ role: "user" | "assistant"; content: string }> = []
  for (const message of request.messages) {
    if (message.content.trim() === "") {
      throw new AnthropicModelError(
        "AnthropicRequestError",
        `empty ${message.role} message: the Messages API rejects empty text`,
      )
    }
    if (message.role === "system") {
      if (turns.length > 0) {
        throw new AnthropicModelError(
          "AnthropicRequestError",
          "a system message must come before the first user or assistant message",
        )
      }
      systems.push(message.content)
      continue
    }
    turns.push({ role: message.role, content: message.content })
  }
  if (turns.length === 0) {
    throw new AnthropicModelError("AnthropicRequestError", "prompt has no user message")
  }
  if (turns[0].role !== "user") {
    throw new AnthropicModelError(
      "AnthropicRequestError",
      "the first non-system message must be a user message",
    )
  }
  return Object.freeze({
    system: [...systems, `${SURFACE_INSTRUCTION}\n\n${request.callableSurface}`].join("\n\n"),
    messages: Object.freeze(turns),
  })
}

/** The served model, when the provider reports one this codebase can pin. */
function servedDescriptor(model: string): ModelDescriptor | undefined {
  try {
    return snapshotModelDescriptor(
      { provider: "anthropic", name: model, version: model },
      "served model",
    )
  } catch {
    return undefined
  }
}

function toModelResponse(message: Anthropic.Beta.BetaMessage | Anthropic.Message): ModelResponse {
  // `content` is a discriminated union: narrow, never index blindly.
  let text = ""
  let textBlocks = 0
  const fallbacks: JsonValue[] = []
  for (const block of message.content) {
    if (block.type === "text") {
      text += block.text
      textBlocks += 1
    } else if (block.type === "fallback") {
      fallbacks.push({ from: block.from.model, to: block.to.model })
    }
  }

  const metadata: Record<string, JsonValue> = {
    id: message.id,
    stopReason: message.stop_reason ?? null,
    servedModel: message.model,
    textBlocks,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  }
  // Populated only on a refusal, and either field may be null.
  const details = message.stop_details
  if (details !== null && details !== undefined) {
    metadata.stopDetails = {
      type: details.type,
      category: details.category ?? null,
      explanation: details.explanation ?? null,
    }
  }
  if (fallbacks.length > 0) metadata.fallbacks = fallbacks

  const served = servedDescriptor(message.model)
  return Object.freeze({
    text,
    ...(served === undefined ? {} : { model: served }),
    ...(message.stop_reason === null ? {} : { finishReason: message.stop_reason }),
    metadata: Object.freeze(metadata),
  })
}

/** Typed provider errors, most specific first. */
function translateProviderError(error: unknown): unknown {
  if (error instanceof Anthropic.RateLimitError) {
    return new AnthropicModelError("AnthropicRateLimitError", error.message, {
      cause: error,
      status: error.status,
      ...(error.requestID ? { requestId: error.requestID } : {}),
    })
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new AnthropicModelError("AnthropicAuthenticationError", error.message, {
      cause: error,
      status: error.status,
      ...(error.requestID ? { requestId: error.requestID } : {}),
    })
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AnthropicModelError("AnthropicBadRequestError", error.message, {
      cause: error,
      status: error.status,
      ...(error.requestID ? { requestId: error.requestID } : {}),
    })
  }
  // Also the landing place for connection and timeout errors, whose `status`
  // is undefined.
  if (error instanceof Anthropic.APIError) {
    return new AnthropicModelError("AnthropicApiError", error.message, {
      cause: error,
      ...(typeof error.status === "number" ? { status: error.status } : {}),
      ...(error.requestID ? { requestId: error.requestID } : {}),
    })
  }
  return error
}

/**
 * The real model, behind the same `ModelAdapter` seam the fake uses.
 *
 * Defaults: `claude-opus-5`, adaptive thinking (the model's own default — no
 * `thinking` parameter is sent, and `budget_tokens` would be rejected), and
 * server-side refusal fallbacks on. A refusal is returned as a well-formed
 * response with `finishReason: "refusal"` and its `stop_details` in metadata,
 * not as a throw: the agent loop's repair path decides what to do with it.
 */
export class AnthropicModel implements ModelAdapter {
  readonly identity: ComponentIdentity
  readonly model: ModelDescriptor
  readonly #modelId: string
  readonly #maxTokens: number
  readonly #fallbacks: boolean
  #client: AnthropicMessagesClient | undefined

  constructor(options: AnthropicModelOptions = {}) {
    const modelId = options.model ?? DEFAULT_ANTHROPIC_MODEL
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 200_000) {
      throw new RangeError("AnthropicModel maxTokens must be between 1 and 200000")
    }
    this.#modelId = modelId
    this.#maxTokens = maxTokens
    this.#fallbacks = options.fallbacks ?? true
    this.#client = options.client
    this.model = snapshotModelDescriptor(
      { provider: "anthropic", name: modelId, version: modelId },
      "AnthropicModel model",
    )
    this.identity = defineModelIdentity({
      name: options.name ?? "model/anthropic",
      artifactDigest: ADAPTER_ARTIFACT,
      model: this.model,
      config: {
        endpoint: this.#fallbacks ? "beta.messages.create" : "messages.create",
        maxTokens: this.#maxTokens,
        betas: this.#fallbacks ? [FALLBACK_BETA] : [],
        fallbacks: this.#fallbacks ? "default" : null,
        // Adaptive is the model default; sending a budget would be a 400.
        thinking: null,
        config: options.config ?? null,
      },
    })
  }

  /**
   * Lazy so constructing the adapter — and hashing its identity — never needs
   * credentials. `new Anthropic()` resolves `ANTHROPIC_API_KEY`,
   * `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile from the process.
   */
  #resolveClient(): AnthropicMessagesClient {
    this.#client ??= new Anthropic()
    return this.#client
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const prompt = renderAnthropicPrompt(request)
    const client = this.#resolveClient()
    const messages = prompt.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    try {
      const message = this.#fallbacks
        ? await client.beta.messages.create({
          model: this.#modelId,
          max_tokens: this.#maxTokens,
          system: prompt.system,
          messages,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        })
        : await client.messages.create({
          model: this.#modelId,
          max_tokens: this.#maxTokens,
          system: prompt.system,
          messages,
        })
      return toModelResponse(message)
    } catch (error) {
      throw translateProviderError(error)
    }
  }

  /**
   * Identical to the default extraction the scripted model gets, so swapping
   * adapters cannot change which bytes are compiled.
   */
  extractSource(response: ModelResponse): string {
    return extractTypeScript(response.text)
  }
}

/**
 * Live smoke check: one real call against the configured credentials.
 * `bun examples/agent/anthropic-model.ts`
 */
if (import.meta.main) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error(
      "No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in the environment; " +
        "an `ant auth login` profile also works, remove this guard to use one.",
    )
    process.exit(1)
  }
  const model = new AnthropicModel({ maxTokens: 2_000 })
  const callableSurface = declareCallableSurface({
    echo: defineFunction<{ text: string }, string>(
      "(input: { text: string }) => Promise<string>",
      ({ text }) => text.toUpperCase(),
      "uppercase text",
      { name: "demo/echo", config: null },
    ),
  })
  const response = await model.generate({
    turnId: "turn_live_smoke",
    attempt: 0,
    diagnostics: [],
    callableSurface,
    messages: [
      { role: "system", content: "You are a small deterministic coding agent." },
      { role: "user", content: "Call echo with the text \"live\" and return its result." },
    ],
  })
  console.log(JSON.stringify({
    identity: model.identity,
    model: model.model,
    finishReason: response.finishReason,
    metadata: response.metadata,
    source: model.extractSource(response),
  }, null, 2))
}
