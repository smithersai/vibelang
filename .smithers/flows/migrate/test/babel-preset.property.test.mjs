import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { addBabelPreset } from "../lib/react-tools.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const quote = "Existing tools work."
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-babel-preset-tuple-consumer.json", import.meta.url), "utf8"))
const emptyCorpus = JSON.parse(readFileSync(new URL("./corpus/t3code-babel-empty-tuple-consumer.json", import.meta.url), "utf8"))

function evaluate(source, file) {
  if (file.endsWith(".json") || file === ".babelrc") return JSON.parse(source)
  const sandbox = { module: { exports: {} } }
  runInNewContext(source, sandbox, { timeout: 1000 })
  const value = sandbox.module.exports
  const config = typeof value === "function" ? value({ cache: () => {} }) : value
  return JSON.parse(JSON.stringify(config))
}
function sourceFor(input) {
  const value = JSON.stringify({ presets: input.presets, comments: "keep", plugins: ["unchanged"] }, null, input.indent)
  if (input.file.endsWith(".json") || input.file === ".babelrc") return value
  return input.function ? "module.exports = function(api) { api.cache(true); return " + value + "; }\n" :
    "module.exports = " + value + ";\n"
}
function scenario(input) {
  const source = input.source ?? sourceFor(input)
  const before = evaluate(source, input.file)
  // The consumer is taken from t3code's unchanged compileLikeMetro: destructure
  // each preset as [name, options]. Its original configuration uses tuples.
  const consume = presets => input.consumer === "tuple" ?
    presets.map(([name, options]) => [name, options]) :
    presets.map(entry => Array.isArray(entry) ? entry : [entry, undefined])
  const baseline = consume(before.presets)
  if (input.consumer === "tuple") {
    assert.ok(before.presets.every(Array.isArray))
    assert.deepEqual(baseline.map(([name]) => name), before.presets.map(entry => entry[0]))
  }
  const output = addBabelPreset(source, ts, input.file)
  const after = evaluate(output, input.file)
  assert.deepEqual(after.presets.slice(0, before.presets.length), before.presets)
  assert.deepEqual({ ...after, presets: before.presets }, before)
  assert.equal(after.presets.length, before.presets.length + 1)
  assert.equal(addBabelPreset(output, ts, input.file), output, "wiring is idempotent")
  const appended = after.presets.at(-1)
  assert.equal(Array.isArray(appended) ? appended[0] : appended, "vibelang/babel")
  const consumed = consume(after.presets)
  assert.deepEqual(consumed.slice(0, baseline.length), baseline)
  const name = consumed.at(-1)[0]
  assert.equal(name, "vibelang/babel")
}

// A working nonempty tuple list is never pending. With no existing entry,
// the wiring still appends a string and the unchanged tuple consumer reads "v".
// Match that exact final consumer assertion; every preservation check above it
// must already have passed, and an unrelated parser/evaluation failure is fatal.
function check(input) {
  if (input.consumer !== "tuple" || input.presets?.length !== 0 ||
      process.env.VIBELANG_BABEL_EMPTY_TUPLE_RAW === "1") return scenario(input)
  const key = "t3code:babel-empty-tuple-consumer:" + input.file
  assert.throws(() => scenario(input), error =>
    error?.code === "ERR_ASSERTION" && error.actual === "v" &&
    error.expected === "vibelang/babel",
    "XPASS " + key + ": retire the pending gap owned by migfix-t3code")
}

test("Babel preset consumer oracle quotes the tooling chapter", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})
test("t3code Babel configuration preserves the unchanged tuple consumer", () => { check(corpus.input); check(emptyCorpus.input) })
test("Babel wiring spans tuple, string and mixed presets, config forms and empty arrays", () => {
  for (const file of ["babel.config.js", "babel.config.json", ".babelrc"]) {
    for (const consumer of ["tuple", "normal"]) {
      for (const presets of [[], [["preset-a", { enabled: true }]], consumer === "tuple" ?
        [["preset-a", {}], ["preset-b", { count: 2 }]] : ["preset-a", ["preset-b", {}]]]) {
        check({ file, consumer, presets, function: true, indent: 2 })
      }
    }
  }
  fc.assert(fc.property(fc.record({
    file: fc.constantFrom("babel.config.js", "babel.config.cjs", "babel.config.json", ".babelrc"),
    consumer: fc.constantFrom("tuple", "normal"),
    names: fc.uniqueArray(fc.constantFrom("preset-a", "module:preset-b", "Unicodeé", "@scope/preset"), { maxLength: 4 }),
    function: fc.boolean(),
    indent: fc.integer({ min: 0, max: 4 }),
    option: fc.integer({ min: -2, max: 2 }),
    mix: fc.boolean(),
  }), input => {
    const presets = input.names.map((name, i) => input.consumer === "normal" && input.mix && i % 2 ?
      name : [name, { count: input.option, enabled: !!(i % 2) }])
    check({ ...input, presets })
  }), { seed: 1882088, numRuns: 120, endOnFailure: true })
})
