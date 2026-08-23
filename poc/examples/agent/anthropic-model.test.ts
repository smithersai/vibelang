import { describe, expect, test } from "bun:test"
import Anthropic from "@anthropic-ai/sdk"
import {
  AnthropicModel,
  AnthropicModelError,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MAX_TOKENS,
  FALLBACK_BETA,
} from "./anthropic-model.ts"
import type { AnthropicMessagesClient } from "./anthropic-model.ts"
import {
  ScriptedModel,
  extractModelSource,
  normalizeModelResponse,
} from "../../src/agent/index.ts"
import type { ModelRequest, ModelResponse } from "../../src/agent/index.ts"

/**
 * The live call needs a credential *and* an explicit opt-in. A present key is
 * not sufficient evidence that it can bill a request — an unfunded key fails
 * the billing gate before the request body is ever validated — so a key alone
 * would make this suite red for reasons that have nothing to do with the
 * adapter. Everything else here runs against an injected fake client.
 */
const LIVE = Boolean(process.env.SMITHERS_LIVE_MODEL) &&
  Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN)

interface RecordedCall {
  readonly endpoint: "beta" | "stable"
  readonly params: Record<string, unknown>
}

/** A minimal provider response; cast once, here, instead of at every use. */
function reply(parts: Record<string, unknown> = {}): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: "```ts\nexport default async () => 1\n```" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 11, output_tokens: 22 },
    ...parts,
  } as unknown as Anthropic.Beta.BetaMessage
}

function fakeClient(respond: () => Anthropic.Beta.BetaMessage): {
  client: AnthropicMessagesClient
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const client: AnthropicMessagesClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push({ endpoint: "beta", params: params as unknown as Record<string, unknown> })
          return respond()
        },
      },
    },
    messages: {
      create: async (params) => {
        calls.push({ endpoint: "stable", params: params as unknown as Record<string, unknown> })
        return respond() as unknown as Anthropic.Message
      },
    },
  }
  return { client, calls }
}

const CALLABLE_SURFACE = [
  "interface Functions {",
  "  readonly echo: (input: { text: string }) => Promise<string>;",
  "}",
  "",
].join("\n")

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return Object.freeze({
    turnId: "turn_test",
    attempt: 0,
    diagnostics: [],
    callableSurface: CALLABLE_SURFACE,
    messages: [
      { role: "system", content: "You are a small deterministic coding agent." },
      { role: "user", content: "Write a turn." },
    ],
    ...overrides,
  }) as ModelRequest
}

describe("AnthropicModel request shape", () => {
  test("sends the documented defaults: opus-5, fallbacks on, no thinking parameter", async () => {
    const { client, calls } = fakeClient(() => reply())
    const model = new AnthropicModel({ client })
    await model.generate(request())

    expect(calls).toHaveLength(1)
    const { endpoint, params } = calls[0]
    expect(endpoint).toBe("beta")
    expect(params.model).toBe(DEFAULT_ANTHROPIC_MODEL)
    expect(params.model).toBe("claude-opus-5")
    expect(params.max_tokens).toBe(DEFAULT_MAX_TOKENS)
    expect(params.betas).toEqual([FALLBACK_BETA])
    expect(params.fallbacks).toBe("default")
    // Adaptive thinking is the model's own default; a budget would be a 400.
    expect("thinking" in params).toBe(false)
    // Prefill was removed on current models: no trailing assistant turn.
    expect(params.messages).toEqual([{ role: "user", content: "Write a turn." }])
    expect(String(params.system)).toContain("You are a small deterministic coding agent.")
    expect(String(params.system)).toContain(CALLABLE_SURFACE)
  })

  test("drops both the beta flag and the parameter when fallbacks are disabled", async () => {
    const { client, calls } = fakeClient(() => reply())
    const model = new AnthropicModel({ client, fallbacks: false })
    await model.generate(request())

    const { endpoint, params } = calls[0]
    expect(endpoint).toBe("stable")
    expect("betas" in params).toBe(false)
    expect("fallbacks" in params).toBe(false)
    expect("thinking" in params).toBe(false)
    expect(params.model).toBe(DEFAULT_ANTHROPIC_MODEL)
    expect(params.max_tokens).toBe(DEFAULT_MAX_TOKENS)
  })

  test("honors model and max_tokens overrides and passes repair turns through in order", async () => {
    const { client, calls } = fakeClient(() => reply())
    const model = new AnthropicModel({ client, model: "claude-sonnet-5", maxTokens: 64 })
    await model.generate(request({
      attempt: 1,
      messages: [
        { role: "system", content: "system one" },
        { role: "system", content: "system two" },
        { role: "user", content: "first task" },
        { role: "assistant", content: "bad module" },
        { role: "user", content: "it did not type-check" },
      ],
    }))

    const { params } = calls[0]
    expect(params.model).toBe("claude-sonnet-5")
    expect(params.max_tokens).toBe(64)
    expect(params.messages).toEqual([
      { role: "user", content: "first task" },
      { role: "assistant", content: "bad module" },
      { role: "user", content: "it did not type-check" },
    ])
    // Every leading system message is hoisted into the system parameter.
    expect(String(params.system)).toContain("system one")
    expect(String(params.system)).toContain("system two")
  })

  test("rejects prompts the Messages API cannot represent, before spending a call", async () => {
    const { client, calls } = fakeClient(() => reply())
    const model = new AnthropicModel({ client })
    const rejected: Array<readonly [string, ModelRequest]> = [
      ["system after a turn", request({
        messages: [
          { role: "user", content: "task" },
          { role: "system", content: "late system" },
        ],
      })],
      ["assistant first", request({ messages: [{ role: "assistant", content: "hello" }] })],
      ["no user message", request({ messages: [{ role: "system", content: "only system" }] })],
      ["empty content", request({
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "   " },
        ],
      })],
    ]
    for (const [label, invalid] of rejected) {
      const caught = await model.generate(invalid).then(() => undefined, (error: unknown) => error)
      expect(caught, label).toBeInstanceOf(AnthropicModelError)
      expect((caught as AnthropicModelError).name, label).toBe("AnthropicRequestError")
    }
    expect(calls).toHaveLength(0)
  })
})

describe("AnthropicModel response mapping", () => {
  test("assembles text across blocks, narrows the union, and stays journal-safe", async () => {
    const { client } = fakeClient(() => reply({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "first half " },
        { type: "text", text: "second half" },
      ],
      model: "claude-opus-5",
      stop_reason: "max_tokens",
    }))
    const model = new AnthropicModel({ client })
    const response = await model.generate(request())

    expect(response.text).toBe("first half second half")
    expect(response.finishReason).toBe("max_tokens")
    expect(response.model).toEqual({
      provider: "anthropic",
      name: "claude-opus-5",
      version: "claude-opus-5",
    })
    expect(response.metadata).toMatchObject({
      id: "msg_test",
      stopReason: "max_tokens",
      servedModel: "claude-opus-5",
      textBlocks: 2,
      usage: { inputTokens: 11, outputTokens: 22 },
    })
    // What CodingAgent does with the response: it must survive canonicalization.
    expect(normalizeModelResponse(response).text).toBe("first half second half")
  })

  test("returns a refusal as a well-formed response carrying stop_details", async () => {
    const { client } = fakeClient(() => reply({
      content: [{ type: "text", text: "I can't help with that." }],
      stop_reason: "refusal",
      stop_details: {
        type: "refusal",
        category: "cyber",
        explanation: "declined for policy reasons",
        fallback_credit_token: null,
      },
    }))
    const response = await new AnthropicModel({ client }).generate(request())

    expect(response.finishReason).toBe("refusal")
    expect(response.text).toBe("I can't help with that.")
    expect(response.metadata?.stopDetails).toEqual({
      type: "refusal",
      category: "cyber",
      explanation: "declined for policy reasons",
    })
    expect(normalizeModelResponse(response).finishReason).toBe("refusal")
  })

  test("guards null stop_details fields", async () => {
    const { client } = fakeClient(() => reply({
      content: [{ type: "text", text: "" }],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: null, explanation: null },
    }))
    const response = await new AnthropicModel({ client }).generate(request())

    expect(response.metadata?.stopDetails).toEqual({
      type: "refusal",
      category: null,
      explanation: null,
    })
  })

  test("records which model actually served a fallback turn", async () => {
    const { client } = fakeClient(() => reply({
      model: "claude-opus-4-8",
      content: [
        { type: "fallback", from: { model: "claude-opus-5" }, to: { model: "claude-opus-4-8" } },
        { type: "text", text: "answered by the fallback" },
      ],
    }))
    const response = await new AnthropicModel({ client }).generate(request())

    expect(response.text).toBe("answered by the fallback")
    expect(response.model?.name).toBe("claude-opus-4-8")
    expect(response.metadata?.fallbacks).toEqual([
      { from: "claude-opus-5", to: "claude-opus-4-8" },
    ])
  })
})

describe("AnthropicModel error translation", () => {
  const headers = new Headers()

  async function thrownBy(error: unknown): Promise<unknown> {
    const { client } = fakeClient(() => {
      throw error
    })
    return new AnthropicModel({ client })
      .generate(request())
      .then(() => undefined, (caught: unknown) => caught)
  }

  test("maps each typed provider error onto a stable adapter error name", async () => {
    const cases = [
      [new Anthropic.RateLimitError(429, undefined, "slow down", headers), "AnthropicRateLimitError", 429],
      [new Anthropic.AuthenticationError(401, undefined, "bad key", headers), "AnthropicAuthenticationError", 401],
      [new Anthropic.BadRequestError(400, undefined, "bad request", headers), "AnthropicBadRequestError", 400],
      [new Anthropic.InternalServerError(500, undefined, "server error", headers), "AnthropicApiError", 500],
    ] as const

    for (const [provider, name, status] of cases) {
      const caught = await thrownBy(provider)
      expect(caught, name).toBeInstanceOf(AnthropicModelError)
      const adapterError = caught as AnthropicModelError
      expect(adapterError.name).toBe(name)
      expect(adapterError.status).toBe(status)
      expect(adapterError.cause).toBe(provider)
    }
  })

  test("routes connection failures through the APIError branch without a status", async () => {
    const connection = new Anthropic.APIConnectionError({ message: "socket hang up" })
    const caught = await thrownBy(connection)
    expect(caught).toBeInstanceOf(AnthropicModelError)
    expect((caught as AnthropicModelError).name).toBe("AnthropicApiError")
    expect((caught as AnthropicModelError).status).toBeUndefined()
  })

  test("rethrows anything that is not a provider error unchanged", async () => {
    const sentinel = new TypeError("not a provider failure")
    expect(await thrownBy(sentinel)).toBe(sentinel)
  })
})

describe("AnthropicModel source extraction", () => {
  test("extracts exactly the bytes ScriptedModel's default extraction would", () => {
    const scripted = new ScriptedModel([])
    const adapter = new AnthropicModel({ client: fakeClient(() => reply()).client })
    const samples = [
      "```ts\nexport default async () => 1\n```",
      "Here you go:\n\n```typescript\nexport default async () => 2\n```\n\nDone.",
      "```ts\nshort\n```\nand\n```ts\nexport default async () => 'the longest fenced block wins'\n```",
      "export default async () => 3",
    ]
    for (const text of samples) {
      const response: ModelResponse = { text }
      expect(adapter.extractSource(response)).toBe(extractModelSource(scripted, response))
      expect(extractModelSource(adapter, response)).toBe(extractModelSource(scripted, response))
    }
    expect(adapter.extractSource({ text: samples[0] })).toBe("export default async () => 1")
  })
})

describe("AnthropicModel identity", () => {
  test("pins the model version and re-digests when any of it changes", () => {
    const baseline = new AnthropicModel()
    const repeated = new AnthropicModel()
    expect(repeated.identity).toEqual(baseline.identity)
    expect(baseline.identity.name).toBe("model/anthropic")
    expect(baseline.identity.artifactDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(baseline.model).toEqual({
      provider: "anthropic",
      name: "claude-opus-5",
      version: "claude-opus-5",
    })

    // Turn provenance requirement: a different model is a different turn.
    const renamed = new AnthropicModel({ model: "claude-sonnet-5" })
    expect(renamed.model.name).toBe("claude-sonnet-5")
    expect(renamed.identity.configDigest).not.toBe(baseline.identity.configDigest)
    expect(renamed.identity.artifactDigest).toBe(baseline.identity.artifactDigest)

    const variants = [
      renamed,
      new AnthropicModel({ maxTokens: 64 }),
      new AnthropicModel({ fallbacks: false }),
      new AnthropicModel({ config: { temperature: 1 } }),
    ]
    const digests = new Set(variants.map((variant) => variant.identity.configDigest))
    expect(digests.size).toBe(variants.length)
    expect(digests.has(baseline.identity.configDigest)).toBe(false)

    // The injected client is transport, not configuration.
    const injected = new AnthropicModel({ client: fakeClient(() => reply()).client })
    expect(injected.identity).toEqual(baseline.identity)
  })

  test("rejects an unusable max_tokens instead of failing at request time", () => {
    expect(() => new AnthropicModel({ maxTokens: 0 })).toThrow(RangeError)
    expect(() => new AnthropicModel({ maxTokens: 1.5 })).toThrow(RangeError)
    expect(() => new AnthropicModel({ maxTokens: 1_000_000 })).toThrow(RangeError)
  })
})

describe("AnthropicModel live call", () => {
  test.if(LIVE)("answers a real request (set SMITHERS_LIVE_MODEL=1 with a credential to run)", async () => {
    const model = new AnthropicModel({ maxTokens: 64 })
    const response = await model.generate({
      turnId: "turn_live",
      attempt: 0,
      diagnostics: [],
      callableSurface: "",
      messages: [
        { role: "system", content: "Answer with the single word you are asked for." },
        { role: "user", content: "Reply with exactly: pong" },
      ],
    })

    expect(response.text.trim().length).toBeGreaterThan(0)
    expect(typeof response.finishReason).toBe("string")
    expect(response.model?.provider).toBe("anthropic")
    expect(response.metadata?.servedModel).toContain("claude")
    expect(normalizeModelResponse(response).text).toBe(response.text)
  }, 60_000)
})
