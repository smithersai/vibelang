// Source call boundaries, including lowered do calls, run in the gate
// without optional ESLint dependencies.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree } from "../eslint.mjs"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { callInputs, doCallInputs, checkCallBoundaries, sourceCallRule } from "./eslint-source-calls.mjs"

test("native source call boundaries survive generated trivia, receivers and argument lists", async () => {
  await checkProperty(fc, {
    name: "eslint-native-source-call-boundaries", rule: sourceCallRule,
    command: "node --test packages/compiler/test/eslint-source-calls.property.test.mjs",
    arbitrary: callInputs(fc), regressions: new URL("./corpus/", import.meta.url), numRuns: 120,
    check: ({ code, filePath }) => checkCallBoundaries(parseESTree(code, filePath), code),
    artifacts: ({ code, filePath }) => ({ [filePath.endsWith(".ts") ? "main.ts" : "main.vibe"]: code })
  })
})

test("the minimized do witness retains its source call boundary", () => {
  const { input } = JSON.parse(readFileSync(new URL("./corpus/eslint-do-method-call-boundary.json", import.meta.url), "utf8"))
  const tree = parseESTree(input.code, input.filePath)
  checkCallBoundaries(tree, input.code)
})

test("lowered do call boundaries retain their source across generated neighbours", () => {
  fc.assert(fc.property(doCallInputs(fc), ({ code, filePath }) => {
    const tree = parseESTree(code, filePath)
    checkCallBoundaries(tree, code)
  }), { seed: 105, numRuns: 160 })
})

test("the source-call tooling oracle still quotes the accepted specification", () => {
  const chapter = readFileSync(new URL("../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
  assert.ok(chapter.includes(sourceCallRule))
})
