import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve, posix } from "node:path"
import { pathToFileURL } from "node:url"
import vm from "node:vm"
const repo = process.cwd()
const load = async name => import(pathToFileURL(join(repo, ".smithers/flows/migrate/lib", name + ".mjs")).href)
const { wireViteApps } = await load("wire")
const { planScope } = await load("onepass")
const { prepareState, applyState } = await load("codemod-state")
const { pathAliases } = await load("codemod")
const ts = createRequire(join(repo, "packages/runtime/package.json"))("typescript")
const [key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 15
const corpusName = key === "explicit-call" ? "t3code-vite-config-explicit-caller" : "t3code-vite-config-api-caller"
const fixture = JSON.parse(readFileSync(join(repo, "typescript/tsc/internal/vibelangfuzz/testdata/corpus", corpusName + ".json"), "utf8"))

const dir = mode & 8 ? "apps/space δ" : "apps/web"
const cfg = dir + "/vite.config.ts", leaf = dir + "/src/leaf.ts", caller = dir + "/scripts/warm-dep-cache.ts"
const declaration = key === "foreign-shadow" ? 'const resolveConfig = async (options: unknown, command: string) => ({ marker: "local" }); const optimizeDeps = (value: unknown) => value;' :
 (mode & 3) === 0 ? 'import { resolveConfig, optimizeDeps } from "vite";' :
 (mode & 3) === 1 ? 'import { resolveConfig as configure, optimizeDeps as optimize } from "vite";' : 'import * as Vite from "vite";' + ((mode & 3) === 3 ? 'const { resolveConfig: configure, optimizeDeps: optimize } = Vite;' : "")
const call = key === "foreign-shadow" || (mode & 3) === 0 ? ["resolveConfig", "optimizeDeps"] :
 (mode & 3) === 2 ? ["Vite.resolveConfig", "Vite.optimizeDeps"] : ["configure", "optimize"]
const explicit = key === "explicit-call" ? ', configFile: "vite.config.ts", configLoader: "native"' : key === "opt-out" ? ", configFile: false" : ""
let source = declaration + '\nexport async function warm(webRoot: string) { const options = { root: webRoot, logLevel: "error"' + explicit + ' }; return ' + call[1] + '(await ' + call[0] + '(options, "serve")); }\n'
if ((key === "implicit-call" || key === "explicit-call" || key === "retained-config") && (mode & 3) === 0) source = fixture.caller
if (key === "script-only") source = "export async function warm(webRoot: string) { return { marker: \"script\" }; }\n"
if (mode & 4) source = source.replaceAll("\n", "\r\n")
mkdirSync(join(repo, ".cache"), { recursive: true })
const root = mkdtempSync(join(repo, ".cache/config-caller-model-"))
const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const sentinel = mode & 4 ? "false" : "true"
const configText = fixture.config.replace('"true"', JSON.stringify(sentinel))
put("package.json", JSON.stringify({ private: true, workspaces: ["apps/*"] }))
put(dir + "/package.json", JSON.stringify({ name: "fixture", private: true, type: "module", scripts: { dev: "vite", warm: "node --import=vibelang/register scripts/warm-dep-cache.ts" } }))
put(cfg, configText)
put(leaf, fixture.leaf)
put(caller, source)
// Configuration evaluation and the foreign Vite API are controlled. The
// production setup, planner and complete codemod transaction run unchanged;
// this checks caller/options/value preservation, not a real optimizer or
// native compilation.
function evaluateConfig(file) {
 const exports = {}
 const plugin = () => ({ name: "controlled-plugin" })
 const pluginModule = Object.assign(plugin, { __esModule: true, default: plugin, vibelang: plugin })
 const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
 vm.runInNewContext(code, { exports, require(name) {
  if (name === "vibelang-vite") return pluginModule
  if (name === "vite") return { defineConfig: value => value }
  assert.ok(name.startsWith(".") && existsSync(resolve(dirname(file), name)), "the fixture's imported helper must exist")
  return { leaf: 1 }
 } }, { timeout: 1000 })
 return exports.default?.define?.NATIVE_CONFIG_SENTINEL ?? null
}
async function run(text) {
 const calls = []
 const vite = {
  async resolveConfig(options, command) {
   assert.equal(command, "serve")
   assert.equal(resolve(options.root), resolve(join(root, dir)))
   assert.equal(options.logLevel, "error")
   calls.push({ options, command })
   if (options.configFile === false) return { marker: null }
   const file = typeof options.configFile === "string" ? resolve(options.root, options.configFile) :
    ["vite.config.ts", "vite.config.mts", "vite.config.js"].map(name => join(options.root, name)).find(existsSync)
   const available = Boolean(file && existsSync(file))
   const native = Boolean(file && file.endsWith(".vibe"))
   const commandText = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).scripts.warm
   const loader = !native || options.configLoader === "native" && /--import(?:=|\s+)vibelang\/register/.test(commandText)
   return { marker: available && loader ? evaluateConfig(file) : null }
  },
  optimizeDeps(value) { return value }
 }
 const exports = {}
 const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
 vm.runInNewContext(code, { exports, require(name) { assert.equal(name, "vite"); return vite } }, { timeout: 1000 })
 const value = await exports.warm(join(root, dir))
 return { value, calls }
}
try {
 const before = key === "script-only" ? null : await run(source)
 const apps = wireViteApps({ root, packages: [{ dir, sources: ["src"], tsconfig: "tsconfig.json" }], ts,
  specsFor: () => ({ vibelang: "0.0.11", "vibelang-vite": "0.0.11" }) })
 const setupConfig = readFileSync(join(root, cfg), "utf8")
 const nativeConfigs = key === "retained-config" ? [] : apps.nativeConfigs
 const plan = planScope(root, [cfg, leaf], { nativeConfigs })
 const selected = plan.batches.flatMap(batch => batch.files).includes(cfg)
 let deferral = null
 if (selected) {
  const catalog = [cfg, leaf, caller, dir + "/package.json", "package.json"]
  try {
   const state = prepareState(root, [cfg], [cfg, leaf, caller], { ts, aliases: pathAliases(ts, root), referenceFiles: [cfg, leaf, caller], references: catalog, pathSources: [caller], tracked: catalog, catalog })
   applyState(root, state)
  } catch (error) {
   const named = String(error.message).includes("vite.config") && /loader|config|discover/i.test(error.message)
   if (!named) throw error
   assert.equal(readFileSync(join(root, cfg), "utf8"), setupConfig)
   assert.equal(readFileSync(join(root, caller), "utf8"), source)
   deferral = error.message
  }
 } else {
  assert.ok(plan.deferred.some(row => row.file === cfg && /loader/.test(row.reason)))
  assert.equal(readFileSync(join(root, cfg), "utf8"), setupConfig)
  assert.equal(readFileSync(join(root, caller), "utf8"), source)
  deferral = "native config has no supported loader receipt"
 }
 assert.equal(readFileSync(join(root, leaf), "utf8"), fixture.leaf, "the unselected helper stays unchanged")
 const afterSource = readFileSync(join(root, caller), "utf8")
 const after = key === "script-only" ? null : await run(afterSource)
 const script = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).scripts.dev
 if (key === "foreign-shadow") assert.equal(afterSource, source, "a local namesake is not a Vite API caller")
 const ok = key === "script-only" ? /--configLoader native/.test(script) && /--config vite\.config\.vibe/.test(script) && evaluateConfig(join(root, cfg.replace(/\.ts$/, ".vibe"))) === sentinel :
  before.value.marker === after.value.marker
 console.log(JSON.stringify({ key, mode, ok, selected, deferral, before: before?.value, after: after?.value, options: after?.calls.map(row => row.options), script }))
} finally { rmSync(root, { recursive: true, force: true }) }
