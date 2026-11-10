import { expect, test } from "bun:test"
import { Effect } from "effect"
import * as fc from "fast-check"
import { Memory } from "vibelang-runtime/experimental"

// VIP-66 rule 3: every recall has a byte budget. Whatever the stored rows and
// the budget, the answer is empty or, serialized as JSON, fits in `maxBytes`
// UTF-8 bytes (an empty answer, `[]`, is two bytes). It is a prefix of the
// unbudgeted ranking: whole rows in rank order, with at most the last one
// cut to a prefix of its text.
const utf8 = new TextEncoder()
const word = fc.constantFrom("alpha", "beta", "gamma", "Δέλτα", "emoji😀", "x")
const text = fc.array(fc.oneof(word, fc.string({ unit: "grapheme", maxLength: 12 })), { maxLength: 30 }).map((words) =>
  words.join(" ")
)
const fact = fc.record({
  bank: fc.constantFrom("global-a", "agent-b", "notes"),
  key: fc.string({ minLength: 1, maxLength: 8 }),
  text,
  at: fc.nat({ max: 1_000 })
})

test("memory property: recall fits its byte budget and keeps rank order", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fact, { maxLength: 25 }), fc.integer({ min: 0, max: 3_000 }), fc.array(word, { minLength: 1, maxLength: 3 }), async (facts, maxBytes, terms) => {
      const store = Memory.makeMemoryStore()
      for (const { bank, key, text, at } of facts) {
        await Effect.runPromise(store.putFact({ namespace: Memory.namespaceOf(bank), key, text, at }))
      }
      const recall = (budget: number) =>
        Effect.runPromise(
          Effect.provide(
            Memory.recall({ banks: ["global-a", "agent-b", "notes"], query: terms.join(" "), maxBytes: budget }),
            Memory.layerStore(store)
          )
        )
      const cut = await recall(maxBytes)
      const whole = await recall(Memory.MAX_RECALL_BYTES)
      if (cut.length > 0) expect(utf8.encode(JSON.stringify(cut)).byteLength).toBeLessThanOrEqual(maxBytes)
      const ranked = whole.filter((row) => row.text.length > 0)
      cut.forEach((row, index) => {
        const original = ranked[index]!
        expect({ ...row, text: "" }).toEqual({ ...original, text: "" })
        if (index < cut.length - 1) expect(row.text).toBe(original.text)
        else expect(original.text.startsWith(row.text)).toBe(true)
      })
    }),
    { numRuns: 200 }
  )
})
