import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { addSourceChildLoaders } from "../lib/source-children.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-release-smoke-source-child.json", import.meta.url), "utf8"))
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "t3code-source-execfile-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", JSON.stringify({ type: "module" }))
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(join(repo, "packages/runtime/node_modules/effect"), join(root, "node_modules/effect"), "dir")
  put("node_modules/vibelang/package.json", JSON.stringify({ type: "module", exports: { "./register": "./register.mjs" } }))
  put("node_modules/vibelang/register.mjs", `import { registerHooks } from "node:module"; import { readFileSync } from "node:fs";
registerHooks({ load(url, context, next) { return url.endsWith(".vibe") ? { format: "module", source: readFileSync(new URL(url), "utf8"), shortCircuit: true } : next(url, context) } });`)
  return { root, put }
}

test("t3code release smoke: execFileSync source child gets native registration", () => {
  const result = addSourceChildLoaders(corpus.source, ts, { file: corpus.file })
  assert.equal(result.usesChild, true)
  assert.deepEqual(result.refusals, [])
  assert.match(result.text, /execFileSync\(\.\.\.__vibelangSourceChild\(/)
  assert.equal(addSourceChildLoaders(result.text, ts, { file: corpus.file }).text, result.text)
})

test("a release-smoke child imports VibeLang even though the parent's Node preload is not inherited", (t) => {
  const f = fixture(t)
  const result = addSourceChildLoaders(corpus.source, ts, { file: corpus.file })
  f.put("parent.mjs", compile(result.text) + "\nconsole.log(launch(" + JSON.stringify(f.root) + ").trim());")
  f.put("child.ts", 'import { value } from "./schemaJson.vibe"; console.log(value)')
  f.put("schemaJson.vibe", "export const value = 42")
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  const child = spawnSync(process.execPath, [join(f.root, "parent.mjs")], { env, encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout.trim(), "42")
})

test("property: Node execFile API bindings preserve argv, options and evaluation count", async (t) => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("execFile", "execFileSync", "spawn", "spawnSync"),
    fc.constantFrom("named", "namespace", "element"),
    fc.constantFrom(".ts", ".vibe", ".mjs"),
    fc.string({ maxLength: 24 }),
    async (method, binding, extension, payload) => {
      const f = fixture(t)
      const specifier = binding === "named" ? `{ ${method} as run }` : "* as child"
      const call = binding === "named" ? "run" : binding === "element" ? `child["${method}"]` : `child.${method}`
      const source = `import ${specifier} from "node:child_process";
export const events = [];
export function launch(entry, payload) {
  const options = { cwd: "/foreign", marker: 42 };
  const once = value => { events.push(value); return value };
  return ${call}(once("node"), [once(entry), once(payload)], options);
}`
      const result = addSourceChildLoaders(source, ts, { file: "runner.ts" })
      assert.equal(result.usesChild, true, source)
      assert.deepEqual(result.refusals, [])
      assert.equal(addSourceChildLoaders(result.text, ts, { file: "runner.ts" }).text, result.text)
      f.put("capture.mjs", ["execFile", "execFileSync", "spawn", "spawnSync"].map(name => `export function ${name}(command,args,options) { return { command,args,options } }`).join("\n"))
      f.put("parent.mjs", compile(result.text).replaceAll('"node:child_process"', JSON.stringify(pathToFileURL(join(f.root, "capture.mjs")).href)))
      const mod = await import(pathToFileURL(join(f.root, "parent.mjs")).href)
      const entry = "/foreign/entry" + extension
      const child = mod.launch(entry, payload)
      assert.equal(child.command, "node")
      assert.equal(child.options.marker, 42)
      assert.deepEqual(mod.events, ["node", entry, payload])
      assert.deepEqual(child.args.slice(-2), [entry, payload])
      assert.equal(child.args.filter(arg => arg === "--import").length, extension === ".mjs" ? 0 : 1)
    }
  ), { numRuns: 80 })
})

test("execFile keeps its callback and process options while loading a typed child", async (t) => {
  const f = fixture(t)
  const source = 'import { execFile as run } from "node:child_process"; export function launch(root, callback) { return run(process.execPath, [root + "/child.ts"], { encoding: "utf8", cwd: root }, callback); }'
  const result = addSourceChildLoaders(source, ts, { file: "runner.ts" })
  assert.equal(result.usesChild, true)
  assert.deepEqual(result.refusals, [])
  f.put("parent.mjs", compile(result.text))
  f.put("child.ts", 'import { value } from "./schemaJson.vibe"; console.log(value); console.error("child stderr")')
  f.put("schemaJson.vibe", "export const value = 42")
  const mod = await import(pathToFileURL(join(f.root, "parent.mjs")).href)
  await new Promise((resolve, reject) => {
    const child = mod.launch(f.root, (error, stdout, stderr) => {
      try {
        assert.equal(error, null)
        assert.equal(stdout.trim(), "42")
        assert.equal(stderr.trim(), "child stderr")
        resolve()
      } catch (error) { reject(error) }
    })
    assert.equal(typeof child.pid, "number")
  })
})

test("property: execFile callback bindings keep trailing arguments and evaluation order", async (t) => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("named", "namespace", "element"),
    fc.boolean(),
    fc.string({ maxLength: 24 }),
    async (binding, withOptions, payload) => {
      const f = fixture(t)
      const specifier = binding === "named" ? "{ execFile as run }" : "* as child"
      const call = binding === "named" ? "run" : binding === "element" ? 'child["execFile"]' : "child.execFile"
      const source = `import ${specifier} from "node:child_process";
export const events = [];
export const options = { cwd: "/foreign", marker: 42 };
export function launch(entry, payload, callback) {
  const once = value => { events.push(value); return value };
  return ${call}(once("node"), [once(entry), once(payload)], ${withOptions ? "once(options), " : ""}once(callback));
}`
      const result = addSourceChildLoaders(source, ts, { file: "runner.ts" })
      assert.equal(result.usesChild, true)
      assert.deepEqual(result.refusals, [])
      assert.equal(addSourceChildLoaders(result.text, ts, { file: "runner.ts" }).text, result.text)
      f.put("capture.mjs", "export function execFile(...args) { return args }")
      f.put("parent.mjs", compile(result.text).replaceAll('"node:child_process"', JSON.stringify(pathToFileURL(join(f.root, "capture.mjs")).href)))
      const mod = await import(pathToFileURL(join(f.root, "parent.mjs")).href)
      const callback = () => {}
      const args = mod.launch("/foreign/entry.ts", payload, callback)
      assert.equal(args.length, withOptions ? 4 : 3)
      assert.equal(args.at(-1), callback)
      if (withOptions) assert.equal(args[2], mod.options)
      assert.deepEqual(mod.events, ["node", "/foreign/entry.ts", payload, ...(withOptions ? [mod.options] : []), callback])
      assert.deepEqual(args[1].slice(-2), ["/foreign/entry.ts", payload])
      assert.equal(args[1].filter(arg => arg === "--import").length, 1)
    }
  ), { numRuns: 40 })
})

test("fourth arguments remain refused for non-callback launcher APIs", () => {
  for (const method of ["spawn", "spawnSync", "execFileSync"]) {
    const source = `import { ${method} } from "node:child_process"; ${method}("node", ["child.ts"], {}, () => {});`
    const result = addSourceChildLoaders(source, ts, { file: "runner.ts" })
    assert.equal(result.usesChild, false)
    assert.equal(result.text, source)
    assert.match(result.refusals[0].reason, /explicit command/)
  }
})
