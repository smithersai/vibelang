import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { recordOutputs } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-root-emission-output.json", import.meta.url), "utf8"))
const file = corpus.package + "/" + corpus.source
const ownerOf = path => path.startsWith(corpus.package + "/") ? corpus.package : "."
const runs = {
  package: outputs => recordOutputs(outputs, corpus.package, { [corpus.source]: corpus.packageOutput }, ownerOf),
  root: outputs => recordOutputs(outputs, ".", { [corpus.rootSource]: corpus.rootOutput }, ownerOf)
}

test("a nested package keeps its own output after the root project emits it", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  assert.equal(runs.root(runs.package({}))[file], corpus.package + "/" + corpus.packageOutput)
})

test("property: the owner's output wins in every emission order", () => {
  fc.assert(fc.property(fc.shuffledSubarray(["package", "root"], { minLength: 2, maxLength: 2 }), order => {
    const outputs = order.reduce((all, name) => runs[name](all), {})
    assert.equal(outputs[file], corpus.package + "/" + corpus.packageOutput)
  }), { numRuns: 8, seed: 272732 })
})

test("a module only a parent project emits keeps that output", () => {
  assert.equal(runs.root({})[file], corpus.rootOutput)
})
