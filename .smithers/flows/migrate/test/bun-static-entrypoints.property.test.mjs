import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { wireBunBuilds } from "../lib/wire.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-http-recorder-static-bun-entry.json", import.meta.url)))
const specsFor = () => ({ vibelang: "0.0.11", "vibelang-unplugin": "0.0.11" })

function fixture(source, file = "script/build.ts") {
  const container = mkdtempSync(join(tmpdir(), "bun-static-entry-")), root = join(container, "repo")
  const put = (name, text) => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  put("package.json", JSON.stringify({ name: "entry-fixture", type: "module", scripts: { build: "bun run script/build.ts" } }))
  put(file, source)
  put("node_modules/vibelang-unplugin/package.json", JSON.stringify({ name: "vibelang-unplugin", type: "module", exports: { "./bun": "./bun.mjs" } }))
  // The loader accepts native TS only. This tests the setup path and actual
  // Bun entry resolution; compiler semantics have their separate case suite.
  put("node_modules/vibelang-unplugin/bun.mjs", 'export default () => ({name:"entry-control",setup(build){build.onLoad({filter:/[.]vibe[x]?$/},async ({path})=>({contents:await Bun.file(path).text(),loader:path.endsWith(".vibex")?"tsx":"ts"}))}})\n')
  const wire = () => wireBunBuilds({ root, packages: [{ dir: "." }], ts, specsFor })
  return { root, container, put, wire, text: () => readFileSync(join(root, file), "utf8"), remove: () => rmSync(container, { recursive: true, force: true }) }
}
function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression
  return node
}
function selected(text) {
  const source = ts.createSourceFile("build.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let entries
  const name = (node) => ts.isComputedPropertyName(node) ? node.expression.text : node.text
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === "Bun" && node.expression.name.text === "build") {
      const options = unwrap(node.arguments[0])
      if (options && ts.isObjectLiteralExpression(options)) {
        const property = options.properties.find(p => ts.isPropertyAssignment(p) && name(p.name) === "entrypoints")
        const array = property && unwrap(property.initializer)
        if (array && ts.isArrayLiteralExpression(array)) entries = array.elements.map(unwrap).filter(ts.isStringLiteralLike).map(n => n.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return entries
}
function run(f) {
  const r = spawnSync("bun", ["script/build.ts"], { cwd: f.root, encoding: "utf8", timeout: 30000 })
  assert.ifError(r.error)
  return r
}
const observe = '\nif (!result.success) throw new AggregateError(result.logs)\nconst built = await import("data:text/javascript;base64," + Buffer.from(await result.outputs[0].text()).toString("base64"))\nconsole.log(JSON.stringify(built.value))\n'

test("opencode http-recorder: setup follows the existing converted literal entry", () => {
  const f = fixture(corpus.source)
  try {
    f.put(corpus.after, corpus.module)
    assert.deepEqual(f.wire().warnings, [])
    assert.deepEqual(selected(f.text()), [corpus.after])
    assert.deepEqual(f.wire().changed, [], "the path and plugin edits are idempotent")
  } finally { f.remove() }
})

test("actual Bun entry resolution agrees before and after source migration", () => {
  for (const rooted of [false, true]) {
    const source = 'export const result = await Bun.build({entrypoints:["src/index.ts"],target:"bun",format:"esm",write:false' + (rooted ? ',root:"src"' : "") + '})\n' + observe
    const f = fixture(source)
    try {
      f.put("src/index.ts", corpus.module)
      const before = run(f)
      assert.equal(before.status, 0, before.stderr)
      assert.equal(JSON.parse(before.stdout.trim()), 7)
      renameSync(join(f.root, "src/index.ts"), join(f.root, "src/index.vibe"))
      const missing = run(f)
      assert.notEqual(missing.status, 0)
      assert.match(missing.stderr, /src\/index\.ts/)
      assert.deepEqual(f.wire().warnings, [])
      const after = run(f)
      assert.equal(after.status, 0, after.stderr)
      assert.equal(JSON.parse(after.stdout.trim()), 7)
    } finally { f.remove() }
  }
})

test("property: static Bun entries track only missing native files with existing converted files", () => {
  fc.assert(fc.property(
    fc.constantFrom("index", "nested/Entry", "with space", "café", "quote'name"),
    fc.constantFrom("ts", "tsx"), fc.boolean(), fc.boolean(), fc.boolean(),
    fc.constantFrom("bare", "quoted", "computed"), fc.constantFrom("plain", "as", "satisfies", "paren"),
    (name, extension, native, converted, directory, key, wrapper) => {
      const entry = "src/" + name + "." + extension
      const migrated = "src/" + name + (extension === "tsx" ? ".vibex" : ".vibe")
      const field = key === "bare" ? "entrypoints" : key === "quoted" ? '"entrypoints"' : '["entrypoints"]'
      let array = "[" + JSON.stringify(entry) + ',"src/keep.ts"]'
      if (wrapper === "as") array = "(" + array + " as const)"
      if (wrapper === "satisfies") array = "(" + array + " satisfies readonly string[])"
      if (wrapper === "paren") array = "(" + array + ")!"
      const untouched = "const note = " + JSON.stringify(entry) + ";\n"
      const source = untouched + "export const result = Bun.build({" + field + ":" + array + ',outdir:"src/keep.ts"})\n'
      const f = fixture(source)
      try {
        if (native) f.put(entry, "export const value = 1\n")
        if (converted) {
          if (directory) mkdirSync(join(f.root, migrated), { recursive: true })
          else f.put(migrated, "export const value = 2\n")
        }
        f.put("src/keep.ts", "export const keep = 3\n")
        assert.deepEqual(f.wire().warnings, [])
        assert.deepEqual(selected(f.text()), [!native && converted && !directory ? migrated : entry, "src/keep.ts"])
        assert.ok(f.text().includes(untouched), "a non-entry string keeps its authored value")
        assert.ok(f.text().includes('outdir:"src/keep.ts"'))
        assert.deepEqual(f.wire().changed, [])
      } finally { f.remove() }
    }), { seed: 151553, numRuns: 160 })
})

test("native twins, declaration sidecars, outside paths and protected tests retain their spelling", () => {
  const source = 'export const result = Bun.build({entrypoints:["src/native.ts","src/types.d.ts","../outside/entry.ts"]})\n'
  const f = fixture(source)
  try {
    f.put("src/native.ts", "export const native = 1\n")
    f.put("src/native.vibe", "export const native = 2\n")
    f.put("src/types.d.vibe", "export const declared = 1\n")
    mkdirSync(join(f.container, "outside"), { recursive: true })
    writeFileSync(join(f.container, "outside/entry.vibe"), "export const outside = 1\n")
    const protectedText = 'Bun.build({entrypoints:["src/moved.ts"]})\n'
    f.put("src/moved.vibe", corpus.module)
    f.put("test/build.test.ts", protectedText)
    f.wire()
    assert.deepEqual(selected(f.text()), ["src/native.ts", "src/types.d.ts", "../outside/entry.ts"])
    assert.equal(readFileSync(join(f.root, "test/build.test.ts"), "utf8"), protectedText)
  } finally { f.remove() }
})

test("an unsupported build call leaves every authored entry unchanged", () => {
  const source = 'Bun.build(options)\nBun.build({entrypoints:["src/index.ts"]})\n'
  const f = fixture(source)
  try {
    f.put("src/index.vibe", corpus.module)
    const result = f.wire()
    assert.ok(result.warnings.some(x => x.includes("object literal")))
    assert.equal(f.text(), source)
  } finally { f.remove() }
})

test("ambiguous option overrides and explicit cwd changes keep entries with a manual warning", () => {
  for (const source of [
    'Bun.build({entrypoints:["src/index.ts"],...options})\n',
    'Bun.build({entrypoints:["src/index.ts"],entrypoints:other})\n',
    'Bun.build({entrypoints:["src/index.ts"],[unknown]:1})\n',
    'process.chdir("other")\nBun.build({entrypoints:["src/index.ts"]})\n'
  ]) {
    const f = fixture(source)
    try {
      f.put("src/index.vibe", corpus.module)
      const result = f.wire()
      assert.deepEqual(selected(f.text()), ["src/index.ts"])
      assert.ok(result.warnings.some(w => w.includes("route those entries by hand")))
    } finally { f.remove() }
  }
})

const receiverCorpus = JSON.parse(readFileSync(new URL("./corpus/bun-build-local-binding.json", import.meta.url)))
const mockBuild = 'const mock = {build:(options:{entrypoints:readonly string[]})=>options.entrypoints};\n'
function boundBuild(kind, entry) {
  const call = 'Bun.build({entrypoints:[' + JSON.stringify(entry) + ']})'
  const bodies = {
    constant: 'const Bun = mock; export const result = ' + call,
    mutable: 'let Bun = mock; export const result = ' + call,
    variable: 'var Bun = mock; export const result = ' + call,
    parameter: 'function select(Bun:typeof mock) {return ' + call + '}; export const result = select(mock)',
    default: 'function select(Bun:typeof mock=mock) {return ' + call + '}; export const result = select()',
    arrow: 'const select = (Bun:typeof mock) => ' + call + '; export const result = select(mock)',
    destructure: 'const {api:Bun} = {api:mock}; export const result = ' + call,
    nested: 'export const result = (()=>{const Bun=mock;return ' + call + '})()',
    caught: 'export let result:readonly string[]=[];try{throw mock}catch(Bun:any){result=' + call + '}',
    class: 'class Bun {static build=mock.build}; export const result=' + call,
    imported: 'import Bun from "./mock.ts"; export const result=' + call,
    namespace: 'import * as Bun from "./mock.ts"; export const result=' + call
  }
  return mockBuild + bodies[kind] + '\nconsole.log(JSON.stringify(result))\n'
}
function prepareBound(source, entry = "src/index.ts") {
  const f = fixture(source)
  f.put(entry.replace(/\.tsx?$/, entry.endsWith(".tsx") ? ".vibex" : ".vibe"), corpus.module)
  f.put("script/mock.ts", 'export const build=(options:{entrypoints:readonly string[]})=>options.entrypoints;export default {build}\n')
  return f
}
function checkBound(input, nativeTypes = false) {
  const source = boundBuild(input.kind, input.entry)
  const f = prepareBound(source, input.entry)
  try {
    if (nativeTypes) {
      const options = {strict:true,noEmit:true,skipLibCheck:true,types:[],target:ts.ScriptTarget.ES2022,
        module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true}
      const program = ts.createProgram([join(f.root,"script/build.ts")], options)
      const diagnostics = ts.getPreEmitDiagnostics(program)
      assert.deepEqual(diagnostics.map(d=>[d.code,ts.flattenDiagnosticMessageText(d.messageText,"\n")]), [],
        "native TypeScript admits this local receiver")
      console.log("BUN_RECEIVER_NATIVE_TS",ts.version,input.kind)
    }
    const before = run(f)
    assert.equal(before.status,0,before.stderr)
    assert.deepEqual(JSON.parse(before.stdout.trim()),[input.entry])
    assert.deepEqual(f.wire().warnings,[])
    const after = run(f)
    assert.equal(after.status,0,after.stderr)
    const afterEntries = JSON.parse(after.stdout.trim())
    if (nativeTypes) console.log("BUN_RECEIVER_OBSERVATION",JSON.stringify({before:JSON.parse(before.stdout.trim()),after:afterEntries}))
    assert.deepEqual(afterEntries,[input.entry],"setup must leave a non-bundler's observed entries unchanged")
    assert.equal(f.text(),source,"setup must leave a non-bundler's own options untouched")
  } finally { f.remove() }
}
test("local Bun receiver corpus preserves native types and observed entries", () => {
  checkBound(receiverCorpus.input,true)
  for (const kind of ["constant","mutable","variable","default","arrow","destructure","nested","caught","class","imported","namespace"])
    checkBound({kind,entry:"src/index.ts"})
})
test("property: local Bun receiver bindings keep their authored entries", () => {
  fc.assert(fc.property(fc.record({
    kind:fc.constantFrom("constant","mutable","variable","parameter","default","arrow","destructure","nested","caught","class","imported","namespace"),
    name:fc.constantFrom("Entry","with space","café","quote'name"),depth:fc.integer({min:0,max:3}),jsx:fc.boolean()
  }), input=>checkBound({kind:input.kind,entry:"src/"+"nested/".repeat(input.depth)+input.name+(input.jsx?".tsx":".ts")})),
    {seed:151534,numRuns:200})
})
test("direct Bun API replacements and type-only imports stay authored", () => {
  for (const prefix of [
    "Bun.build=mock.build;", 'Bun["build"]=mock.build;', "Bun=mock;", "globalThis.Bun=mock;",
    'globalThis["Bun"]=mock;', "({Bun}={Bun:mock});", "[Bun]=[mock];",
    "Bun.Glob=mock.build;", 'import type * as Bun from "bun";'
  ]) {
    const source=mockBuild+prefix+'\nBun.build({entrypoints:["src/index.ts"]})\n'
    const f=prepareBound(source)
    try {assert.deepEqual(f.wire().warnings,[]);assert.equal(f.text(),source)} finally {f.remove()}
  }
})
test("genuine Bun calls still migrate beside local and type-only names", () => {
  for (const prefix of ["", 'import * as Bun from "bun";\n', 'import Bun from "bun";\n', "type Bun=number;\n", "interface Bun {typeOnly:true}\n"]) {
    const local='function local(Bun:typeof mock){return Bun.build({entrypoints:["src/index.ts"]})}\n'
    const source=prefix+mockBuild+local+
      'export const result=await Bun.build({entrypoints:["src/index.ts"],target:"bun",format:"esm",write:false})\n'+
      'if(!result.success)throw new AggregateError(result.logs)\n'+
      'const built=await import("data:text/javascript;base64,"+Buffer.from(await result.outputs[0].text()).toString("base64"))\n'+
      'console.log(JSON.stringify({actual:built.value,local:local(mock)[0]}))\n'
    const f=fixture(source)
    try {
      f.put("src/index.ts",corpus.module)
      const before=run(f);assert.equal(before.status,0,before.stderr)
      assert.deepEqual(JSON.parse(before.stdout.trim()),{actual:7,local:"src/index.ts"})
      renameSync(join(f.root,"src/index.ts"),join(f.root,"src/index.vibe"))
      assert.deepEqual(f.wire().warnings,[])
      assert.ok(f.text().includes(local),"the local call remains byte-for-byte authored")
      assert.ok(f.text().includes('"src/index.vibe"'),"the genuine bundle entry follows its source")
      const after=run(f);assert.equal(after.status,0,after.stderr)
      assert.deepEqual(JSON.parse(after.stdout.trim()),{actual:7,local:"src/index.ts"})
      assert.deepEqual(f.wire().changed,[])
    } finally {f.remove()}
  }
})

test("Bun receiver preservation quotes the safe rewrite contract", () => {
  assert.ok(readFileSync(SpecPath(receiverCorpus.spec), "utf8").includes(receiverCorpus.quote))
})
