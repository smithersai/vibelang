import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { formatSource } from "../format.mjs"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const source = "export function label(){return 'x'}\nexport const n=1\n"

function compile(t, text, mode) {
  const root = mkdtempSync(join(tmpdir(), "chapter007-map-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "main.vibe"), text)
  const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(modules, "effect"), join(root, "node_modules/effect"))
  const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], strict: true, declaration: true, declarationMap: true, inlineSources: true, outDir: "out" }
  options[mode === "inline" ? "inlineSourceMap" : "sourceMap"] = true
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, vibe: { effectGlobals: false, effectModules: false }, files: ["main.vibe"] }))
  const compiled = spawnSync(binary, ["-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  const javascript = readFileSync(join(root, "out/main.js"), "utf8")
  const map = mode === "inline"
    ? JSON.parse(Buffer.from(/sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/.exec(javascript)?.[1] || "", "base64").toString())
    : JSON.parse(readFileSync(join(root, "out/main.js.map"), "utf8"))
  const declaration = JSON.parse(readFileSync(join(root, "out/main.d.ts.map"), "utf8"))
  assert.ok(map.sources.some(path => path.endsWith("main.vibe")), JSON.stringify(map))
  assert.deepEqual(map.sourcesContent, [text])
  assert.ok(declaration.sources.some(path => path.endsWith("main.vibe")), JSON.stringify(declaration))
  if (declaration.sourcesContent) assert.deepEqual(declaration.sourcesContent, [text])
  const observed = spawnSync(process.execPath, ["--input-type=module", "-e", 'import {label,n} from "./out/main.js";console.log(JSON.stringify({value:label(),n,reflection:label.toString()}))'], { cwd: root, encoding: "utf8", timeout: 20000 })
  assert.equal(observed.status, 0, observed.stdout + observed.stderr)
  return { map, declaration, observation: JSON.parse(observed.stdout) }
}

// Chapter 007 / regenerated map provenance: docs/design/src/007-tooling.md#b9cb23f40ef3d960
// Chapter 007 / maps describe formatted source: docs/design/src/007-tooling.md#80432b67d574ce5b
// Chapter 007 / inline maps and inline sources remain supported: docs/design/src/007-tooling.md#407f6d183190b6c4
// Chapter 007 / concrete inline-source witness: docs/design/src/007-tooling.md#91a820c3b985079d
// Chapter 007 / declaration and source maps stay current: docs/design/src/007-tooling.md#1d2ba892c48c3018
for (const mode of ["inline", "external"]) {
  test("Chapter 007 / " + mode + " maps contain the actual source after formatting", t => {
    const formatted = formatSource(source, "main.vibe")
    assert.notEqual(formatted, source)
    const before = compile(t, source, mode)
    const after = compile(t, formatted, mode)
    assert.deepEqual(before.observation.value, after.observation.value)
    assert.equal(before.observation.n, after.observation.n)
    assert.notDeepEqual(before.map.sourcesContent, after.map.sourcesContent)
    assert.notEqual(before.map.mappings, after.map.mappings)
  })
}

// Chapter 007 / reflection follows formatted source: docs/design/src/007-tooling.md#d9107993aaebf310
// Chapter 007 / source-text boundary: docs/design/src/007-tooling.md#a83ea60aacfe6de4
// Chapter 007 / native harmless quote-style pair: docs/design/src/007-tooling.md#14776eb637c2aaea
test("Chapter 007 / native quote styles keep values while reflected text can differ", () => {
  const before = ts.transpileModule("function label(){return 'x'}; label", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const after = ts.transpileModule('function label(){return "x"}; label', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const first = runInNewContext(before)
  const second = runInNewContext(after)
  assert.equal(first(), "x")
  assert.equal(second(), "x")
  assert.notEqual(first.toString(), second.toString())
})
