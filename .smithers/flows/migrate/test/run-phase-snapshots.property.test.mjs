import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { originalFunctions, runPhaseOf, blocking, runPhaseChanges, vibeTree } from "../lib/run-phase.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check"), Effect = require("effect/Effect")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-factory-property-snapshot.json", import.meta.url), "utf8"))
const quote = "The migration preserves eager factory calls, argument evaluation and closure state shared by repeated runs"
const phase = source => runPhaseOf(ts, originalFunctions(ts, source).get("make").node)
const source = statement => 'import { Effect } from "effect"; export function make(input: any) { ' + statement + '; return Effect.gen(function* () { return snapshot }) }'
const templates = [
  ["property", "const snapshot = input.value"],
  ["element", 'const snapshot = input["value"]'],
  ["optional-property", "const snapshot = input?.value"],
  ["optional-element", 'const snapshot = input?.["value"]'],
  ["object-binding", "const { value: snapshot } = input"],
  ["object-rest", "const { ...snapshot } = input"],
  ["array-binding", "const [snapshot] = input"],
  ["array-rest", "const [...snapshot] = input"],
  ["object-spread", "const snapshot = { ...input }"],
  ["array-spread", "const snapshot = [...input]"],
]
const wrap = fc.constantFrom(x => x, x => "(" + x + ")", x => "(" + x + " as any)", x => "(" + x + " satisfies any)", x => "(" + x + ")!")
function typescriptFactory(text) {
  const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function("require", "module", "exports", compiled)(require, module, module.exports)
  return module.exports.make
}

test("factory snapshot oracle quotes the migration preservation rule", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
  assert.equal(corpus.quote, quote)
})
for (const sample of corpus.samples) {
  test(corpus.key + ":" + sample.key, () => {
    const result = phase(sample.source)
    assert.equal(result.verdict, "eager", JSON.stringify(result))
    assert.equal(blocking(result), true)
    assert.match(result.detail, /reads|destructures|spreads/)
  })
}
test("TypeScript getter snapshots show why moving a read cannot certify coldness", () => {
  const before = typescriptFactory(corpus.samples[0].source)
  const moved = typescriptFactory(corpus.retimed)
  const observe = make => {
    let value = 7, reads = 0
    const program = make({ get value() { reads++; return value } })
    const readsAtCall = reads
    value = 9
    const first = Effect.runSync(program)
    value = 11
    const second = Effect.runSync(program)
    return { readsAtCall, first, second, reads }
  }
  assert.deepEqual(observe(before), { readsAtCall: 1, first: 7, second: 7, reads: 1 })
  assert.deepEqual(observe(moved), { readsAtCall: 0, first: 9, second: 11, reads: 2 })
  assert.equal(blocking(phase(corpus.samples[0].source)), true)
})
test("property: snapshot reads, destructuring and spreads block deferred factories", () => {
  fc.assert(fc.property(fc.constantFrom(...templates), wrap, fc.boolean(), ([key, statement], w, mutable) => {
    let text = statement.replace("const ", mutable ? "let " : "const ")
    text = text.replace(/= input(.*)$/, (_, tail) => "= " + w("input" + tail))
    const result = phase(source(text))
    assert.equal(result.verdict, "eager", key + ": " + JSON.stringify(result))
    assert.equal(blocking(result), true)
  }), { seed: 2812026, numRuns: 300 })
})
test("property: reads within the returned generator and nested callbacks stay cold", () => {
  fc.assert(fc.property(fc.constantFrom(...templates), ([, statement]) => {
    assert.equal(phase('import { Effect } from "effect"; export function make(input: any) { return Effect.gen(function* () { ' + statement + '; return snapshot }) }').verdict, "ok")
    assert.equal(phase('import { Effect } from "effect"; export function make(input: any) { const later = () => { ' + statement + '; return snapshot }; return Effect.gen(function* () { return later() }) }').verdict, "ok")
  }), { seed: 2812027, numRuns: 100 })
})
test("snapshot diagnostics identify computed conditions and generator receivers", () => {
  for (const expression of [
    "input.ready ? Effect.gen(function* () { return 1 }) : Effect.gen(function* () { return 2 })",
    "Effect.gen({ self: input.value }, function* () { return 1 })",
    'Effect.gen({ self: input["value"] }, function* () { return 1 })',
  ]) {
    const result = phase('import { Effect } from "effect"; export function make(input: any) { return ' + expression + ' }')
    assert.equal(result.verdict, "eager", JSON.stringify(result))
  }
})


const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
test("the batch run-phase check reports a deferred factory snapshot", { skip: !existsSync(compiler) && "build the native compiler" }, () => {
  const after = "export effect function make(input: { value: number }) { const snapshot = input.value; return snapshot }"
  const changes = runPhaseChanges({ ts, original: corpus.samples[0].source, originalPath: "factory.ts", vibe: vibeTree(compiler, after, "factory.vibe"), vibeText: after })
  assert.equal(changes.length, 1)
  assert.equal(changes[0].name, "make")
  assert.equal(changes[0].line, 1)
  assert.equal(blocking(changes[0]), true)
  assert.equal(changes[0].detail, "reads at the call: input.value")
})
