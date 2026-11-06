import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const catalog = readFileSync(new URL("../packages/PACKAGE.ts", import.meta.url), "utf8")

test("the post-merge source-map target includes the Metro and Babel tool checks", () => {
  const sourceMaps = catalog.slice(catalog.indexOf("const sourceMapToolsTest ="), catalog.indexOf("const viteTest ="))
  assert.match(sourceMaps, /data:\s*\[compilerToolsTest\b/, "source-map validation must run compiler-tools-test")
  assert.match(catalog, /"compiler-tools-test": compilerToolsTest/)
  assert.match(catalog, /"source-map-tools-test": sourceMapToolsTest/)
  const tools = catalog.slice(catalog.indexOf("const compilerToolsTest ="), catalog.indexOf("const sourceMapToolsTest ="))
  assert.ok(tools.includes("sh packages/compiler/test/tools/run.sh"))
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
