import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_TEST_COMPILER_PACKAGE || fileURLToPath(new URL("../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find(path => !existsSync(path))
const skip = spawnSync("bun", ["--version"]).status !== 0 ? "Bun is not installed" : missing && "build the compiler and runtime first"
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/opencode-native-require-extensionless.json", import.meta.url), "utf8"))

// VIP-34's mixed-project loader must preserve native module evaluation.
// Replacing one synchronous TypeScript leaf with its identical .vibe source
// must preserve require's values and identity without importing it first.
function project(t, files, links = {}, wrapper = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-require-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
  put("package.json", '{"type":"module"}')
  put("tsconfig.json", JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "Preserve", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true, jsx: "react", jsxFactory: "h"
  }, include: ["src/**/*", "packages/**/src/**/*"] }))
  mkdirSync(join(root, "node_modules"))
  for (const [name, target] of Object.entries({ effect: realpathSync(effect), "vibelang-runtime": runtime, vibelang: compiler, ...links })) {
    const path = join(root, "node_modules", name)
    mkdirSync(dirname(path), { recursive: true })
    symlinkSync(target.startsWith(".") ? join(root, target) : target, path)
  }
  for (const [path, text] of Object.entries(files)) put(path, text)
  let binary = native
  const calls = join(root, "compiler-calls.jsonl")
  if (wrapper) {
    binary = join(root, "compiler.mjs")
    put("compiler.mjs", 'import {appendFileSync} from "node:fs"; import {spawnSync} from "node:child_process"; const args=process.argv.slice(2); appendFileSync(' + JSON.stringify(calls) + ',JSON.stringify(args)+String.fromCharCode(10)); process.exit(spawnSync(' + JSON.stringify(native) + ',args,{stdio:"inherit"}).status??1)\n')
  }
  return {
    root,
    calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [],
    run(preload = true) {
      return spawnSync("bun", [...(preload ? ["--preload", "vibelang/bun"] : []), "run.cjs"], {
        cwd: root, encoding: "utf8", timeout: 45000,
        env: { ...process.env, VIBELANG_BINARY: binary, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), VIBELANG_BUN_DEBUG: "", NO_COLOR: "1" }
      })
    }
  }
}

function output(result) {
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.equal(result.signal, null)
  return JSON.parse(result.stdout)
}

function compare(t, files, links = {}, wrapper = false) {
  const original = Object.fromEntries(Object.entries(files).map(([name, text]) => [name.endsWith(".vibe") ? name.slice(0, -5) + ".ts" : name, text.replaceAll(".vibe"+'"', ".ts"+'"').replaceAll(".vibe"+"'", ".ts"+"'").replaceAll(".vibe"+String.fromCharCode(96), ".ts"+String.fromCharCode(96))]))
  const before = project(t, original, links)
  const expected = output(before.run(false))
  assert.deepEqual(output(before.run()), expected, "native-only source keeps Bun's behavior")
  const after = project(t, files, links, wrapper)
  assert.deepEqual(output(after.run()), expected, "a .vibe leaf must not make native require async")
  if (wrapper) {
    const calls = after.calls()
    assert.equal(calls.filter(args => args.includes("--project")).length, 1, "one whole-project compilation")

  }
}

for (const origin of ["relative", "absolute", "nested-directory"]) {
  test("opencode: transitive native package require with " + origin + " origin", { skip }, t => {
    const files = { ...corpus.files }
    const original = "Bun.resolveSync('./packages/plugin/src/effect/index.ts',__dirname)"
    if (origin === "absolute") {
      files["run.cjs"] = files["run.cjs"].replace(original, "Bun.resolveSync(require('node:path').resolve(__dirname,'packages/plugin/src/effect/index.ts'),__dirname)")
    } else if (origin === "nested-directory") {
      files["origin/deep/anchor.json"] = "{}"
      files["run.cjs"] = files["run.cjs"].replace(original, "Bun.resolveSync('../../packages/plugin/src/effect/index.ts',require('node:path').join(__dirname,'origin/deep'))")
    }
    compare(t, files, corpus.links, true)
  })
}

const kinds = ["reexport", "star", "import", "dynamic", "template", "import-equals", "namespace", "jsx"]
function pattern(input) {
  const leaf = "./" + "nested/".repeat(input.depth) + input.name
  const specifier = leaf + (input.suffix === "explicit" ? ".vibe" : input.suffix === "js" ? ".js" : "")
  const quoted = input.single ? "'" + specifier + "'" : JSON.stringify(specifier)
  const data = JSON.stringify(leaf)
  const prefix = 'const unicode = "🙂 from ./leaf"; export const data = ' + data + '; function echo(require: (s: string) => string) { return require(' + data + '); } export const shadow = echo(s => s);\n'
  let body
  switch (input.kind) {
    case "reexport": body = "export { value } from " + quoted; break
    case "star": body = "export * from " + quoted; break
    case "namespace": body = "import * as model from " + quoted + "; export const value = model.value"; break
    case "dynamic": body = "export const load = () => import(" + quoted + ").then(model => model.value)"; break
    case "template": body = "export const load = () => import(" + String.fromCharCode(96) + specifier + String.fromCharCode(96) + ").then(model => model.value)"; break
    case "import-equals": body = "import model = require(" + quoted + "); export const value = model.value"; break
    case "jsx": body = "import {value} from " + quoted + "; export {value}; declare global {namespace JSX {interface IntrinsicElements {span: any}}} function h(_tag: string, _props: unknown, ...children: unknown[]) {return {children}}; export const view = <span>{value.answer}</span>"; break
    default: body = "import { value as answer } from " + quoted + "; export const value = answer"
  }
  const extension = input.kind === "jsx" ? "tsx" : "ts"
  const files = {
    ["src/" + "nested/".repeat(input.depth) + input.name + ".vibe"]: "export const value = {answer: " + input.answer + "}\n",
    ["src/entry." + extension]: prefix + body + "\n",
    "run.cjs": "(async()=>{ const model = require('./src/entry." + extension + "'); const value = model.load ? await model.load() : model.value; const again = require('./src/entry." + extension + "'); console.log(JSON.stringify({answer:value.answer,data:model.data,shadow:model.shadow,identity:again===model,jsx:model.view?.children[0]??null})) })().catch(error=>{console.error(error);process.exitCode=1})\n"
  }
  return files
}

for (const kind of kinds) {
  test("synchronous import rewrite preserves " + kind + " and ordinary strings/bindings", { skip }, t => {
    compare(t, pattern({kind,depth:1,name:"leaf-雪",suffix:"extensionless",single:true,answer:42}), {}, kind !== "import-equals")
  })
}

test("native require of genuinely asynchronous source keeps Bun's own result", { skip }, t => {
  const p = project(t, {
    "src/leaf.ts": "export const value = await new Promise(resolve => setTimeout(() => resolve(42), 1))\n",
    "src/entry.ts": 'export {value} from "./leaf"\n',
    "run.cjs": "console.log(JSON.stringify(require('./src/entry.ts').value))\n"
  })
  const before = p.run(false), after = p.run()
  assert.equal(after.status, before.status)
  if (before.status === 0) assert.equal(after.stdout, before.stdout)
  else assert.match(after.stderr, /async module|await|asynchronous/i)
})

test("synchronous require: generated import syntax, path, suffix and launcher neighborhood", { skip }, t => {
  const inputs = fc.record({
    kind: fc.constantFrom(...kinds),
    depth: fc.integer({min:0,max:2}),
    name: fc.constantFrom("leaf", "leaf space", "leaf-雪", "leaf-λ"),
    suffix: fc.constantFrom("extensionless", "js", "explicit"),
    single: fc.boolean(),
    answer: fc.integer({min:-20,max:80})
  })
  fc.assert(fc.property(inputs, input => compare(t, pattern(input), {}, input.suffix === "extensionless" && input.kind !== "import-equals")), {seed: 597059, numRuns:40})
})
