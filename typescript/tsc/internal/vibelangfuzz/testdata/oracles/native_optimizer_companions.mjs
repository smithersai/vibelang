import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import vibelang from "../../../../../../packages/vite/src/index.js"

const root = process.cwd(), [key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 31
const fixture = JSON.parse(readFileSync(join(root, "typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-optimizer-jsx-companion.json"), "utf8"))
mkdirSync(join(root, ".cache"), { recursive: true })
const temporary = mkdtempSync(join(root, ".cache/optimizer-companion-"))
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
try {
 const extension = key === "foreign-source" ? ".tsx" : key === "js-companion" && !(mode & 16) ? ".vibe" : ".vibex"
 const directory = join(temporary, mode & 2 ? "nested/space δ" : "src")
 const source = join(directory, (mode & 4 ? "ViewΩ" : "view") + extension)
 const name = mode & 1 ? "$call$ts" : "constants"
 const encoded = [...name].map(c => /[a-z0-9_]/.test(c) ? c : "-" + c.codePointAt(0).toString(16) + "-").join("")
 const suffix = key === "js-companion" ? ".js" : ".jsx"
 const output = source + "." + encoded + suffix
 const id = key === "source-jsx" ? source + ".jsx" : output + (key === "resource-query" ? "?raw" : "")
 let text = fixture.source.replaceAll("constants", name)
 if (extension !== ".vibex") text = "export const value = 1;\n"
 if (key !== "missing-owner") put(source, mode & 8 ? text.replaceAll("\n", "\r\n") : text)
 if (key === "physical-output") put(output, fixture.output)

 // The compiler callback is controlled. The production config hook, both
 // scanner filters and their load dispatch execute unchanged; this is not
 // an actual Vite optimizer run or a native compilation.
 const backendFile = join(temporary, "node_modules/vibelang/project.mjs")
 put(join(temporary, "package.json"), '{"type":"module"}\n')
 put(join(temporary, "node_modules/vibelang/package.json"), JSON.stringify({
  name: "vibelang", type: "module", exports: { "./project": "./project.mjs" }
 }))
 put(backendFile, "export const calls = [];\n" +
  "export const findCompiler = () => 'controlled-compiler';\n" +
  "export const projects = () => ({\n" +
  " async load(file) { calls.push(file); return { code: " + JSON.stringify(fixture.output) + " }; },\n" +
  " async close() {}\n});\n")
 const backend = await import(pathToFileURL(backendFile).href)
 const expected = ["jsx-companion", "js-companion", "source-jsx"].includes(key)
 const rows = []
 for (const engine of ["esbuild", "rolldown"]) {
  const plugin = vibelang()
  plugin.configResolved({ root: temporary, logger: { warn() {} } })
  const config = plugin.config.call({ meta: engine === "rolldown" ? { rolldownVersion: "1" } : {} },
   mode & 16 ? { optimizeDeps: { extensions: [".vibe", ".vibex"] } } : {})
  let filter, load
  if (engine === "rolldown") {
   const hook = config.optimizeDeps.rolldownOptions.plugins[0].load
   filter = hook.filter.id
   load = () => hook.handler(id)
  } else {
   let registrations = 0
   config.optimizeDeps.esbuildOptions.plugins[0].setup({ onLoad(options, handler) {
    registrations++
    filter = options.filter
    load = () => handler({ path: id })
   } })
   assert.equal(registrations, 1)
  }
  const before = backend.calls.length
  const admitted = filter.test(id)
  const result = admitted ? await load() : undefined
  const called = backend.calls.slice(before)
  const actual = result !== undefined
  const ok = actual === expected
  if (expected && actual) {
   const request = key === "source-jsx" ? source : output
   assert.deepEqual(called, [request], "scanner must preserve the exact owning source/output request")
   assert.equal(engine === "rolldown" ? result.code : result.contents, fixture.output)
   assert.equal(engine === "rolldown" ? result.moduleType : result.loader, extension === ".vibe" ? "js" : "jsx")
  } else if (!actual) {
   assert.deepEqual(called, [], "excluded or foreign input must not invoke the compiler")
  }
  rows.push({ engine, admitted, actual, expected, ok })
  await plugin.closeBundle()
 }
 console.log(JSON.stringify({ ok: rows.every(row => row.ok), key, mode, rows }))
} finally { rmSync(temporary, { recursive: true, force: true }) }
