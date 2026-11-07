import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import vm from "node:vm"

const root = process.cwd(), [key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 31
const data = join(root, "typescript/tsc/internal/vibelangfuzz/testdata")
const fixture = JSON.parse(readFileSync(join(data, "corpus/t3code-jsx-module-companion.json"), "utf8"))
const dependencies = JSON.parse(readFileSync(join(root, "packages/unplugin/package.json"), "utf8")).dependencies
const cache = new Map()
async function sourceModule(file) {
 const url = pathToFileURL(file).href
 if (cache.has(url)) return cache.get(url)
 const module = new vm.SourceTextModule(readFileSync(file, "utf8"), {
  identifier: url, initializeImportMeta(meta) { meta.url = url }
 })
 cache.set(url, module)
 await module.link(async (specifier, parent) => {
  // Only the framework wrapper is isolated. The production factory and its
  // source-discovery helpers execute unchanged; this probe never loads a compiler.
  if (specifier === "unplugin") return new vm.SyntheticModule(["createUnplugin"], function () {
   this.setExport("createUnplugin", factory => ({ raw: (options, meta) => factory(options, meta) }))
  })
  if (!specifier.startsWith(".")) {
   // Load the plugin's declared helpers as installed, from the importing
   // source's package scope. Only the framework wrapper above is replaced.
   assert.ok(specifier.startsWith("node:") || Object.hasOwn(dependencies, specifier),
    "unexpected plugin dependency: " + specifier)
   const resolved = specifier.startsWith("node:") ? specifier
    : pathToFileURL(createRequire(parent.identifier).resolve(specifier)).href
   const namespace = await import(resolved)
   return new vm.SyntheticModule(Object.keys(namespace), function () {
    for (const name of Object.keys(namespace)) this.setExport(name, namespace[name])
   })
  }
  return sourceModule(resolve(dirname(fileURLToPath(parent.identifier)), specifier))
 })
 return module
}
const module = await sourceModule(join(root, "packages/unplugin/src/index.js"))
await module.evaluate()
mkdirSync(join(root, ".cache"), { recursive: true })
const temporary = mkdtempSync(join(root, ".cache/native-companion-"))
try {
 const extension = key === "vibe-js" ? "vibe" : key === "foreign-source" ? "tsx" : "vibex"
 const suffix = key === "vibex-jsx" ? ".jsx" : ".js"
 const name = mode & 1 ? "host" : "$throw$ts"
 const encoded = [...name].map(c => /[a-z0-9_]/.test(c) ? c : "-" + c.codePointAt(0).toString(16) + "-").join("")
 const directory = join(temporary, mode & 2 ? "nested/space δ" : "src")
 mkdirSync(directory, { recursive: true })
 const source = join(directory, (mode & 4 ? "CardΩ" : "view") + "." + extension)
 const output = source + "." + encoded + suffix
 let sourceText = fixture.source.replaceAll("$throw$ts", name)
 if (extension === "vibe") sourceText = sourceText.replace("<div>ready</div>", "null")
 if (extension === "tsx") sourceText = "export const View = () => null;\n"
 if (key !== "missing-owner") writeFileSync(source, mode & 8 ? sourceText.replaceAll("\n", "\r\n") : sourceText)
 if (key === "physical-output") writeFileSync(output, "export const physical = true;\n")
 const query = mode & 16 ? "?import" : ""
 const expected = !["missing-owner", "physical-output", "foreign-source"].includes(key)
 const rows = []
 for (const framework of ["vite", "rollup", "rolldown", "webpack", "rspack", "esbuild"]) {
  const plugin = module.namespace.unplugin.raw({ root: temporary }, { framework })
  const id = output + query
  const included = plugin.loadInclude(id)
  const resolved = plugin.resolveId("./" + output.slice(directory.length + 1) + query, source)
  rows.push({ framework, included, resolved: resolved === id, ok: included === expected && (resolved === id) === expected })
 }
 console.log(JSON.stringify({ ok: rows.every(row => row.ok), key, mode, extension, suffix, expected, rows }))
} finally { rmSync(temporary, { recursive: true, force: true }) }
