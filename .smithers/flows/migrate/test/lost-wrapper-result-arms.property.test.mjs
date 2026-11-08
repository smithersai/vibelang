import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { lostWrappers } from "../lib/lost-wrapper.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const runtimeRequire = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const Effect = runtimeRequire("effect/Effect")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-wrapper-overwritten-local.json", import.meta.url)))
const prefix = 'import * as Effect from "effect/Effect";\n'
const scan = (original, emitted) => lostWrappers({ ts, original: prefix + original, emitted: prefix + emitted })
const execute = source => Function("Effect", source.replace("export const", "const") + "\nreturn target;")(Effect)

test("the all-program return contract is quoted from the tooling chapter", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.rule))
})

test("an overwritten local cannot preserve a wrapper through its earlier assignment", () => {
  assert.equal(Effect.isEffect(execute(corpus.original)(0)), true)
  assert.equal(Effect.isEffect(execute(corpus.emitted)(0)), false)
  const result = scan(corpus.original, corpus.emitted)
  assert.deepEqual(result.flags.map(flag => flag.function), ["/target"])
  assert.equal(result.flags[0].emittedEffectReturns, 1)
  assert.equal(result.flags[0].emittedReturns, 2)
})

const cases = fc.record({
  shape: fc.constantFrom("conditional", "block", "temporary", "inline"),
  count: fc.integer({ min: 2, max: 6 }), lostAt: fc.nat(5), factory: fc.boolean(),
}).map(input => ({ ...input, lostAt: input.lostAt % input.count }))

function sources({ shape, count, lostAt, factory }, lost) {
  const original = "export const target = " + (factory
    ? "Effect.fnUntraced(function* (n) { return n; })"
    : "n => Effect.succeed(n)") + ";"
  const results = Array.from({ length: count }, (_, i) => lost && i === lostAt ? "n" : "Effect.succeed(n)")
  let body
  if (shape === "conditional")
    body = results.reduceRight((tail, result, i) => "n === " + i + " ? " + result + " : " + tail, "Effect.succeed(n)")
  else if (shape === "block")
    body = "{ " + results.map((result, i) => "if (n === " + i + ") return " + result + ";").join(" ") + " return Effect.succeed(n); }"
  else {
    const assignments = results.map((result, i) => "if (n === " + i + ") result = " + result + ";").join(" ")
    body = shape === "temporary"
      ? "{ let result = Effect.succeed(n); " + assignments + " return result; }"
      : "((p) => { let result = p; " + assignments + " return result; })(Effect.succeed(n))"
  }
  return { original, emitted: "export const target = n => " + body + ";" }
}

test("property: extra Effect arms cannot hide a scalar return on another path", async () => {
  await checkProperty(fc, {
    name: corpus.property, rule: corpus.rule, numRuns: 240,
    regressions: new URL("./corpus/", import.meta.url),
    command: "node --test .smithers/flows/migrate/test/lost-wrapper-result-arms.property.test.mjs",
    arbitrary: cases,
    check: input => {
      for (const lost of [false, true]) {
        const { original, emitted } = sources(input, lost)
        const baseline = execute(original), actual = execute(emitted)
        for (let n = -1; n < input.count; n++) {
          assert.equal(Effect.isEffect(baseline(n)), true, original)
          const value = actual(n)
          assert.equal(Effect.isEffect(value), !lost || n !== input.lostAt, emitted)
          if (Effect.isEffect(value)) assert.equal(Effect.runSync(value), n)
        }
        const result = scan(original, emitted)
        assert.deepEqual(result.flags.map(flag => flag.function), lost ? ["/target"] : [], emitted)
        if (lost) assert.ok(result.flags[0].emittedReturns > result.flags[0].emittedEffectReturns, emitted)
      }
    },
  })
})

test("unchanged mixed Effect and value returns keep their existing classification", () => {
  const original = "export const target = n => n ? Effect.succeed(n) : 0;"
  assert.equal(Effect.isEffect(execute(original)(0)), false)
  assert.equal(Effect.isEffect(execute(original)(1)), true)
  assert.deepEqual(scan(original, original).flags, [])
})
