/**
 * Static facts about provider models and USD prices for their calls.
 *
 * @internal
 */
import type { Cost, CostOptions, Counts, Price, Rates } from "../Model.js"
import { modelPrices } from "./modelPrices.js"

/** The default window for a model this catalog has not met. */
const unknownModelTokens = 128_000

const contextWindows: ReadonlyArray<readonly [RegExp, number]> = [
  [/claude.*haiku/i, 200_000],
  // Native 1M windows; older Claude and cloud-prefixed ids stay conservative.
  // A numeric minor version (claude-opus-5-5) keeps its family's window.
  [/^claude-(?:(?:opus|sonnet)-5(?:-[0-9]{1,2})?|opus-4-[678]|sonnet-4-6)$/i, 1_000_000],
  [/^claude-(?:fable|mythos)-5(?:-[0-9]+)*$/i, 1_000_000],
  [/claude/i, 200_000],
  [/^gpt-6\.1-sol$/i, 1_050_000],
  [/gpt-[56]/i, 400_000],
  [/gpt-4\.1/i, 1_000_000],
  [/gpt-4o/i, 128_000],
  [/^o[134]/i, 200_000],
  // The paid window, which a keyed seat resolves; the free trial is 64K.
  [/^qwen-3\.8/i, 128_000]
]

const outputCeilings: ReadonlyArray<readonly [RegExp, number]> = [
  [
    /^claude-(?:(?:opus|sonnet)-5(?:-[0-9]{1,2})?|(?:fable|mythos)-5(?:-[0-9]+)*|opus-4-[678]|sonnet-4-6)$/i,
    128_000
  ]
]

const first = (table: ReadonlyArray<readonly [RegExp, number]>, modelId: string): number | undefined => {
  for (const [pattern, tokens] of table) {
    if (pattern.test(modelId)) return tokens
  }
  return undefined
}

export const knownContextWindow = (modelId: string): number | undefined => first(contextWindows, modelId)

export const contextWindow = (modelId: string): number => knownContextWindow(modelId) ?? unknownModelTokens

export const maxOutputTokens = (modelId: string): number | undefined => first(outputCeilings, modelId)

export const prices: Readonly<Record<string, Price>> = modelPrices

const snapshot = /-\d{8}$/

const candidates = (modelId: string): ReadonlyArray<string> => {
  const id = modelId.trim()
  const bare = id.slice(Math.max(id.lastIndexOf("/"), id.lastIndexOf(":")) + 1)
  return [id, bare, bare.replace(snapshot, "")]
}

export const lookup = (modelId: string, options: CostOptions = {}): Rates | Price | undefined => {
  const rows = options.table ?? prices
  const key = candidates(modelId).find((candidate) => Object.hasOwn(rows, candidate))
  if (key === undefined) return undefined
  const at = options.at ?? Date.now()
  // A Rates row has no successor; an undated successor never starts.
  let price = rows[key] as Price
  while (price.next !== undefined && at >= Date.parse(String(price.nextFrom))) price = price.next
  return price
}

// The rate-weighted token sum: micro-dollars with rates per million tokens.
// Malformed usage is NaN, so it is never priced low.
const weigh = (usage: Counts, rates: Rates): number => {
  const counters = [usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.cacheWriteTokens]
  if (counters.some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) return Number.NaN
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return Number.NaN
  const read = usage.cachedInputTokens ?? 0
  const write = usage.cacheWriteTokens ?? 0
  const uncached = usage.inputTokens - read - write
  if (uncached < 0) return Number.NaN
  const weighted = uncached * rates.input + read * rates.cacheRead + write * rates.cacheWrite +
    usage.outputTokens * rates.output
  return Number.isFinite(weighted) ? weighted : Number.NaN
}

export const costUsd = (usage: Counts, price: Rates | Price): number => {
  const card = price as Price
  const rates = card.longContext !== undefined && (usage.inputTokens ?? 0) >= Number(card.longContextFrom) ?
    card.longContext :
    card
  const usd = Math.round(weigh(usage, rates) / 1_000_000 * 1e9) / 1e9
  return Number.isFinite(usd) ? usd : Number.NaN
}

export const cost = (usage: Counts, modelId: string | undefined, options: CostOptions = {}): Cost | undefined => {
  if (usage.costUsd !== undefined && Number.isFinite(usage.costUsd) && usage.costUsd >= 0) {
    return { costUsd: usage.costUsd, costSource: "reported" }
  }
  const price = modelId === undefined ? undefined : lookup(modelId, options)
  if (price === undefined) return undefined
  const usd = costUsd(usage, price)
  return Number.isFinite(usd) ? { costUsd: usd, costSource: "estimated" } : undefined
}
