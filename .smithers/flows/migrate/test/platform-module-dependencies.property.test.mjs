import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { prepareState, applyState } from "../lib/codemod-state.mjs"
import { pathAliases } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const binary = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const modules = fileURLToPath(new URL("../../../../packages/runtime/node_modules", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-platform-module-dependency.json", import.meta.url), "utf8"))
const options = { strict: true, noEmit: true, target: "ESNext", module: "ESNext", moduleResolution: "Bundler", types: ["node"], typeRoots: [join(modules, "@types")], skipLibCheck: true, allowArbitraryExtensions: true, allowImportingTsExtensions: true }

function fixture({ existing = false, converted = true, namespace = false, directory = "src", alias = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "platform-imports-"))
  const write = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  symlinkSync(modules, join(root, "node_modules"), "dir")
  write("package.json", JSON.stringify({ type: "module", exports: { "./*": "./" + directory + "/*.ts" } }))
  write("tsconfig.json", JSON.stringify({ compilerOptions: { ...options, paths: { "@/*": ["./" + directory + "/*"] } }, include: [directory] }))
  let source = corpus.main
  if (namespace) source = source.replace('import { marker } from "./leaf.ts";', 'import * as leaf from "./leaf.ts";').replace(" + marker", " + leaf.marker")
  if (alias) source = source.replace("./leaf.ts", "@/leaf.ts")
  write(directory + "/main.ts", source); write(directory + "/leaf.ts", corpus.leaf)
  const originals = new Map([[directory + "/main.ts", source], [directory + "/leaf.ts", corpus.leaf]])
  if (existing) renameSync(join(root, directory, "leaf.ts"), join(root, directory, "leaf.vibe"))
  const files = [directory + "/main.ts", ...(converted && !existing ? [directory + "/leaf.ts"] : [])]
  const scope = [directory + "/main.ts", directory + (existing ? "/leaf.vibe" : "/leaf.ts")]
  const catalog = [...scope, "package.json", "tsconfig.json"]
  return { root, source, files, scope, catalog, originals }
}

function plan(input) {
  const state = prepareState(input.root, input.files, input.scope, { ts, aliases: pathAliases(ts, input.root), moduleBodies: true, referenceFiles: input.catalog, catalog: input.catalog, tracked: input.catalog, plainGroups: [] })
  assert.equal(state.platform.refused.length, 0)
  assert.equal(state.platform.splits.length, 1)
  for (const original of state.originals) assert.equal(Buffer.from(original.bytes, "base64").toString(), input.originals.get(original.from))
  for (const file of input.files) assert.equal(readFileSync(join(input.root, file), "utf8"), input.originals.get(file), "preparation must not write the original")
  return state
}

for (const settings of [
  {}, { namespace: true }, { directory: "nested/src" },
  { alias: true }, { existing: true }, { existing: true, namespace: true }
]) test("generated platform modules follow converted dependencies " + JSON.stringify(settings), () => {
  const input = fixture(settings)
  try {
    const state = plan(input)
    const body = state.writes.find(w => w.file.endsWith("/main.vibe")).after
    assert.match(body, /module platform/)
    assert.doesNotMatch(body, /(?:\.\/|@\/)leaf\.ts/)
    assert.match(body, /leaf\.vibe/)
    assert.ok(state.importEdits.some(e => e.from.endsWith("leaf.ts")), "the transaction records the preserving import edit")
  } finally { rmSync(input.root, { recursive: true, force: true }) }
})

test("a dependency retained in TypeScript keeps its written module import", () => {
  const input = fixture({ converted: false })
  try { assert.match(plan(input).writes.find(w => w.file.endsWith("/main.vibe")).after, /\.\/leaf\.ts/) }
  finally { rmSync(input.root, { recursive: true, force: true }) }
})

test("the stock pair and its generated platform module both compile", () => {
  const input = fixture()
  try {
    const parsed = ts.convertCompilerOptionsFromJson(options, input.root)
    const stock = ts.createProgram(input.files.map(f => join(input.root, f)), parsed.options)
    assert.deepEqual(ts.getPreEmitDiagnostics(stock).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
    const state = plan(input); applyState(input.root, state)
    const result = spawnSync(binary, ["-p", "tsconfig.json", "--singleThreaded", "--pretty", "false"], { cwd: input.root, encoding: "utf8", timeout: 90000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(input.root, { recursive: true, force: true }) }
})

test("platform import transactions cover generated peer layouts and preserve originals", () => {
  fc.assert(fc.property(fc.record({ existing: fc.boolean(), namespace: fc.boolean(), alias: fc.boolean(), directory: fc.constantFrom("src", "nested/src", "source with spaces") }), settings => {
    const input = fixture(settings)
    try {
      const state = plan(input), body = state.writes.find(w => w.file.endsWith("/main.vibe")).after
      assert.doesNotMatch(body, /(?:\.\/|@\/)leaf\.ts/)
      assert.match(body, /leaf\.vibe/)
      applyState(input.root, state)
      assert.equal(readFileSync(join(input.root, settings.directory, "main.vibe"), "utf8"), body)
    } finally { rmSync(input.root, { recursive: true, force: true }) }
  }), { seed: 561145, numRuns: 64 })
})
