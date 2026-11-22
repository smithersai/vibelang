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
