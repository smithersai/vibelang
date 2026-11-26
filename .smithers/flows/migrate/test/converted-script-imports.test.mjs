// #397: a JavaScript benchmark or script outside the converted set imports a
// converted module by its old TypeScript name, `../src/Relevance.ts`, and Node
// then fails with ERR_MODULE_NOT_FOUND. Path discovery reads the import
// specifiers of non-converted .mjs/.js/.cjs files, and after a module returns
// to TypeScript it reads every importer for a native name left dangling.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { checkConvertedPaths } from "../lib/converted-paths.mjs"

const ts = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("typescript")
const check = files => checkConvertedPaths({ ts, tracked: Object.keys(files), read: path => files[path] })
const base = { "package.json": '{"name":"jev","private":true,"type":"module"}' }
const replay = specifier => [
  `import { score } from "${specifier}"`,
  `export { score as replayScore } from "${specifier}"`,
  `const lazy = await import("${specifier}")`,
  "console.log(score, lazy)",
  ""
].join("\n")

test("a non-converted .mjs script importing a converted module's .ts name is refused", () => {
  const result = check({ ...base, "src/Relevance.vibe": "export const score = 1\n", "benchmarks/jev-replay.mjs": replay("../src/Relevance.ts") })
  assert.equal(result.ok, false)
  const lines = result.refusals.filter(r => r.file === "benchmarks/jev-replay.mjs" && r.module === "src/Relevance.ts").map(r => r.line).sort()
  assert.deepEqual(lines, [1, 2, 3])
  for (const r of result.refusals) assert.equal(r.to, "src/Relevance.vibe")
})

test("a .js script in another directory, and a require, are read the same way", () => {
  const result = check({ ...base, "src/Relevance.vibe": "export const score = 1\n",
    "scripts/bench.cjs": 'const { score } = require("../src/Relevance.ts")\n',
    "web/main.js": 'import "../src/Relevance.ts"\n' })
  assert.deepEqual(result.refusals.map(r => r.file).sort(), ["scripts/bench.cjs", "web/main.js"])
})

test("names that still load are not refused", () => {
  for (const specifier of ["../src/Relevance.vibe", "../src/Relevance.js", "../src/Live.ts", "relevance-pkg/Relevance.ts"]) {
    const result = check({ ...base, "src/Relevance.vibe": "export const score = 1\n", "src/Live.ts": "export const score = 1\n", "benchmarks/jev-replay.mjs": replay(specifier) })
    assert.deepEqual(result.refusals, [], specifier)
  }
})

test("after a return, an importer naming the deleted native file is refused, with nothing converted", () => {
  const result = check({ ...base, "src/Relevance.ts": "export const score = 1\n", "benchmarks/jev-replay.mjs": replay("../src/Relevance.vibe"),
    "src/Fetch.ts": 'import { score } from "./Relevance.vibe"\nexport const f = score\n' })
  assert.equal(result.ok, false)
  assert.deepEqual([...new Set(result.refusals.map(r => r.file))].sort(), ["benchmarks/jev-replay.mjs", "src/Fetch.ts"])
  for (const r of result.refusals) {
    assert.equal(r.kind, "returned")
    assert.equal(r.module, "src/Relevance.vibe")
    assert.equal(r.to, "src/Relevance.ts")
  }
})
