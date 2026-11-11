import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { build, optimizeDeps, resolveConfig } from "vite"
import { devServer } from "./dev-server.mjs"
import vibelang from "../src/index.js"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const corpus = JSON.parse(await readFile(new URL("./corpus/foldkit-typed-jsx-snippet.json", import.meta.url), "utf8"))
const quote = "Renaming `x.tsx` to `x.vibex` changes nothing in its JSX;"
const jsxTypes = `export {}\ndeclare global { namespace JSX { interface IntrinsicElements { div: { children?: unknown } } type Element = { tag: string; children: unknown[] } } }\n`

async function fixture(t, extension, jsx = "preserve", jsxImportSource) {
  const base = join(repo, "packages/vite/test/.fixtures")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "vibex-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "node_modules"))
  for (const name of ["compiler", "runtime"]) await symlink(join(repo, "packages", name), join(root, "node_modules", name === "compiler" ? "vibelang" : "vibelang-runtime"))
  await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
  await writeFile(join(root, "package.json"), '{"type":"module"}')
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], jsx, ...(jsxImportSource ? { jsxImportSource } : { jsxFactory: "h" }), rootDir: ".", outDir: "dist", rewriteRelativeImportExtensions: true },
    vibe: { effectGlobals: false, effectModules: false },
    include: ["**/*.vibex", "**/*.tsx", "**/*.d.ts"]
  }))
  await writeFile(join(root, "jsx.d.ts"), jsxTypes)
  await writeFile(join(root, "view." + extension), `function h(tag: string, props: unknown, ...children: unknown[]): JSX.Element { return { tag, children } }\n` + corpus.source)
  return root
}

test("VIP-39 Vite oracle quotes the native JSX rename contract", async () => {
  assert.ok((await readFile(join(repo, "docs/design/vips/0039-vibex.md"), "utf8")).includes(quote))
})

for (const jsx of ["preserve", "react-native", "react"]) {
  test(`Vite builds the typed JSX snippet as both TSX and vibex under ${jsx}`, async t => {
    for (const extension of ["tsx", "vibex"]) {
      const root = await fixture(t, extension, jsx)
      const result = await build({
        root, configFile: false, logLevel: "silent",
        plugins: [vibelang()],
        oxc: { jsx: { runtime: "classic", pragma: "h" } },
        build: { write: false, minify: false, lib: { entry: join(root, "view." + extension), formats: ["es"] } }
      })
      const code = [result].flat()[0].output.find(output => output.type === "chunk").code
      const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
      assert.deepEqual(module.View(corpus.result), { tag: "div", children: [corpus.result] })
    }
  })
}

// rule-evidence: docs/design/vips/0040-module-declarations.md#f7120f477684687d
const bodyRule = "**Loaders and bundlers.** `vibelang/register`, the Bun plugin, Vite and unplugin serve each body's canonical filename from the compiled parent, using the same source basename, encoded name and output suffix as the compiler, cached by the parent's version."

// A body in a .vibex file is TSX (VIP-40): under preserved JSX it compiles to
// names.vibex.-54-ext.jsx, otherwise to names.vibex.-54-ext.js.
for (const jsx of ["preserve", "react"]) {
  test(`Vite builds a .vibex module's module declarations, JSX included, under ${jsx} (VIP-40)`, async t => {
    assert.ok(bodyRule.includes("Vite"))
    const root = await fixture(t, "vibex", jsx)
    await writeFile(join(root, "names.vibex"), [
      "module Text {",
      "  function h(tag: string, props: unknown, ...children: unknown[]): JSX.Element { return { tag, children } }",
      "  export const view = <div>{\"from a body\"}</div>",
      "}",
      "module Über { export const n = 1 }",
      "import { view } from Text",
      "import { n } from Über",
      "export const all: unknown[] = [view, n]",
      ""
    ].join("\n"))
    const requested = new Set()
    const result = await build({
      root, configFile: false, logLevel: "silent",
      plugins: [vibelang(), { name: "requested", transform(code, id) { if (/names\.vibex\.[^./]+\.jsx?$/.test(id)) requested.add(id.split("/").at(-1)) } }],
      oxc: { jsx: { runtime: "classic", pragma: "h" } },
      build: { write: false, minify: false, lib: { entry: join(root, "names.vibex"), formats: ["es"] } }
    })
    const code = [result].flat()[0].output.find(output => output.type === "chunk").code
    const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
    assert.deepEqual(module.all, [{ tag: "div", children: ["from a body"] }, 1])
    const suffix = jsx === "preserve" ? "jsx" : "js"
    assert.deepEqual([...requested].sort(), [`names.vibex.-54-ext.${suffix}`, `names.vibex.-dc-ber.${suffix}`])
  })
}

async function automaticRuntime(root, name) {
  const runtime = join(root, "node_modules", name)
  await mkdir(runtime)
  await writeFile(join(runtime, "package.json"), `{"name":"${name}","type":"module","exports":{"./jsx-runtime":{"types":"./jsx-runtime.d.ts","default":"./jsx-runtime.js"}}}`)
  await writeFile(join(runtime, "jsx-runtime.js"), 'export const jsx = (tag, { children }) => ({ tag, children: [children] })\nexport const jsxs = jsx\n')
  await writeFile(join(runtime, "jsx-runtime.d.ts"), 'export namespace JSX { interface IntrinsicElements { div: { children?: unknown } } type Element = { tag: string; children: unknown[] } }\nexport function jsx(tag: unknown, props: unknown): JSX.Element\nexport function jsxs(tag: unknown, props: unknown): JSX.Element\n')
}

for (const [source, keepsJsx] of [["react", true], ["fixture-jsx", false]]) {
  test(`under react-jsx with ${source}, a plugin after vibelang ${keepsJsx ? "reads a .vibex module's JSX, as a .tsx module's" : "reads lowered output, since Vite lowers only to React"} (t3code Web)`, async t => {
    const root = await fixture(t, "vibex", "react-jsx", source)
    await automaticRuntime(root, source)
    let seen
    const result = await build({
      root, configFile: false, logLevel: "silent",
      plugins: [vibelang(), { name: "after", enforce: "pre", transform(code, id) { if (id.includes("view.vibex")) seen ??= code } }],
      build: { write: false, minify: false, lib: { entry: join(root, "view.vibex"), formats: ["es"] } }
    })
    assert.equal(/<div/.test(seen), keepsJsx)
    const code = [result].flat()[0].output.find(output => output.type === "chunk").code
    const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
    assert.deepEqual(module.View(corpus.result), { tag: "div", children: [corpus.result] })
  })
}

test("Vite resolves generated JSX module IDs without changing resource queries", async t => {
  const root = await fixture(t, "vibex")
  const plugin = vibelang()
  plugin.configResolved({ root, logger: console })
  const context = { resolve: async id => ({ id }) }
  const source = join(root, "view.vibex")
  const importer = join(root, "main.ts")
  await fc.assert(fc.asyncProperty(fc.constantFrom("", "?import", "?v=1", "?t=42"),
    fc.constantFrom(source, "/view.vibex", "/view.vibex.jsx", "./view.vibex", "./view", "./view.jsx", "./view.js"),
    fc.constantFrom(importer, join(root, "main.vibe"), join(root, "main.vibex.jsx")),
    async (query, specifier, from) => {
    const result = await plugin.resolveId.call(context, specifier + query, from)
    assert.equal(typeof result === "object" ? result.id : result, source + ".jsx" + query)
  }), { numRuns: 100, seed: 18139 })
  for (const query of ["?raw", "?url", "?highlighted"]) {
    const result = await plugin.resolveId.call(context, source + query, importer)
    assert.equal(result?.id, source + query, "resource queries keep the original source ID")
  }
})

// A generated module body in a native JSX source: under `preserve` the compiler
// writes its output with a .jsx extension, which only the project's compile holds.
async function moduleBodyFixture(t, jsx, name) {
  const root = await fixture(t, "vibex", jsx)
  await writeFile(join(root, "view.vibex"), `function h(tag: string, props: unknown, ...children: unknown[]): JSX.Element { return { tag, children } }
module ${name} {
export function raise(value: unknown): never { throw value }
}
import { raise as $raise } from ${name}
export function View({ fail }: { fail: boolean }) {
  if (fail) $raise("fixture")
  return <div>ready</div>
}
`)
  return root
}

for (const jsx of ["preserve", "react-native", "react"]) {
  for (const name of ["$throw$ts", "body"]) {
    test(`Vite resolves a .vibex module body ${name} under ${jsx}`, async t => {
      const root = await moduleBodyFixture(t, jsx, name)
      const options = { root, configFile: false, logLevel: "silent", plugins: [vibelang()], oxc: { jsx: { runtime: "classic", pragma: "h" } } }
      const result = await build({ ...options, build: { write: false, minify: false, lib: { entry: join(root, "view.vibex"), formats: ["es"] } } })
      const code = [result].flat()[0].output.find(output => output.type === "chunk").code
      const built = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
      assert.deepEqual(built.View({ fail: false }), { tag: "div", children: ["ready"] })
      assert.throws(() => built.View({ fail: true }), value => value === "fixture")
      const server = await devServer({ ...options, server: { watch: null } })
      t.after(() => server.close())
      const module = await server.ssrLoadModule("/view.vibex")
      assert.deepEqual(module.View({ fail: false }), { tag: "div", children: ["ready"] })
      assert.throws(() => module.View({ fail: true }), value => value === "fixture")
    })
  }
}

test("Vite serves a .vibex module output only for a module query and only beside its source", async t => {
  const root = await moduleBodyFixture(t, "preserve", "$throw$ts")
  const plugin = vibelang()
  plugin.configResolved({ root, logger: console })
  const context = { resolve: async id => ({ id }) }
  const importer = join(root, "view.vibex.jsx")
  await fc.assert(fc.asyncProperty(fc.constantFrom("", "?import", "?v=1", "?t=42", "?raw", "?url"), fc.constantFrom(".js", ".jsx"),
    async (query, extension) => {
      const output = "view.vibex.-24-throw-24-ts" + extension
      assert.equal(await plugin.resolveId.call(context, "./" + output + query, importer), join(root, output) + query)
      assert.equal(await plugin.resolveId.call(context, "./absent.vibex.-24-throw-24-ts" + extension + query, importer), undefined)
      await writeFile(join(root, "real.vibex." + "text" + extension), "export const real = 1\n")
      assert.equal(await plugin.resolveId.call(context, "./real.vibex.text" + extension + query, importer), undefined)
      if (query === "?raw" || query === "?url") assert.equal(await plugin.load.call({ addWatchFile() {}, error(error) { throw error } }, join(root, output) + query), undefined)
  }), { numRuns: 40, seed: 18140 })
})

// drive-t3code-apps 21:51Z (Web58 on SDK 616): the dependency scan runs no
// plugin load, so its own filter must admit a .vibex module body's .jsx output,
// or the scanner reads the absent file and fails before any test starts.
for (const name of ["constants", "$throw$ts"]) {
  test(`Vite's dependency scan loads a .vibex module body ${name} output`, async t => {
    const root = await moduleBodyFixture(t, "preserve", name)
    // The scan compiles JSX for React's automatic runtime, which it must resolve.
    await mkdir(join(root, "node_modules/react"))
    await writeFile(join(root, "node_modules/react/package.json"), '{"name":"react","version":"19.0.0","exports":{"./jsx-dev-runtime":"./jsx.js","./jsx-runtime":"./jsx.js"}}')
    await writeFile(join(root, "node_modules/react/jsx.js"), "export const jsxDEV = () => null, jsx = jsxDEV, jsxs = jsxDEV, Fragment = null\n")
    const config = await resolveConfig({ root, configFile: false, logLevel: "silent", plugins: [vibelang()],
      cacheDir: join(root, ".vite"), optimizeDeps: { entries: ["view.vibex"] } }, "serve")
    const metadata = await optimizeDeps(config, true, true)
    assert.ok(Object.keys(metadata.optimized).some(id => /^react\/jsx(?:-dev)?-runtime$/.test(id)), JSON.stringify(Object.keys(metadata.optimized)))
  })
}

test("both dependency scan engines admit every module output and keep its loader", async t => {
  const root = await moduleBodyFixture(t, "preserve", "$throw$ts")
  const plugin = vibelang()
  plugin.configResolved({ root, logger: console })
  const rolldown = plugin.config.call({ meta: { rolldownVersion: "1.0.0" } }, { root }).optimizeDeps.rolldownOptions.plugins[0].load
  let esbuild
  plugin.config.call({ meta: {} }, { root }).optimizeDeps.esbuildOptions.plugins[0].setup({ onLoad: (options, load) => { esbuild = { ...options, load } } })
  for (const file of ["view.vibex", "view.vibex.jsx", "view.vibex.-24-throw-24-ts.jsx", "view.vibex.-24-throw-24-ts.js", "view.vibe", "view.vibe.text.js"]) {
    assert.ok(rolldown.filter.id.test(join(root, file)), "rolldown " + file)
    assert.ok(esbuild.filter.test(join(root, file)), "esbuild " + file)
  }
  const output = join(root, "view.vibex.-24-throw-24-ts.jsx")
  const loaded = await rolldown.handler(output)
  assert.equal(loaded.moduleType, "jsx")
  assert.match(loaded.code, /throw value/)
  assert.equal((await esbuild.load({ path: output })).loader, "jsx")
  assert.equal(await rolldown.handler(join(root, "absent.vibex.-24-throw-24-ts.jsx")), undefined)
})

test("Vite development loads native JSX and maps it to its authored source", async t => {
  const root = await fixture(t, "vibex")
  const server = await devServer({
    root, configFile: false, logLevel: "silent",
    plugins: [vibelang()],
    oxc: { jsx: { runtime: "classic", pragma: "h" } },
    server: { watch: null },
  })
  t.after(() => server.close())
  const module = await server.ssrLoadModule("/view.vibex")
  assert.deepEqual(module.View(9), { tag: "div", children: [9] })
  const transformed = await server.transformRequest("/view.vibex.jsx")
  assert.ok(transformed.map.sources.some(source => source.endsWith("view.vibex")))
  assert.ok(transformed.map.sourcesContent.some(source => source.includes("n: number")))
})

test("Vite reports native JSX type errors at the original source", async t => {
  const root = await fixture(t, "vibex")
  const source = join(root, "view.vibex")
  await writeFile(source, await readFile(source, "utf8") + '\nexport const bad: number = "bad"\n')
  await assert.rejects(build({
    root, configFile: false, logLevel: "silent",
    plugins: [vibelang()],
    build: { write: false, lib: { entry: source, formats: ["es"] } }
  }), error => /TS2322/.test(error.message) && /view\.vibex/.test(error.message))
})
