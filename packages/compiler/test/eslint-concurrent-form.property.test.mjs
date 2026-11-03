import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree } from "../eslint.mjs"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { concurrentInputs, concurrentToolRule, checkConcurrentForm } from "./eslint-concurrent-form.mjs"

test("for concurrent retains source limits, item scopes and iterable expressions", async () => {
  await checkProperty(fc, {
    name: "eslint-concurrent-source-form", rule: concurrentToolRule,
    command: "node --test packages/compiler/test/eslint-concurrent-form.property.test.mjs",
    arbitrary: concurrentInputs(fc), numRuns: 120, regressions: new URL("./corpus/", import.meta.url),
    check: ({ code, bounded }) => checkConcurrentForm(parseESTree(code, "/concurrent.vibe"), bounded),
    artifacts: ({ code }) => ({ "main.vibe": code })
  })
})

test("the concurrent-source oracle quotes the current tooling specification", () => {
  assert.ok(readFileSync(new URL("../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(concurrentToolRule))
})
