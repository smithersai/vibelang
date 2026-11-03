import { expect, test } from "bun:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { Effect, Exit, type Types } from "effect"
import { $forConcurrent } from "vibelang-runtime"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const limits = {
  omitted: undefined, unbounded: "unbounded", zero: 0, negative: -1,
  single: 1, fractional: 1.5, bounded: 2, nan: NaN, infinite: Infinity
} as const satisfies Record<string, Types.Concurrency | undefined>
type Input = { kind: keyof typeof limits; items: number[] }
const quote = "`n` is any Effect `Concurrency`"
const defaultQuote = "Items run concurrently by default."
const rule = "VIP-19: " + quote + "; " + defaultQuote
const regressions = new URL("./concurrent-limit-regressions/", import.meta.url)

function verifyRule() {
  const chapter = readFileSync(new URL("../../../docs/design/src/002-running.md", import.meta.url), "utf8")
  assert.ok(chapter.includes(quote))
  assert.ok(chapter.includes(defaultQuote))
}

async function run(input: Input, runtime: boolean) {
  const trace: Array<[string, number, number]> = []
  const fibers = new Map<number, number>()
  let active = 0
  let maximum = 0
  const program = Effect.gen(function*() {
    fibers.set((yield* Effect.fiber).id, 0)
    const body = (item: number) => {
      trace.push(["construct", item, -1])
      return Effect.gen(function*() {
        const id = (yield* Effect.fiber).id
        if (!fibers.has(id)) fibers.set(id, fibers.size)
        const ordinal = fibers.get(id)!
        active++
        maximum = Math.max(maximum, active)
        trace.push(["start", item, ordinal])
        yield* Effect.yieldNow
        trace.push(["end", item, ordinal])
        active--
        return item
      })
    }
    const limit = limits[input.kind]
    const loop = runtime
      ? $forConcurrent(input.items, limit, body)
      : Effect.forEach(input.items, body, { concurrency: limit ?? "unbounded", discard: true })
    assert.deepEqual(trace, [], "constructing the loop must not call its item body")
    const result = yield* loop
    assert.equal(result, undefined, "item results are discarded")
    return { maximum, active, trace, fibers: fibers.size }
  })
  return Effect.runPromiseExit(program)
}

test("for concurrent preserves native concurrency values and fiber ownership", async () => {
  verifyRule()
  await checkProperty(fc, {
    name: "concurrent-native-limits", rule,
    command: "bun test tests/concurrent-limits.property.test.ts",
    arbitrary: fc.record({
      kind: fc.constantFrom<keyof typeof limits>("omitted", "unbounded", "zero", "negative", "single", "fractional", "bounded", "nan", "infinite"),
      items: fc.array(fc.integer({ min: -3, max: 3 }), { maxLength: 7 })
    }),
    regressions, numRuns: 100,
    check: async (input: Input) => assert.deepEqual(await run(input, true), await run(input, false))
  })
}, 30000)

test("an unbounded loop preserves its native typed failure", async () => {
  expect(await Effect.runPromiseExit($forConcurrent([1, 2, 3], "unbounded",
    item => item === 2 ? Effect.fail("item failed") : Effect.succeed(item)
  ))).toEqual(Exit.fail("item failed"))
})
