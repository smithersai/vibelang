import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { addSourceChildLoaders } from "../lib/source-children.mjs"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-source-child-preloads.json", import.meta.url)))
const template = readFileSync(new URL("../templates/source-child.ts", import.meta.url), "utf8")
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const helperModule = await import("data:text/javascript;base64," + Buffer.from(compile(template + "\nexport { __vibelangSourceChild }\n")).toString("base64"))
const sourceChild = helperModule.__vibelangSourceChild
const specsFor = () => ({ vibelang: "0.0.11" })
function temp() {
  const root = mkdtempSync(join(tmpdir(), "alchemy-source-children-"))
  return { root, put(file, text) {
    mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text)
  }, dispose() { rmSync(root, { recursive: true, force: true }) } }
}
function configure(f, extra = {}) {
  f.put("package.json", JSON.stringify({ type: "module", ...extra }))
  for (const item of corpus.modules) f.put(item.file, item.source)
}

test("alchemy: the existing setup API wires BuildChild and DevChild source preloads", () => {
  const f = temp()
  try {
    configure(f, { name: "@alchemy.run/frontend-frameworks" })
    wireDeveloperTools({ root: f.root, ts, specsFor })
    for (const item of corpus.modules) {
      const after = readFileSync(join(f.root, item.file), "utf8")
      assert.match(after, /\.\.\.__vibelangSourceChild\(executable, args\)/, item.file)
      assert.match(after, /import\.meta\.resolve/)
      assert.deepEqual(addSourceChildLoaders(after, ts, { file: item.file }).text, after)
    }
    assert.equal(JSON.parse(readFileSync(join(f.root, "package.json"))).dependencies.vibelang, "0.0.11")
    assert.deepEqual(wireDeveloperTools({ root: f.root, ts, specsFor }).changed, [])
  } finally { f.dispose() }
})

test("source loaders resolve in the parent's package and preserve command, options and payload", async () => {
  const f = temp()
  try {
    configure(f)
    f.put("node_modules/vibelang/package.json", JSON.stringify({ type: "module", exports: { "./register": "./register.mjs", "./bun": "./bun.mjs" } }))
    f.put("node_modules/vibelang/register.mjs", "")
    f.put("node_modules/vibelang/bun.mjs", "")
    f.put("capture.mjs", "export function spawn(command,args,options) { return {command,args,options} }; export const make = spawn;\n")
    for (const [i, item] of corpus.modules.entries()) {
      const result = addSourceChildLoaders(item.source, ts, { file: item.file })
      assert.deepEqual(result.refusals, [])
      const compiled = compile(result.text).replaceAll('"effect/process/ChildProcess"', JSON.stringify(pathToFileURL(join(f.root, "capture.mjs")).href))
        .replaceAll('"node:child_process"', JSON.stringify(pathToFileURL(join(f.root, "capture.mjs")).href))
      f.put("launcher" + i + ".mjs", compiled)
      const mod = await import(pathToFileURL(join(f.root, "launcher" + i + ".mjs")).href)
      for (const bun of [false, true]) {
        const command = bun ? "/opt/runtime/bun" : process.execPath
        const value = mod.launch(command, "/foreign/source runner.ts", "/foreign/no-dependencies", bun)
        assert.equal(value.command, command)
        assert.equal(value.options.cwd, "/foreign/no-dependencies")
        assert.equal(value.args.at(-1), '{"ready":true}')
        const at = value.args.indexOf(bun ? "--preload" : "--import")
        assert.ok(at >= 0)
        assert.equal(value.args[at + 1], bun ? join(f.root, "node_modules/vibelang/bun.mjs") : pathToFileURL(join(f.root, "node_modules/vibelang/register.mjs")).href)
        assert.ok(at < value.args.indexOf("/foreign/source runner.ts"))
      }
      const built = mod.launch("node", "/foreign/runner.js", "/elsewhere", false)
      assert.equal(built.args.includes("--import"), false)
    }
  } finally { f.dispose() }
})

test("property: source and built entries, existing preloads, CLI flags, separators and paths preserve argv", () => {
  const rule = "Source-child launchers using Node `spawn`/`spawnSync` or Effect `ChildProcess.make` get native preloads for typed source entries."
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(rule))
  fc.assert(fc.property(
    fc.constantFrom("node", "/runtime/node", "node.exe", "bun", "/runtime/bun"),
    fc.constantFrom(".ts", ".mts", ".cts", ".tsx", ".vibe", ".vibex", ".js", ".mjs", ".d.ts", ".d.vibe.ts"),
    fc.array(fc.constantFrom("dir", "space dir", "unicode-λ"), { maxLength: 3 }),
    fc.boolean(), fc.boolean(),
    (command, ext, dirs, old, separator) => {
      const bun = command.endsWith("bun")
      const native = bun ? "vibelang/bun" : "vibelang/register"
      const flag = bun ? "--preload" : "--import"
      const prefix = [...(old ? [flag, native] : []), "--import", "repo-hook", "--no-warnings=ExperimentalWarning", ...(bun ? ["run"] : []), ...(separator ? ["--"] : [])]
      const entry = "/" + [...dirs, "Entry" + ext].join("/")
      const args = [...prefix, entry, "--import", "payload-is-not-a-preload"]
      let resolves = 0
      const resolved = pathToFileURL("/parent package/native.mjs").href
      const result = sourceChild(command, args, value => { assert.equal(value, native); resolves++; return resolved })
      const typed = ![".js", ".mjs", ".d.ts", ".d.vibe.ts"].includes(ext)
      assert.equal(result[0], command)
      assert.equal(resolves, typed ? 1 : 0)
      if (!typed) { assert.equal(result[1], args); return }
      assert.deepEqual(result[1].slice(-3), [entry, "--import", "payload-is-not-a-preload"])
      const loader = bun ? "/parent package/native.mjs" : resolved
      const at = result[1].indexOf(loader)
      assert.ok(at > 0 && result[1][at - 1] === flag)
      assert.equal(result[1].filter(v => v === loader).length, 1)
      assert.equal(result[1].includes(native), false)
      if (bun) assert.equal(at, 1)
      else assert.ok(at > result[1].indexOf("repo-hook"))
      if (separator) assert.ok(at < result[1].indexOf("--"))
      assert.deepEqual(sourceChild(command, result[1], () => resolved), result)
    }), { seed: 490049, numRuns: 300 })
})

test("lexical shadows, unsupported argv and generated sources are untouched with located warnings", () => {
  const imported = 'import { spawn as launch } from "node:child_process";\n'
  for (const source of [
    imported + 'function f(launch) { return launch("node", ["./x.ts"]) }',
    'import * as Child from "node:child_process"; { const Child = {spawn() {}}; Child.spawn("node", ["./x.ts"]) }',
    'const Child = {spawn() {}}; Child.spawn("node", ["./x.ts"])',
    'import type { spawn } from "node:child_process"; spawn("node", ["./x.ts"])',
    imported + 'launch("echo", ["./x.ts"])'
  ]) {
    const result = addSourceChildLoaders(source, ts)
    assert.equal(result.text, source)
    assert.equal(result.usesChild, false)
    assert.deepEqual(result.refusals, [])
  }
  for (const source of [
    imported + 'let args = ["x.ts"]; launch("node", args)',
    imported + 'const args = ["x.ts"]; launch("node", args); console.log(args)',
    imported + 'launch("node", makeArgs())',
    imported + 'launch(...values)',
    '/**\n * @generated by generator\n */\n' + imported + 'launch("node", ["x.ts"])',
    '#!/usr/bin/env node\n// DO NOT EDIT\n' + imported + 'launch("node", ["x.ts"])',
    'const {spawn} = require("node:child_process"); spawn("node", ["x.ts"])'
  ]) {
    const result = addSourceChildLoaders(source, ts)
    assert.equal(result.text, source)
    assert.ok(result.refusals.length > 0, source)
    assert.ok(result.refusals.every(r => r.line > 0))
  }
})

test("test-only helpers, fixtures, vendored sources and inherited build output stay byte-identical", () => {
  const f = temp()
  try {
    configure(f, { private: true })
    const source = corpus.modules[1].source
    const protectedPaths = ["test/launcher.test.ts", "fixtures/launch.ts", "helper.ts", "build-output/child.ts", "vendor/foreign/child.ts"]
    f.put("test/launcher.test.ts", 'import "../helper.ts";\n' + source)
    for (const file of protectedPaths.slice(1)) f.put(file, source)
    f.put("vendor/foreign/package.json", '{"type":"module"}')
    f.put(".gitmodules", '[submodule "foreign"]\npath = vendor/foreign\n')
    f.put("configs/base.json", '{"compilerOptions":{"outDir":"../build-output"}}')
    f.put("tsconfig.json", '{"extends":"./configs/base.json","include":["src"]}')
    wireDeveloperTools({ root: f.root, ts, specsFor })
    for (const file of protectedPaths) {
      assert.equal(readFileSync(join(f.root, file), "utf8"), file.startsWith("test/") ? 'import "../helper.ts";\n' + source : source, file)
    }
    assert.equal(JSON.parse(readFileSync(join(f.root, "package.json"))).devDependencies.vibelang, "0.0.11")
  } finally { f.dispose() }
})

test("unsupported runtime flags and non-runtime commands leave argv untouched", () => {
  for (const [command, args] of [
    ["echo", ["x.ts"]], ["node", ["--eval", "x.ts"]], ["node", ["--test", "x.ts"]],
    ["node", ["--unknown-runtime-flag", "x.ts"]], ["node", ["--import"]],
    ["bun", ["test", "x.ts"]], ["node", ["x.js"]]
  ]) assert.equal(sourceChild(command, args, () => { throw Error("must not resolve") })[1], args)
})

test("same-line calls keep the URL import before use; command, argv and options evaluate once", async () => {
  const f = temp()
  try {
    f.put("package.json", '{"type":"module"}')
    f.put("node_modules/vibelang/package.json", '{"type":"module","exports":{"./register":"./register.mjs"}}')
    f.put("node_modules/vibelang/register.mjs", "")
    f.put("capture.mjs", "export const spawn = (command,args,options) => ({command,args,options});")
    const source = 'import {spawn} from "node:child_process"; const order = []; const command = () => (order.push("command"), "node"); const entry = () => (order.push("entry"), "file.ts"); const options = () => (order.push("options"), {}); export const result = spawn(command(), [entry()], options()); export {order};'
    const result = addSourceChildLoaders(source, ts, { file: "launch.mjs" })
    f.put("launch.mjs", compile(result.text).replaceAll('"node:child_process"', JSON.stringify(pathToFileURL(join(f.root, "capture.mjs")).href)))
    const mod = await import(pathToFileURL(join(f.root, "launch.mjs")).href)
    assert.deepEqual(mod.order, ["command", "entry", "options"])
    assert.equal(mod.result.args.at(-1), "file.ts")
  } finally { f.dispose() }
})

test("strict helper typing supports noUncheckedIndexedAccess without exporting a new API", () => {
  const f = temp()
  try {
    f.put("helper.mts", template)
    f.put("ambient.d.ts", 'declare module "node:url" { export function fileURLToPath(value: string): string } interface ImportMeta { resolve(value: string): string }')
    const options = { strict: true, noUncheckedIndexedAccess: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] }
    const program = ts.createProgram([join(f.root, "helper.mts"), join(f.root, "ambient.d.ts")], options)
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
  } finally { f.dispose() }
})

test("Node and Bun source children load native syntax from a foreign cwd; unmodified launchers fail", async () => {
  const native = resolve(repo, "packages/compiler/native/vibelang")
  assert.ok(existsSync(native), "build the native compiler before this loader regression")
  assert.equal(spawnSync("bun", ["--version"], { encoding: "utf8" }).status, 0, "Bun is required for the source-child regression")
  const f = temp(), foreign = temp()
  try {
    f.put("package.json", '{"type":"module","private":true}')
    mkdirSync(join(f.root, "node_modules"))
    symlinkSync(join(repo, "packages/compiler"), join(f.root, "node_modules/vibelang"), "dir")
    symlinkSync(join(repo, "packages/runtime"), join(f.root, "node_modules/vibelang-runtime"), "dir")
    symlinkSync(realpathSync(join(repo, "experiments/node_modules/effect")), join(f.root, "node_modules/effect"), "dir")
    f.put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true }, include: ["src/**/*"] }))
    f.put("src/value.vibe", "export effect function value() { return 42 }\n")
    f.put("src/Runner.ts", 'import { runSync } from "effect/Effect"; import { value } from "./value.vibe"; console.log(runSync(value()));\n')
    const env = { ...process.env, VIBELANG_BINARY: native, VIBELANG_RUNTIME: join(repo, "packages/runtime"), VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(f.root, ".cache/vibelang") }
    const source = 'import {spawnSync} from "node:child_process"; export function launch(command, entry, cwd, env) { const args = [entry]; return spawnSync(command, args, {cwd,env,encoding:"utf8",timeout:30000}); }\n'
    f.put("before.mjs", source)
    const beforeModule = await import(pathToFileURL(join(f.root, "before.mjs")).href)
    const transformed = addSourceChildLoaders(source, ts, { file: "after.mjs" })
    assert.equal(transformed.usesChild, true)
    f.put("after.mjs", transformed.text)
    const afterModule = await import(pathToFileURL(join(f.root, "after.mjs")).href)
    for (const command of [process.execPath, "bun"]) {
      const before = beforeModule.launch(command, join(f.root, "src/Runner.ts"), foreign.root, env)
      assert.notEqual(before.status, 0, command + " unexpectedly ran unmodified native syntax")
      const after = afterModule.launch(command, join(f.root, "src/Runner.ts"), foreign.root, env)
      assert.equal(after.status, 0, command + "\n" + after.stderr)
      assert.equal(after.stdout.trim(), "42")
    }
  } finally { f.dispose(); foreign.dispose() }
})

test("wrapping Node and Effect launchers preserves exported declarations under strict checking", () => {
  const f = temp()
  try {
    f.put("ambient.d.ts", 'declare module "node:url" { export function fileURLToPath(value: string): string } interface ImportMeta { resolve(value: string): string }\ndeclare module "node:child_process" { export function spawn(command: string, args: readonly string[], options?: unknown): unknown }\ndeclare module "effect/process/ChildProcess" { export function make(command: string, args: readonly string[], options?: unknown): unknown }\n')
    for (const [i, item] of corpus.modules.entries()) {
      const outputs = []
      for (const [side, text] of [["before", item.source], ["after", addSourceChildLoaders(item.source, ts, { file: item.file }).text]]) {
        const name = "launcher" + i + "-" + side + ".mts"
        f.put(name, text)
        const options = { strict: true, noUncheckedIndexedAccess: true, declaration: true, emitDeclarationOnly: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], outDir: join(f.root, "out") }
        const program = ts.createProgram([join(f.root, name), join(f.root, "ambient.d.ts")], options)
        assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
        program.emit(undefined, (file, value) => { if (file.endsWith(".d.mts")) outputs.push(value) })
      }
      assert.equal(outputs.length, 2)
      assert.equal(outputs[0], outputs[1])
    }
  } finally { f.dispose() }
})

test("property: imported aliases, namespaces, directive prologues and argv literals wire once", () => {
  fc.assert(fc.property(fc.constantFrom("named", "namespace", "default", "computed"), fc.boolean(), fc.boolean(), fc.integer({ min: 0, max: 5 }),
    (style, constant, directive, collision) => {
      const name = "Child" + collision
      const head = style === "named" ? 'import {spawn as ' + name + '} from "node:child_process";'
        : 'import ' + (style === "default" ? name : "* as " + name) + ' from "node:child_process";'
      const callee = style === "named" ? name : style === "computed" ? name + '["spawn"]' : name + ".spawn"
      const source = (directive ? '#!/usr/bin/env node\n"use strict";\n' : "") + head +
        ' const __vibelangSourceChild = 1; const __vibelangFileURLToPath = 2;' +
        (constant ? ' const argv = ["./Entry.ts"];' : "") + callee + '("node", ' + (constant ? "argv" : '["./Entry.ts"]') + ', {cwd:"/elsewhere"});'
      const result = addSourceChildLoaders(source, ts)
      assert.deepEqual(result.refusals, [], source)
      assert.equal(result.usesChild, true)
      assert.match(result.text, /\.\.\.__vibelangSourceChild2\(/)
      assert.deepEqual(ts.createSourceFile("child.ts", result.text, ts.ScriptTarget.Latest, true).parseDiagnostics, [])
      assert.equal(addSourceChildLoaders(result.text, ts).text, result.text)
      if (directive) assert.ok(result.text.indexOf('"use strict"') < result.text.indexOf('from "node:url"'))
    }), { seed: 490050, numRuns: 200 })
})
