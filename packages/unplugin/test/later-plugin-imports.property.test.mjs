import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { rspack } from "@rspack/core"
import { build as esbuild } from "esbuild"
import fc from "fast-check"
import { rolldown } from "rolldown"
import { rollup } from "rollup"
import { createUnplugin } from "unplugin"
import { build as viteBuild } from "vite"
import webpack from "webpack"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import vibelangVite from "../../vite/src/index.js"
import vibelangEsbuild from "../src/esbuild.js"
import vibelangRolldown from "../src/rolldown.js"
import vibelangRollup from "../src/rollup.js"
import vibelangRspack from "../src/rspack.js"
import vibelangUnpluginVite from "../src/vite.js"
import vibelangWebpack from "../src/webpack.js"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-later-plugin-core-import.json", import.meta.url)))
const regressions = new URL("./property-regressions/", import.meta.url)
const quotes = [
  ["../vips/0034-compiler-and-tooling.md", "**Existing tools work.** Type checkers work through `.d.vibe.ts` (VIP-27), and linters, Knip, bundlers and test runners each read `.vibe`."],
  ["007-tooling.md", "Output names follow the native twin"],
  ["007-tooling.md", "Bundler plugins use the same names"]
]
const rule = quotes[0][1]
const bundlers = ["rollup", "rolldown", "vite", "vibelang-vite", "esbuild", "webpack", "rspack"]

test("later-plugin import coverage quotes the tooling contract", () => {
  for (const [chapter, quote] of quotes) assert.ok(readFileSync(SpecPath(chapter), "utf8").includes(quote), chapter + ": " + quote)
})

// A plugin placed after VibeLang's. It records the relative imports the entry
// writes and, when asked, serves or externalizes the native module.
function laterPlugin(file, later, seen) {
  return createUnplugin(() => ({
    name: "later-plugin",
    resolveId(source, importer) {
      if (!importer || !/^(?:twin\.ts|entry\.vibe)$/.test(basename(importer.split("?")[0])) || !source.startsWith(".")) return
      seen.push(source)
      if (later === "observe" || !source.endsWith("/" + file)) return
      return later === "external" ? { id: "external:native", external: true } : "virtual:native"
    },
    loadInclude: id => id === "virtual:native",
    load: id => id === "virtual:native" ? "export const value = 41\n" : undefined
  }))
}

// Bun.build runs only under Bun, so a Bun child builds the bundle with the
// same later plugin and reports what it saw. Bun plugins cannot hand a
// resolution on, so Bun's later plugins still see the emitted name: the
// saved regressions replay that gap and fail once it closes.
const bunBuild = `
const [plugin, root, compiler, entry, file, later] = JSON.parse(process.env.LATER_PLUGIN_ARGS)
const { default: vibelang } = await import(plugin)
const seen = []
const laterPlugin = { name: "later-plugin", setup(build) {
  build.onResolve({ filter: /^\\./ }, args => {
    if (!/(?:^|\\/)(?:twin\\.ts|entry\\.vibe)$/.test(args.importer)) return
    seen.push(args.path)
    if (later === "observe" || !args.path.endsWith("/" + file)) return
    return later === "external" ? { path: "external:native", external: true } : { path: "virtual:native", namespace: "later-plugin" }
  })
  build.onLoad({ filter: /.*/, namespace: "later-plugin" }, () => ({ contents: "export const value = 41\\n", loader: "js" }))
} }
const result = await Bun.build({ entrypoints: [entry], target: "node", format: "esm", plugins: [vibelang({ root, compiler }), laterPlugin] })
if (!result.success) { console.error(result.logs.map(String).join("\\n")); process.exit(1) }
console.log(JSON.stringify({ seen, code: await result.outputs[0].text() }))
`

let builds = 0
async function bundle(shape, root, entry, seen) {
  const { bundler } = shape, file = shape.name + shape.extension
  const options = { root, compiler }
  if (bundler === "bun") {
    const script = join(root, "bun-build.mjs")
    writeFileSync(script, bunBuild)
    const args = [pathToFileURL(join(repo, "packages/unplugin/src/bun.js")).href, root, compiler, entry, file, shape.later]
    const run = spawnSync("bun", [script], { cwd: root, encoding: "utf8", env: { ...process.env, LATER_PLUGIN_ARGS: JSON.stringify(args) } })
    if (run.status !== 0) throw new Error("bun build failed: " + run.stderr + run.stdout)
    const result = JSON.parse(run.stdout.trim().split("\n").at(-1))
    seen.push(...result.seen)
    return result.code
  }
  const later = laterPlugin(file, shape.later, seen)
  if (bundler === "rollup" || bundler === "rolldown") {
    const create = bundler === "rollup" ? rollup : rolldown
    const plugins = bundler === "rollup" ? [vibelangRollup(options), later.rollup()] : [vibelangRolldown(options), later.rolldown()]
    const build = await create({ input: entry, plugins, ...(bundler === "rolldown" ? { cwd: root } : { onwarn() {} }) })
    try { return (await build.generate({ format: "es" })).output[0].code }
    finally { await build.close() }
  }
  if (bundler === "vite" || bundler === "vibelang-vite") {
    const plugin = bundler === "vite" ? vibelangUnpluginVite(options) : vibelangVite(options)
    // Vite resolves relative imports itself; only an early plugin sees them.
    const result = await viteBuild({
      root, configFile: false, logLevel: "silent", plugins: [plugin, { ...later.vite(), enforce: "pre" }],
      build: { write: false, lib: { entry, formats: ["es"], fileName: "out" }, rolldownOptions: { external: id => id.startsWith("external:") } }
    })
    return (Array.isArray(result) ? result[0] : result).output[0].code
  }
  if (bundler === "esbuild") {
    const result = await esbuild({
      absWorkingDir: root, entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
      plugins: [vibelangEsbuild(options), later.esbuild()]
    })
    return result.outputFiles[0].text
  }
  const out = join(root, "out-" + ++builds)
  const create = bundler === "webpack" ? webpack : rspack
  const plugins = bundler === "webpack" ? [vibelangWebpack(options), later.webpack()] : [vibelangRspack(options), later.rspack()]
  const compilation = create({
    mode: "none", context: root, target: "node", entry, plugins, infrastructureLogging: { level: "error" },
    output: { path: out, filename: "bundle.mjs", module: true, chunkFormat: "module", library: { type: "module" } },
    experiments: { outputModule: true }
  })
  const stats = await new Promise((ok, fail) => compilation.run((error, result) => compilation.close(() => error ? fail(error) : ok(result))))
  if (stats.hasErrors()) throw new Error(stats.toString("errors-only"))
  return readFileSync(join(out, "bundle.mjs"), "utf8")
}

const forms = {
  import: specifier => `import { value } from ${JSON.stringify(specifier)}\nexport const out = value + 1\n`,
  reexport: specifier => `export { value as out } from ${JSON.stringify(specifier)}\n`,
  namespace: specifier => `import * as native from ${JSON.stringify(specifier)}\nexport const out = native.value + 1\n`
}

// What a bundle shows of its native import: the specifiers the later plugin
// saw from the entry, and the entry's value or its external import.
async function observe(shape, root, entry) {
  const seen = []
  const code = await bundle(shape, root, entry, seen)
  if (shape.later === "external") return { seen, external: code.includes("external:native") }
  const output = join(root, "out-" + ++builds + ".mjs")
  writeFileSync(output, code)
  return { seen, out: (await import(pathToFileURL(output).href)).out }
}

// A .vibe module and its .ts twin, written identically, import a native
// TypeScript module. Every plugin after VibeLang's sees the same import and
// the bundles agree, so existing plugins keep working when a module migrates.
async function check(shape) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-later-plugin-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
    symlinkSync(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ESNext", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", strict: true,
        skipLibCheck: true, types: [], noEmit: true, allowImportingTsExtensions: true
      },
      include: ["src"], vibe: { effectGlobals: false, effectModules: false }
    }))
    const file = shape.name + shape.extension
    const entries = join(root, "src", shape.layout === "parent" ? "app" : "")
    const native = join(root, "src", shape.layout === "child" ? "lib" : "", file)
    const specifier = (shape.layout === "parent" ? "../" : shape.layout === "child" ? "./lib/" : "./") + file
    mkdirSync(entries, { recursive: true })
    mkdirSync(dirname(native), { recursive: true })
    writeFileSync(native, "export const value = 1\n")
    for (const entry of ["twin.ts", "entry.vibe"]) writeFileSync(join(entries, entry), forms[shape.form](specifier))
    const twin = await observe(shape, root, join(entries, "twin.ts"))
    const migrated = await observe(shape, root, join(entries, "entry.vibe"))
    assert.deepEqual(twin.seen, [specifier], "the .ts twin shows the later plugin its written import")
    if (shape.later === "virtual") assert.equal(twin.out, shape.form === "reexport" ? 41 : 42, "the later plugin serves the .ts twin's import")
    if (shape.later === "external") assert.equal(twin.external, true, "the later plugin externalizes the .ts twin's import")
    assert.deepEqual(migrated, twin, JSON.stringify(shape))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const bundler of bundlers) {
  test(`${bundler}: a later plugin sees a .vibe module's ./dep.ts import as the .ts twin's`, () =>
    check({ bundler, extension: ".ts", name: "dep", layout: "sibling", form: "import", later: "virtual" }))
}

test("alchemy: a later Rolldown plugin externalizes a .vibe module's core .ts import as it does the original's", () => check(corpus.input))

test("property: later plugins see a .vibe module's TypeScript imports as they see the .ts twin's", async () => {
  await checkProperty(fc, {
    name: "later-plugin-native-imports", rule, command: "node --test test/later-plugin-imports.property.test.mjs",
    arbitrary: fc.record({
      bundler: fc.constantFrom(...bundlers), extension: fc.constantFrom(".ts", ".tsx", ".mts"),
      name: fc.constantFrom("dep", "with space", "créé"), layout: fc.constantFrom("sibling", "child", "parent"),
      form: fc.constantFrom(...Object.keys(forms)), later: fc.constantFrom("virtual", "observe")
    // webpack's built-in TypeScript support rejects .tsx, so even the .ts twin cannot build it.
    }).filter(shape => shape.bundler !== "webpack" || shape.extension !== ".tsx"),
    check, numRuns: 32, regressions
  })
})
