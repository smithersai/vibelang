import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree } from "../eslint.mjs"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { checkIsForm, isCallRule, isInputs } from "./eslint-is-calls.mjs"

test("captured pattern subjects retain a source form across generated guards and trivia", async () => {
  await checkProperty(fc, {
    name: "eslint-is-call-form", rule: isCallRule,
    command: "node --test packages/compiler/test/eslint-is-calls.property.test.mjs",
    arbitrary: isInputs(fc), numRuns: 120, regressions: new URL("./corpus/", import.meta.url),
    check: ({ code }) => checkIsForm(parseESTree(code, "/is.vibe")),
    artifacts: ({ code }) => ({ "main.vibe": code })
  })
})

test("the captured-pattern tooling oracle quotes the current specification", () => {
  assert.ok(readFileSync(new URL("../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(isCallRule))
})
