import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { addOxlintSelectors } from "../lib/oxlint.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")

const selectors = [
  { body: String.raw`/\.(ts|tsx)$/.test(file)`, extensions: ["ts", "tsx", "vibe", "vibex"] },
  { body: String.raw`/\.(?:ts|tsx)$/.test(file)`, extensions: ["ts", "tsx", "vibe", "vibex"] },
  { body: String.raw`/\.tsx?$/.test(file)`, extensions: ["ts", "tsx", "vibe", "vibex"] },
  { body: String.raw`/\.tsx$/.test(file)`, extensions: ["tsx", "vibex"] },
  { body: String.raw`/\.ts$/.test(file)`, extensions: ["ts", "vibe"] },
  { body: String.raw`/\.(ts|tsx|vibe)$/.test(file)`, extensions: ["ts", "tsx", "vibe", "vibex"] },
  { body: '["ts","tsx","vibe"].includes(file.split(".").at(-1))', extensions: ["ts", "tsx", "vibe", "vibex"] },
  { body: '["tsx"].includes(file.split(".").at(-1))', extensions: ["tsx", "vibex"] },
  { body: '[".ts",".tsx",".vibe"].includes("." + file.split(".").at(-1))', extensions: ["ts", "tsx", "vibe", "vibex"] },
]
function verify(selector, name) {
  const source = "const selected = paths.filter(file => (" + selector.body + ') && file.startsWith("src/")); selected'
  const inputs = ["ts", "tsx", "vibe", "vibex", "js", "json"].map(ext => "src/" + name + "." + ext)
    .concat(["src/" + name + ".d.vibe.ts", "src/" + name + ".d.vibex.ts", "other/" + name + ".tsx", "other/" + name + ".vibex"])
  const result = addOxlintSelectors(source, ts)
  assert.deepEqual(result.warnings, [])
  const actual = Array.from(runInNewContext(result.text, { paths: inputs }))
  assert.deepEqual(actual, selector.extensions.map(ext => "src/" + name + "." + ext), selector.body)
  assert.equal(addOxlintSelectors(result.text, ts).text, result.text, "repeated setup is stable")
}
test("migrated Oxlint runner filters preserve JSX sources and directory scope", () => {
  for (const selector of selectors) verify(selector, "sample")
  fc.assert(fc.property(fc.constantFrom(...selectors), fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), verify), { numRuns: 90 })
})
