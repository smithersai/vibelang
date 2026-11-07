import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { Clock, Effect, Stream } from "effect"
import fc from "fast-check"
import { extract } from "./check-snippets"

test("the periodic stream example is runnable", () => {
  const page = readFileSync(new URL("../user/src/stream/054-creating.md", import.meta.url), "utf8")
  const examples = extract(page).filter(block => block.source.includes("Stream.tick("))
  expect(examples).toHaveLength(1)
  const [example] = examples
  expect(example.fragment).toBe(false)
  expect(example.pending).toBeUndefined()
  expect(example.run).toBeDefined()
  expect(example.output).toBe("4 true")
})

test("periodic streams sample the real clock until the requested limit", async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 0, max: 8 }),
    fc.integer({ min: 1, max: 3 }),
    async (count, interval) => {
      const source = Stream.mapEffect(Stream.tick(interval), () => Clock.currentTimeMillis)
      const samples = await Effect.runPromise(Stream.runCollect(Stream.take(source, count)))
      expect(samples).toHaveLength(count)
      expect(samples.every(Number.isFinite)).toBe(true)
    }
  ), { numRuns: 30, seed: 531054, examples: [[0, 1], [1, 1], [4, 1], [8, 3]] })
})
