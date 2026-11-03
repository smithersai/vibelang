import { compareApiIdentity } from "../lib/api-identity.mjs"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import vm from "node:vm"
import { test } from "node:test"
import { addRolldownPlugins } from "../lib/rolldown-builds.mjs"
import { wireDeveloperTools } from "../lib/tooling.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-programmatic-rolldown.json", import.meta.url)))
const specsFor = () => ({ vibelang: "0.0.11", "vibelang-unplugin": "0.0.11" })
function fixture(manifest = {}) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-rolldown-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", JSON.stringify({ type: "module", ...manifest }))
  return { root, put, dispose() { rmSync(root, { recursive: true, force: true }) } }
}
async function execute(text) {
  const calls = [], exports = {}
  let native = 0
  const build = options => { calls.push(options); return options }
  const rolldown = { rolldown: build, watch: build, default: Object.assign(build, { rolldown: build, watch: build }) }
  const compiler = { default: () => { native++; return { name: "vibelang" } } }
  const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  await vm.runInNewContext("(async () => {" + compiled + "\n})()", {
    exports, require: name => { if (name === "rolldown") return rolldown; if (name === "vibelang-unplugin/rolldown") return compiler; throw Error(name) }
  })
  return { calls, exports, get native() { return native } }
}

test("alchemy: existing setup wires lazy bundles, framework adapters and public plugin factories", () => {
  const f = fixture({ name: "@alchemy.run/cloudflare-runtime", devDependencies: { "vibelang-unplugin": "old" } })
  try {
    for (const item of corpus.modules) f.put(item.file, item.source)
    const result = wireDeveloperTools({ root: f.root, ts, specsFor })
    assert.deepEqual(result.warnings, [])
    for (const item of corpus.modules) assert.match(readFileSync(join(f.root, item.file), "utf8"), /vibelang-unplugin\/rolldown/, item.file)
    const pkg = JSON.parse(readFileSync(join(f.root, "package.json")))
    assert.equal(pkg.dependencies["vibelang-unplugin"], "0.0.11")
    assert.equal(pkg.dependencies.vibelang, "0.0.11")
    assert.equal(pkg.devDependencies["vibelang-unplugin"], undefined)
    assert.deepEqual(wireDeveloperTools({ root: f.root, ts, specsFor }).changed, [])
  } finally { f.dispose() }
})

test("Alchemy's factory and lazy module calls keep their options and instantiate native plugins per call", async () => {
  for (const item of corpus.modules) {
    const result = addRolldownPlugins(item.source, ts, { file: item.file })
    assert.deepEqual(result.refusals, [], item.file)
    assert.equal(result.wired, true)
    const value = await execute(result.text)
    if (item.factory) {
      for (const enabled of [false, true]) {
        const plugins = value.exports.default({ enabled })
        assert.equal(plugins[0].name, "vibelang")
        assert.equal(plugins[1]?.name ?? null, enabled ? "optional" : null)
        assert.equal(plugins[2].name, "options")
      }
      assert.equal(value.native, 2)
    } else {
      await value.exports.bundle()
      assert.ok(value.calls.length > 0)
      for (const call of value.calls) {
        assert.equal(call.plugins[0].name, "vibelang")
        assert.equal(call.input, "./entry.ts")
      }
    }
  }
})

test("test-pinned plugin positions stay unchanged and tests/fixtures are not edited", async () => {
  const f = fixture({ private: true, exports: { ".": "./src/plugin.ts" } })
  try {
    f.put("src/plugin.ts", corpus.modules[2].source)
    const testText = 'import cloudflare from "../src/plugin.ts"; const plugins = cloudflare({enabled:true}); if (plugins[0]?.name !== "optional") throw Error("order");\n'
    f.put("test/plugin.test.ts", testText)
    f.put("fixtures/bundle.ts", corpus.modules[1].source)
    wireDeveloperTools({ root: f.root, ts, specsFor })
    assert.equal(readFileSync(join(f.root, "test/plugin.test.ts"), "utf8"), testText)
    assert.equal(readFileSync(join(f.root, "fixtures/bundle.ts"), "utf8"), corpus.modules[1].source)
    const value = await execute(readFileSync(join(f.root, "src/plugin.ts"), "utf8"))
    const plugins = value.exports.default({ enabled: true })
    assert.equal(plugins[0].name, "optional")
    assert.equal(plugins[1].name, "vibelang")
    assert.equal(plugins[2].name, "options")
    assert.equal(JSON.parse(readFileSync(join(f.root, "package.json"))).devDependencies["vibelang-unplugin"], "0.0.11")
  } finally { f.dispose() }
})

test("property: aliases, lazy module shapes, comments, commas and pinned indexes preserve options and order", async () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("Exported factories construct a fresh plugin on each call."))
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("named", "namespace", "default", "lazy", "dynamic", "inline"),
    fc.integer({ min: 0, max: 5 }), fc.integer({ min: -1, max: 5 }), fc.boolean(),
    async (style, count, pinnedThrough, trailing) => {
      const head = style === "named" ? 'import {rolldown as build} from "rolldown";'
        : style === "namespace" ? 'import * as r from "rolldown";'
        : style === "default" ? 'import build from "rolldown";'
        : style === "lazy" ? 'const loadRolldown = () => import("rolldown");'
        : ""
      const init = style === "lazy" ? 'const {rolldown:build} = await loadRolldown();'
        : style === "dynamic" ? 'const {rolldown:build} = await import("rolldown");' : ""
      const callee = style === "namespace" ? "r.rolldown" : style === "inline" ? '(await import("rolldown")).rolldown' : "build"
      const plugins = Array.from({ length: count }, (_, i) => '/* own */{name:"p' + i + '"}').join(",") + (trailing && count ? "," : "")
      const source = head + ' export async function run() {' + init + ' return ' + callee + '({input:"./entry.ts",plugins:[' + plugins + '],external:["node:fs"]}); }'
      const result = addRolldownPlugins(source, ts, { pinnedThrough })
      assert.deepEqual(result.refusals, [], source)
      assert.equal(result.wired, true)
      assert.equal(addRolldownPlugins(result.text, ts, { pinnedThrough }).text, result.text)
      const value = await execute(result.text)
      const output = await value.exports.run()
      assert.equal(output.input, "./entry.ts")
      assert.deepEqual(Array.from(output.external), ["node:fs"])
      const expected = Array.from({ length: count }, (_, i) => "p" + i)
      expected.splice(Math.min(count, pinnedThrough + 1), 0, "vibelang")
      assert.deepEqual(Array.from(output.plugins, p => p.name), expected)
    }), { seed: 510051, numRuns: 250 })
})

test("shadowed bindings and unrelated arrays stay unchanged; unsafe options get located warnings", () => {
  for (const source of [
    'import {rolldown} from "rolldown"; function f(rolldown) { rolldown({plugins:[]}) }',
    'import * as r from "rolldown"; { const r = {rolldown() {}}; r.rolldown({}) }',
    'import type * as r from "rolldown"; const data: number[] = [1,2]; export {data};',
    'const r = {rolldown() {}}; r.rolldown({});'
  ]) {
    const result = addRolldownPlugins(source, ts)
    assert.equal(result.text, source)
    assert.equal(result.wired, false)
    assert.deepEqual(result.refusals, [])
  }
  for (const source of [
    'import {rolldown} from "rolldown"; rolldown({...unknown})',
    'import {rolldown} from "rolldown"; rolldown({plugins:[],...unknown})',
    'import {rolldown} from "rolldown"; rolldown({plugins:makePlugins()})',
    'import {rolldown} from "rolldown"; const options = {}; rolldown(options); console.log(options)',
    '/**\n * @generated\n */\nimport {rolldown} from "rolldown"; rolldown({})',
    'const {rolldown} = require("rolldown"); rolldown({})'
  ]) {
    const result = addRolldownPlugins(source, ts)
    assert.equal(result.text, source)
    assert.equal(result.wired, false)
    assert.ok(result.refusals.length > 0, source)
    assert.ok(result.refusals.every(r => r.line > 0))
  }
})

test("single-use options and safe spreads wire without changing written properties", async () => {
  for (const source of [
    'import {rolldown} from "rolldown"; export const run=()=>rolldown({...{input:"x"},external:["fs"]});',
    'import {rolldown} from "rolldown"; export function run(){const opts={input:"x"};return rolldown(opts)}',
    'import {watch} from "rolldown"; export const run=()=>watch({...{input:"x"},plugins:[]});'
  ]) {
    const result = addRolldownPlugins(source, ts)
    assert.deepEqual(result.refusals, [])
    const value = await execute(result.text)
    const output = await value.exports.run()
    assert.equal(output.input, "x")
    assert.equal(output.plugins[0].name, "vibelang")
  }
})

test("exported plugin factory declarations stay API-identical under strict checking", () => {
  const f = fixture()
  try {
    f.put("ambient.d.ts", 'declare module "rolldown" { export interface Plugin { name: string } } declare module "vibelang-unplugin/rolldown" { import type {Plugin} from "rolldown"; export default function vibelang(): Plugin }\n')
    const item = corpus.modules[2], outputs = []
    for (const [name, text] of [["before.ts", item.source], ["after.ts", addRolldownPlugins(item.source, ts, { file: item.file }).text]]) {
      f.put(name, text)
      const options = { strict: true, declaration: true, emitDeclarationOnly: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, outDir: join(f.root, "out") }
      const program = ts.createProgram([join(f.root, name), join(f.root, "ambient.d.ts")], options)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
      program.emit(undefined, (file, value) => { if (file.endsWith(".d.ts")) outputs.push(value) })
    }
    assert.equal(outputs.length, 2)
    f.put("before/package.json", JSON.stringify({ types: "./index.d.ts" }))
    f.put("after/package.json", JSON.stringify({ types: "./index.d.ts" }))
    f.put("before/index.d.ts", outputs[0])
    f.put("after/index.d.ts", outputs[1])
    const result = compareApiIdentity(ts, join(f.root, "before"), join(f.root, "after"), {
      compilerOptions: { types: [join(f.root, "ambient.d.ts")] },
    })
    assert.equal(result.identical, true, JSON.stringify(result, null, 2))
  } finally { f.dispose() }
})
