import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-native-null-array-fallback.json", import.meta.url), "utf8"))
const rule = "A rewrite that can't preserve types, behavior and declaration output refuses at that site"
const source = "./src/native.ts", built = "./lib/native.js", compiled = "./.vibelang/js/src/native.js"
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

// Use the installed Node resolver, including its distinct array and object null behavior.
const probe = [
  'import { createRequire } from "node:module";',
  'import { fileURLToPath } from "node:url";',
  'import { relative } from "node:path";',
  'const require = createRequire(import.meta.url), name = process.argv[2], load = process.argv[3] === "load";',
  'const result = {};',
  'for (const kind of ["import", "require"]) {',
  '  try {',
  '    const target = kind === "import" ? fileURLToPath(import.meta.resolve(name)) : require.resolve(name);',
  '    result[kind] = { target: "./" + relative(process.cwd(), target) };',
  '    if (load) result[kind].value = (kind === "import" ? await import(name) : require(name)).value;',
  '  } catch (error) { result[kind] = { error: error.code }; }',
  '}',
  'console.log(JSON.stringify(result));',
].join("\n")

function scenario({ selection, field = "exports" }) {
  const root = mkdtempSync(join(tmpdir(), "native-source-fallback-"))
  try {
    const key = field === "exports" ? "./entry" : "#entry"
    const name = field === "exports" ? "@fixture/fallback/entry" : key
    const original = JSON.parse(JSON.stringify({ name: "@fixture/fallback", type: "module", [field]: { [key]: selection } }))
    put(root, "package.json", JSON.stringify(original))
    put(root, "src/native.ts", corpus.source)
    put(root, "src/leaf.ts", corpus.leaf)
    put(root, "src/effect.vibe", "export const answer = 42\n")
    put(root, compiled, corpus.source)
    put(root, ".vibelang/js/src/leaf.js", corpus.leaf)
    put(root, ".vibelang/js/src/effect.js", "export const answer = 42\n")
    put(root, built, 'export const value = "built";\n')
    put(root, "probe.mjs", probe)
    const run = (load = false) => {
      const result = spawnSync(process.execPath, ["probe.mjs", name, load ? "load" : "resolve"], { cwd: root, encoding: "utf8", timeout: 30000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return JSON.parse(result.stdout)
    }
    const before = run()
    const needsEmission = Object.values(before).some(result => result.target === source)
    let graph
    const outputs = { [source]: compiled, "./src/leaf.ts": "./.vibelang/js/src/leaf.js", "./src/effect.vibe": "./.vibelang/js/src/effect.js" }
    routeEmittedExports(root, outputs, { typescript: ts, onGraph: value => graph = value })
    assert.equal(graph.mode, "component")
    assert.equal(graph.nativeRuntimeRoots, Number(needsEmission), JSON.stringify({ selection, field, before, graph }))
    const after = run(true)
    for (const kind of ["import", "require"]) {
      const expected = before[kind]
      if (expected.error) assert.deepEqual(after[kind], expected)
      else assert.deepEqual(after[kind], { target: expected.target === source ? compiled : expected.target, value: expected.target === source ? "native" : "built" })
    }
    const once = readFileSync(join(root, "package.json"), "utf8")
    assert.equal(routeEmittedExports(root, outputs, { typescript: ts }), false)
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), once)
    routeEmittedExports(root, {}, { restore: true })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("native source fallback oracle quotes the tooling specification", () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(rule))
})

test("alchemy: null array fallbacks preserve the graph Node actually selects", () => {
  const selections = [
    corpus.exports["./entry"], [[], source], [[null], source], [{ node: null }, source],
    [{ node: [null] }, source], [[{ bun: built }], source],
    { node: null, default: source }, { node: [], default: source },
    { node: [{ bun: built }], default: source },
    [null, { import: source, require: built }],
    { default: null, node: source }, [null, { bun: source, default: built }],
  ]
  for (const field of ["exports", "imports"]) for (const selection of selections) scenario({ selection, field })
})

const leaf = fc.constantFrom(null, source, built)
const branch = fc.oneof(
  leaf,
  fc.array(leaf, { maxLength: 3 }),
  fc.record({ node: leaf, default: leaf }),
  fc.record({ bun: leaf, import: leaf, require: leaf }),
  fc.record({ default: leaf, node: leaf }),
)
const selection = fc.oneof(
  fc.array(branch, { maxLength: 4 }),
  fc.record({ node: fc.array(branch, { maxLength: 3 }), default: leaf }),
  fc.record({ import: fc.array(branch, { maxLength: 3 }), require: leaf, default: leaf }),
)
test("property: native source fallbacks agree with Node import and require resolution", async () => checkProperty(fc, {
  name: "native-source-null-array-fallbacks", rule,
  command: "node --test .smithers/flows/migrate/test/native-source-fallbacks.property.test.mjs",
  arbitrary: fc.record({ selection, field: fc.constantFrom("exports", "imports") }),
  numRuns: 120, check: scenario,
}))
