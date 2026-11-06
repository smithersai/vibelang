import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, require, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/smithers-tried-receiver-pipe.txt", import.meta.url), "utf8")
const { Effect } = require("effect")

test("a generator's parenthesized yield keeps its pipe's meaning through both fix rounds", { skip, timeout: 120000 }, async t => {
  const { original, changed, fixed, text } = await migrationPair(t, source, "EK1002")
  assert.doesNotMatch(JSON.stringify(fixed), /TS1005/)
  assert.match(text, /\(try Effect\.context<Tag \| Other>\(\)\)\.pipe\(Context\.omit\(Other\)\)/)
  const run = (module, name, n) => Effect.runSync(module[name](n).pipe(
    Effect.provideService(module.Tag, { n: 10 }),
    Effect.provideService(module.Other, { s: "" })
  ))
  fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), n => {
    assert.equal(run(changed, "value", n), run(original, "value", n))
    assert.equal(run(changed, "program", n), run(original, "program", n))
  }), { seed: 312401, numRuns: 100 })
})

test("property: a tried receiver's pipe keeps its parentheses and its value", { skip, timeout: 300000 }, async t => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.integer({ min: 1, max: 3 }), fc.integer({ min: -100, max: 100 }), async (newline, comment, count, n) => {
    const stages = Array.from({ length: count }, (_, i) => "Effect.map((m: number) => m + " + (i + 1) + ")").join(", ")
    const receiver = "(try nested()" + (comment ? " /* operand */" : "") + ")"
    const nested = "const nested = () => Effect.succeed(Effect.succeed(" + n + "))\n"
    const candidate = nested + "export const main = effect {\n  const inner = " + receiver + (newline ? "\n    " : "") + ".pipe(" + stages + ")\n  return try inner\n}\n"
    const control = nested + "export const main = Effect.gen(function* () {\n  const inner = (yield* nested()).pipe(" + stages + ")\n  return yield* inner\n})\n"
    const { original, changed, fixed, text } = await migrationPair(t, candidate, "EK4502", control)
    assert.doesNotMatch(JSON.stringify(fixed), /TS1005/)
    assert.ok(text.includes(receiver), text)
    assert.doesNotMatch(text, /\.pipe\(/)
    assert.equal(Effect.runSync(changed.main), Effect.runSync(original.main))
  }), { seed: 312402, numRuns: 8 })
})
