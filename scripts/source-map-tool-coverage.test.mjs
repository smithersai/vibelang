import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { packageDeclarations } from "./testing/package-declarations.mjs"

const catalog = readFileSync(new URL("../packages/PACKAGE.ts", import.meta.url), "utf8")

test("the post-merge source-map target includes the Metro and Babel tool checks", () => {
  const targets = packageDeclarations()
  const maps = targets["source-map-tools-test"], tools = targets["compiler-tools-test"]
  assert.equal(maps.kind, "Suite")
  assert.equal(tools.kind, "Suite")
  assert.ok(maps.tests.includes(tools), "source-map validation must run every compiler adapter")
  assert.ok(tools.tests.every(target => target.kind === "Shell.Test" && /node --test/.test(target.shell)))

  const runner = readFileSync(new URL("../packages/compiler/test/tools/run.sh", import.meta.url), "utf8")
  assert.ok(runner.includes("./*.test.mjs"), "the dependency executes the real tool suite")
})

test("the source-map coverage table lists each check once", () => {
  const guide = readFileSync(new URL("../docs/maintainers/source-maps.md", import.meta.url), "utf8")
  const matrix = guide.slice(guide.indexOf("## Tests"))
  const rows = matrix.split("\n").filter((line) => line.startsWith("| "))
  assert.ok(rows.some((row) => row.includes("`inspector.test.mjs`")))
  assert.ok(rows.some((row) => row.includes("`programs.property.test.mjs`")))
  assert.ok(rows.some((row) => row.includes("`//packages:compiler-tools-test`")))
  assert.equal(rows.length, new Set(rows).size, "the coverage table repeats a check")
})
