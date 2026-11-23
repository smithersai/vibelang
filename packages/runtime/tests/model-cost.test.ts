import { expect, test } from "bun:test"
import fc from "fast-check"
import { Model } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

test("context windows come from the catalog, for a model id or a seat", () => {
  expect(Model.contextWindow("claude-sonnet-5-5")).toBe(1_000_000)
  expect(Model.contextWindow("anthropic:claude-opus-5-5")).toBe(1_000_000)
  expect(Model.contextWindow("openai:gpt-6.1-sol")).toBe(1_050_000)
  expect(Model.contextWindow("claude-haiku-4-5")).toBe(200_000)
  expect(Model.contextWindow("cerebras:qwen-3.8-27b")).toBe(128_000)
  // An unmet model gets the floor, never zero; knownContextWindow does not invent one.
  expect(Model.contextWindow("ollama:llama3:8b")).toBe(128_000)
  expect(Model.knownContextWindow("llama3:8b")).toBeUndefined()
  expect(Model.maxOutputTokens("anthropic:claude-sonnet-5")).toBe(128_000)
  expect(Model.maxOutputTokens("gpt-6.1-sol")).toBeUndefined()
})

test("cost prices Effect's usage under the model's rate card", () => {
  const usage = { inputTokens: { uncached: 8, total: 12, cacheRead: 3, cacheWrite: 1 }, outputTokens: { total: 3 } }
  // claude-sonnet-5: input 2, cacheRead 0.2, cacheWrite 2.5, output 10 USD per million tokens.
  const expected = (8 * 2 + 3 * 0.2 + 1 * 2.5 + 3 * 10) / 1_000_000
  expect(Model.cost(usage, "claude-sonnet-5")).toEqual({ costUsd: expected, costSource: "estimated" })
  expect(Model.cost(usage, "anthropic:claude-sonnet-5")?.costUsd).toBe(expected)
  expect(Model.cost(usage, "anthropic/claude-sonnet-5")?.costUsd).toBe(expected)
  expect(Model.cost({ inputTokens: 1_000_000, outputTokens: 0 }, "claude-haiku-4-5-20251001")?.costUsd)
    .toBe(Model.prices["claude-haiku-4-5"].input)
})

test("a reported charge wins, and unpriced or malformed usage has no cost", () => {
  expect(Model.cost({ inputTokens: 1, outputTokens: 1, costUsd: 0.5 }, "claude-sonnet-5")).toEqual({ costUsd: 0.5, costSource: "reported" })
  expect(Model.cost({ inputTokens: 1, outputTokens: 1, costUsd: 0.5 }, undefined)?.costSource).toBe("reported")
  expect(Model.cost({ inputTokens: 10, outputTokens: 1 }, "llama3:8b")).toBeUndefined()
  expect(Model.cost({ inputTokens: -1, outputTokens: 1 }, "claude-sonnet-5")).toBeUndefined()
  expect(Model.cost({ inputTokens: 1, outputTokens: 1, cachedInputTokens: 2 }, "claude-sonnet-5")).toBeUndefined()
  expect(Model.cost({ inputTokens: 1 }, "claude-sonnet-5")).toBeUndefined()
  expect(Model.cost({ inputTokens: {}, outputTokens: { total: 1 } }, "claude-sonnet-5")).toBeUndefined()
})

test("a long-context card prices the whole call, and a dated successor applies from its date", () => {
  const card = {
    input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, provider: "x", context: "tiered",
    longContextFrom: 100,
    longContext: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
    nextFrom: "2030-01-01T00:00:00Z",
    next: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, provider: "x", context: "flat" }
  }
  const table = { m: card }
  const before = Date.parse("2029-12-31T00:00:00Z")
  expect(Model.cost({ inputTokens: 99, outputTokens: 1 }, "m", { table, at: before })?.costUsd).toBe((99 + 2) / 1e6)
  expect(Model.cost({ inputTokens: 100, outputTokens: 1 }, "m", { table, at: before })?.costUsd).toBe((1000 + 20) / 1e6)
  expect(Model.cost({ inputTokens: 100, outputTokens: 1 }, "m", { table, at: Date.parse("2030-01-02T00:00:00Z") })?.costUsd)
    .toBe((300 + 4) / 1e6)
})

const count = fc.integer({ min: 0, max: 5_000_000 })
const priced = Object.keys(Model.prices)

test("property: cost is non-negative, monotone in every token class, and never prices malformed usage", async () => {
  await checkProperty(fc, {
    name: "experimental-model-cost",
    rule: "VIP-62 Model.cost after Smithers' Pricing: malformed usage is never priced low",
    command: "cd packages/runtime && bun test tests/model-cost.test.ts",
    arbitrary: fc.record({
      model: fc.constantFrom(...priced),
      read: count, write: count, uncached: count, output: count,
      grow: fc.constantFrom("uncached", "read", "write", "output"),
      by: fc.integer({ min: 1, max: 1_000_000 }),
      bad: fc.constantFrom(-1, Number.NaN, Number.POSITIVE_INFINITY)
    }),
    check: async ({ model, read, write, uncached, output, grow, by, bad }) => {
      const flat = (u: number, r: number, w: number, o: number) =>
        ({ inputTokens: u + r + w, outputTokens: o, cachedInputTokens: r, cacheWriteTokens: w })
      const base = Model.cost(flat(uncached, read, write, output), model, { at: 0 })
      expect(base?.costSource).toBe("estimated")
      expect(base!.costUsd).toBeGreaterThanOrEqual(0)
      // Effect's usage and the flat counts price the same.
      const effect = { inputTokens: { uncached, total: uncached + read + write, cacheRead: read, cacheWrite: write }, outputTokens: { total: output } }
      expect(Model.cost(effect, model, { at: 0 })).toEqual(base)
      const more = {
        uncached: grow === "uncached" ? by : 0, read: grow === "read" ? by : 0,
        write: grow === "write" ? by : 0, output: grow === "output" ? by : 0
      }
      // Within one card (no long-context threshold crossed), more tokens never cost less.
      const card = Model.prices[model]
      const crosses = card.longContextFrom !== undefined &&
        (uncached + read + write < card.longContextFrom) !== (uncached + read + write + more.uncached + more.read + more.write < card.longContextFrom)
      const bigger = Model.cost(flat(uncached + more.uncached, read + more.read, write + more.write, output + more.output), model, { at: 0 })
      if (!crosses) expect(bigger!.costUsd).toBeGreaterThanOrEqual(base!.costUsd)
      for (const field of ["inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteTokens"] as const) {
        expect(Model.cost({ ...flat(uncached, read, write, output), [field]: bad }, model, { at: 0 })).toBeUndefined()
      }
    }
  })
})
