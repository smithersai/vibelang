import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vibelang from "../src/index.js"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-vite-paths-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

// drive-t3code-apps 22:10Z: apps/web's `~/…` imports, `"~/*": ["./src/*"]`,
// resolved from its .ts modules under `resolve: { tsconfigPaths: true }` but
// not from a .vibe module, so its browser tests could not load
// previewWebviewConfigState and openPreviewSession.
test("a .vibe module's tsconfig path alias resolves to the file vibelang compiles it against", (t) => {
  const root = project(t, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"], "#lib": ["./lib/index.ts"] } } }),
    "src/main.vibe": "import { value } from \"~/value\"\nexport const result = value\n",
    "src/value.ts": "export const value = 1\n",
    "src/ui/state.vibe": "export const state = 1\n",
    "src/dir/index.vibe": "export const dir = 1\n",
    "lib/index.ts": "export const lib = 1\n",
    "src/plain.ts": "import { value } from \"~/value\"\n",
  })
  const plugin = vibelang()
  const main = join(root, "src/main.vibe")
  assert.equal(plugin.resolveId("~/value", main), join(root, "src/value.ts"))
  assert.equal(plugin.resolveId("~/ui/state", main), join(root, "src/ui/state.vibe"))
  assert.equal(plugin.resolveId("~/dir", main), join(root, "src/dir/index.vibe"))
  assert.equal(plugin.resolveId("#lib", main), join(root, "lib/index.ts"))
  assert.equal(plugin.resolveId("~/value?raw", main), join(root, "src/value.ts") + "?raw")
  // Unmatched and package specifiers, and a .ts importer, stay with Vite.
  assert.equal(plugin.resolveId("~/missing", main), undefined)
  assert.equal(plugin.resolveId("effect", main), undefined)
  assert.equal(plugin.resolveId("~/value", join(root, "src/plain.ts")), undefined)
})

test("the plugin's copy of paths-imports is the compiler's", () => {
  const vendored = readFileSync(join(packageRoot, "src/paths-imports.js"), "utf8")
  const compiler = readFileSync(join(packageRoot, "../compiler/paths-imports.mjs"), "utf8")
  assert.equal(vendored, compiler.replace("./relative-imports.mjs", "./relative-imports.js"))
})

test("a referenced tsconfig's paths aliases resolve for modules compiled by it", async (t) => {
  const { build } = await import("vite")
  const compiler = join(packageRoot, "../compiler/bin/vibelang")
  const compilerOptions = {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
    types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  }
  const root = project(t, {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
    "tsconfig.app.json": JSON.stringify({ compilerOptions: { ...compilerOptions, paths: { "@/*": ["./src/*"] } }, include: ["src"] }),
    "src/b.vibe": "export const b: number = 42\n",
    "src/a.vibe": "import { b } from \"@/b\"\nexport const a: number = b\n",
  })
  const [{ output }] = [await build({
    root, configFile: false, logLevel: "silent",
    plugins: [vibelang({ compiler })],
    build: { write: false, minify: false, lib: { entry: join(root, "src/a.vibe"), formats: ["es"], fileName: "out" } }
  })].flat()
  assert.match(output[0].code, /a = 42/)
})

test("editing paths in a tsconfig takes effect under a running dev server without restart", async (t) => {
  const { devServer } = await import("./dev-server.mjs")
  const compiler = join(packageRoot, "../compiler/bin/vibelang")
  const compilerOptions = {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
    types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  }
  const root = project(t, {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...compilerOptions, paths: { "@/*": ["./src/*"] } }, include: ["src", "extra"] }),
    "src/b.vibe": "export const b: number = 1\n",
    "extra/c.vibe": "export const c: number = 2\n",
    "src/a.vibe": "import { b } from \"@/b\"\nexport const total: number = b\n",
  })
  const plugin = vibelang({ compiler })
  const server = await devServer({
    root, configFile: false, logLevel: "silent",
    plugins: [plugin],
    server: { middlewareMode: true, watch: null },
    appType: "custom"
  })
  t.after(() => server.close())
  const entry = join(root, "src/a.vibe")
  assert.equal((await server.ssrLoadModule(entry)).total, 1)

  const tsconfig = join(root, "tsconfig.json")
  writeFileSync(tsconfig, JSON.stringify({
    compilerOptions: { ...compilerOptions, paths: { "@/*": ["./src/*"], "#extra/*": ["./extra/*"] } },
    include: ["src", "extra"]
  }))
  writeFileSync(entry, "import { b } from \"@/b\"\nimport { c } from \"#extra/c\"\nexport const total: number = b + c\n")
  plugin.watchChange(tsconfig)
  server.moduleGraph.invalidateAll()
  assert.equal((await server.ssrLoadModule(entry)).total, 3)
})

test("vibelang({ project }) resolves paths aliases from the configured project instead of tsconfig.json", async (t) => {
  const { build } = await import("vite")
  const compiler = join(packageRoot, "../compiler/bin/vibelang")
  const compilerOptions = {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
    types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  }
  const root = project(t, {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions, include: ["src"] }),
    "tsconfig.test.json": JSON.stringify({ compilerOptions: { ...compilerOptions, paths: { "@test/*": ["./fixtures/*"] } }, include: ["src", "fixtures"] }),
    "fixtures/helper.vibe": "export const value: number = 99\n",
    "src/spec.vibe": "import { value } from \"@test/helper\"\nexport const got: number = value\n",
  })
  const [{ output }] = [await build({
    root, configFile: false, logLevel: "silent",
    plugins: [vibelang({ project: "tsconfig.test.json", compiler })],
    build: { write: false, minify: false, lib: { entry: join(root, "src/spec.vibe"), formats: ["es"], fileName: "out" } }
  })].flat()
  assert.match(output[0].code, /got = 99/)
})

test("hotUpdate clears cached nearest-config and paths lookups on JSON edits", async (t) => {
  const compiler = join(packageRoot, "../compiler/bin/vibelang")
  const root = project(t, {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./root/*"] } } }),
    "root/val.ts": "export const v = 1\n",
    "nested/local/val.ts": "export const v = 2\n",
    "nested/entry.vibe": "import { v } from \"@/val\"\nexport const out = v\n",
  })
  const plugin = vibelang({ compiler })
  const entry = join(root, "nested/entry.vibe")
  assert.equal(plugin.resolveId("@/val", entry), join(root, "root/val.ts"))

  const nestedConfig = join(root, "nested/tsconfig.json")
  writeFileSync(nestedConfig, JSON.stringify({ compilerOptions: { paths: { "@/*": ["./local/*"] } } }))
  plugin.configResolved({ root, command: "serve", base: "/", logger: { warn() {}, error() {} } })
  const graph = { idToModuleMap: new Map(), invalidateModule() {} }
  await plugin.hotUpdate({
    file: nestedConfig,
    type: "create",
    modules: [],
    server: { moduleGraph: graph, ws: { send() {} }, config: { logger: { error() {} } } }
  })
  t.after(() => plugin.closeWatcher())
  assert.equal(plugin.resolveId("@/val", entry), join(root, "nested/local/val.ts"))
})

test("shared relative-imports and relative-output helpers stay in sync across compiler, vite and unplugin", () => {
  const compilerRel = readFileSync(join(packageRoot, "../compiler/relative-imports.mjs"), "utf8")
  const viteRel = readFileSync(join(packageRoot, "src/relative-imports.js"), "utf8")
  const unpluginRel = readFileSync(join(packageRoot, "../unplugin/src/relative-imports.js"), "utf8")
  assert.equal(viteRel, compilerRel)
  assert.ok(unpluginRel.includes('".vibex"'), "unplugin relative-imports must include .vibex")
  assert.ok(unpluginRel.includes("export function extensionlessImport(directory, specifier, fileExists)"), "unplugin relative-imports must retain fileExists parameter")
  const viteOut = readFileSync(join(packageRoot, "src/relative-output.js"), "utf8")
  const unpluginOut = readFileSync(join(packageRoot, "../unplugin/src/relative-output.js"), "utf8")
  assert.equal(viteOut, unpluginOut)
})

test("Vite build watch mode registers type-only project inputs as watch files", async (t) => {
  const compiler = join(packageRoot, "../compiler/bin/vibelang")
  const compilerOptions = {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
    types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  }
  const root = project(t, {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions, include: ["src"] }),
    "src/types.ts": "export interface Answer { readonly n: number }\n",
    "src/main.vibe": "import type { Answer } from \"./types.ts\"\nexport const a: Answer = { n: 42 }\n",
  })
  const plugin = vibelang({ compiler })
  plugin.configResolved({ root, command: "build", base: "/", logger: { warn() {}, error() {} } })
  t.after(() => plugin.closeWatcher())
  const watched = new Set()
  const entry = join(root, "src/main.vibe")
  await plugin.load.call({
    meta: { watchMode: true },
    addWatchFile(file) { watched.add(file) },
    error(message) { throw new Error(typeof message === "string" ? message : message.message) }
  }, entry)
  assert.ok(watched.has(join(root, "src/types.ts")), `expected src/types.ts in watched files: ${[...watched].join(", ")}`)
})

test("Vite close() does not reject or poison later builds after a failed backend load", async (t) => {
  const { cpSync, symlinkSync } = await import("node:fs")
  const { pathToFileURL } = await import("node:url")
  const root = project(t, {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true, types: [] }, include: ["src"] }),
    "src/main.vibe": "export const n = 1\n",
  })
  const isolatedPluginDir = join(root, "isolated-vite-plugin")
  cpSync(join(packageRoot, "src"), join(isolatedPluginDir, "src"), { recursive: true })
  writeFileSync(join(isolatedPluginDir, "package.json"), JSON.stringify({ type: "module" }))
  mkdirSync(join(isolatedPluginDir, "node_modules"), { recursive: true })
  symlinkSync(join(packageRoot, "node_modules/magic-string"), join(isolatedPluginDir, "node_modules/magic-string"))
  symlinkSync(join(packageRoot, "node_modules/@jridgewell"), join(isolatedPluginDir, "node_modules/@jridgewell"))
  const { default: isolatedVibelang } = await import(pathToFileURL(join(isolatedPluginDir, "src/index.js")).href)
  const plugin = isolatedVibelang({ compiler: join(packageRoot, "../compiler/bin/vibelang") })
  plugin.configResolved({ root, command: "build", base: "/", logger: { warn() {}, error() {} } })
  const entry = join(root, "src/main.vibe")
  const ctx = {
    meta: { watchMode: false },
    addWatchFile() {},
    error(message) { throw new Error(typeof message === "string" ? message : message.message) }
  }
  await assert.rejects(plugin.load.call(ctx, entry), /vibelang-vite needs the vibelang package/)
  await assert.doesNotReject(plugin.closeBundle(), "close() must not reject after a failed backend load")
  // Once vibelang is installed, the same plugin instance must recover and compile cleanly.
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(join(packageRoot, "../compiler"), join(root, "node_modules/vibelang"))
  t.after(() => plugin.closeWatcher())
  const loaded = await plugin.load.call(ctx, entry)
  assert.match(loaded.code, /export const n = 1/)
})
