import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { canonicalSourceChildImports } from "../lib/source-child-imports.mjs"
import { addSourceChildLoaders } from "../lib/source-children.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-source-child-checkjs.json", import.meta.url)))
const runtimeText = source => {
  const canonical = canonicalSourceChildImports(source, ts, "launch.mjs")
  const parsed = ts.createSourceFile("launch.mjs", canonical, ts.ScriptTarget.Latest, true)
  const imports = parsed.statements.filter(ts.isImportDeclaration).sort((a,b)=>a.moduleSpecifier.text.localeCompare(b.moduleSpecifier.text))
  const body = parsed.statements.filter(node=>!ts.isImportDeclaration(node))
  const ordered = ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed,[...imports,...body]))
  return ts.transpileModule(ordered, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true }
}).outputText
}

function check(modules, { emit = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "source-child-checkjs-"))
  try {
    symlinkSync(join(repo, "packages/runtime/node_modules"), join(root, "node_modules"), "dir")
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    for (const [name, text] of Object.entries(modules)) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), text)
    }
    const options = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, allowJs: true, checkJs: true,
      types: ["node"], typeRoots: [join(root, "node_modules/@types")], declaration: emit, emitDeclarationOnly: emit, noEmit: !emit,
      rootDir: root, outDir: join(root, "emit")
    }
    const host = ts.createCompilerHost(options)
    host.getCurrentDirectory = () => root
    const program = ts.createProgram(Object.keys(modules).map(name => join(root, name)), options, host)
    const diagnostics = ts.getPreEmitDiagnostics(program)
    const outputs = new Map()
    if (emit && !diagnostics.length) {
      const result = program.emit(undefined, (name, text) => outputs.set(name.slice(root.length + 1), text), undefined, true)
      diagnostics.push(...result.diagnostics)
    }
    return { codes: diagnostics.map(d => d.code), text: ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root, getCanonicalFileName: x => x, getNewLine: () => "\n"
    }), outputs }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode: a strict native JavaScript source launcher remains valid after setup", () => {
  const native = check({ "native.mjs": corpus.source })
  assert.deepEqual(native.codes, [], native.text)
  const fixed = addSourceChildLoaders(corpus.source, ts, { file: "launch.mjs" })
  assert.equal(fixed.usesChild, true)
  assert.deepEqual(fixed.refusals, [])
  const result = check({ "converted.mjs": fixed.text })
  assert.deepEqual(result.codes, [], result.text)
})

test("setup refreshes the owned untyped JavaScript helper without changing runtime code", () => {
  const before = check({ "old.mjs": corpus.previous })
  assert.ok(before.codes.includes(2556), before.text)
  assert.ok(before.codes.includes(7006), before.text)
  const fixed = addSourceChildLoaders(corpus.previous, ts, { file: "launch.mjs" })
  assert.deepEqual(fixed.refusals, [])
  assert.equal(runtimeText(fixed.text), runtimeText(corpus.previous))
  const after = check({ "new.mjs": fixed.text })
  assert.deepEqual(after.codes, [], after.text)
  assert.equal(addSourceChildLoaders(fixed.text, ts, { file: "launch.mjs" }).text, fixed.text)
})

test("property: strict JavaScript launcher variants preserve native declarations and overloads", () => {
  const modules = {}, pairs = []
  fc.assert(fc.property(fc.record({
    sync: fc.boolean(), namespace: fc.boolean(), binding: fc.boolean(), javascript: fc.boolean(),
    collisions: fc.integer({ min: 0, max: 3 }), entry: fc.constantFrom("entry.ts", "entry.mts", "entry.vibe", "entry.vibex")
  }), input => {
    const i = pairs.length, extension = input.javascript ? ".js" : ".mjs"
    const name = input.sync ? "spawnSync" : "spawn"
    const head = input.namespace ? 'import * as Child from "node:child_process";' : 'import { ' + name + ' as launchChild } from "node:child_process";'
    const callee = input.namespace ? "Child." + name : "launchChild"
    const collisions = Array.from({ length: input.collisions }, (_, n) => 'const __vibelangSourceChild' + (n ? n + 1 : "") + '=' + n + '; const __vibelangNodeURL' + (n ? n + 1 : "") + '=' + n + ';').join("\n")
    const source = head + "\n" + collisions + '\n/** @param {string} command */\nexport const launch = (command) => { ' +
      (input.binding ? 'const argv = [' + JSON.stringify(input.entry) + ']; ' : "") +
      'return ' + callee + '(command, ' + (input.binding ? "argv" : '[' + JSON.stringify(input.entry) + ']') + ', { cwd: process.cwd() }); };\n'
    const result = addSourceChildLoaders(source, ts, { file: "launcher" + extension })
    assert.equal(result.usesChild, true)
    assert.deepEqual(result.refusals, [])
    assert.equal(addSourceChildLoaders(result.text, ts, { file: "launcher" + extension }).text, result.text)
    const native = "native/case" + i + extension, converted = "converted/case" + i + extension
    modules[native] = source; modules[converted] = result.text
    pairs.push([native, converted])
  }), { seed: 910051, numRuns: 80 })
  const result = check(modules, { emit: true })
  assert.deepEqual(result.codes, [], result.text)
  for (const [native, converted] of pairs) {
    const declaration = name => "emit/" + name.replace(/\.mjs$/, ".d.mts").replace(/\.js$/, ".d.ts")
    assert.ok(result.outputs.has(declaration(native)))
    assert.equal(result.outputs.get(declaration(converted)), result.outputs.get(declaration(native)), native)
  }
})

test("typed JavaScript helpers prune safely and preserve manual documentation or observations", () => {
  const source = corpus.source.replace('["entry.ts"]', '[entry]').replace('@param {string} command', '@param {string} command\n * @param {string} entry').replace('(command)', '(command, entry)')
  const wired = addSourceChildLoaders(source, ts, { file: "launch.mjs" }).text
  const known = wired.replace('@param {string} entry', '@param {"entry.js"} entry')
  const pruned = addSourceChildLoaders(known, ts, { file: "launch.mjs" })
  assert.equal(pruned.usesChild, false)
  assert.ok(!pruned.text.includes("__vibelangSourceChild"))
  for (const manual of [
    wired + "\nexport { __vibelangSourceChild };\n",
    wired.replace("@template {string} C", "@template {number} C"),
    wired.replace("const values = args", "/* authored edit */ const values = args")
  ]) {
    const result = addSourceChildLoaders(manual, ts, { file: "launch.mjs" })
    assert.equal(result.text, manual)
    assert.ok(result.refusals.length)
  }
})

test("type-only JSDoc observations protect generated functions and URL imports", () => {
  const observed = corpus.previous + "\n/** @type {typeof __vibelangSourceChild} */\nexport let observedType;\n"
  const upgraded = addSourceChildLoaders(observed, ts, { file: "launch.mjs" })
  assert.equal(upgraded.text, observed)
  assert.ok(upgraded.refusals.some(w => w.reason.includes("observations")))

  const wired = addSourceChildLoaders(corpus.source, ts, { file: "launch.mjs" }).text
  const noSource = wired.replace('["entry.ts"]', '["entry.js"]') +
    "\n/** @type {typeof __vibelangNodeURL} */\nexport let observedURL;\n"
  const pruned = addSourceChildLoaders(noSource, ts, { file: "launch.mjs" })
  assert.equal(pruned.text, noSource)
  assert.ok(pruned.refusals.length)
})
