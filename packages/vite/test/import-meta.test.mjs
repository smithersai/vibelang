import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { build } from "vite"
import vibelang from "../src/index.js"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const stock = join(dirname(require.resolve("typescript/package.json")), "bin/tsc")

async function fixture(t, types = ["vite/client", "node"]) {
  const base = fileURLToPath(new URL("./.fixtures/", import.meta.url))
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "import-meta-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "node_modules/@types"), { recursive: true })
  await symlink(dirname(require.resolve("@types/node/package.json")), join(root, "node_modules/@types/node"))
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }))
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      strict: true, skipLibCheck: true, types, noEmit: true },
    include: ["main.vibe"]
  }))
  return root
}

function check(root, stockTwin = false) {
  const args = ["-p", join(root, stockTwin ? "tsconfig.stock.json" : "tsconfig.json")]
  const result = spawnSync(stockTwin ? process.execPath : compiler, stockTwin ? [stock, ...args] : args,
    { cwd: root, encoding: "utf8", timeout: 180000 })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return { status: result.status, text: result.stdout + result.stderr }
}

async function twin(root, source) {
  await writeFile(join(root, "main.vibe"), source)
  await writeFile(join(root, "main.ts"), source)
  const config = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8"))
  await writeFile(join(root, "tsconfig.stock.json"), JSON.stringify({ ...config, include: ["main.ts"] }))
}

// Both compilers must use the installed bundler and host declarations, not fixture approximations.
test("import.meta uses Vite and Node declarations with TypeScript's inferred types", async t => {
  const root = await fixture(t)
  await twin(root, `
export const contextualEager: Record<string, string> = import.meta.glob("./*.md", { query: "?raw", import: "default", eager: true })
export const eager = import.meta.glob<string>("./*.md", { query: "?raw", import: "default", eager: true })
export const lazy = import.meta.glob<string>("./*.md", { query: "?raw", import: "default" })
export const untyped = import.meta.glob("./*.md")
export const eagerType: Record<string, string> = eager
export const lazyType: Record<string, () => Promise<string>> = lazy
export const unknownType: Record<string, () => Promise<unknown>> = untyped
export const production: boolean = import.meta.env.PROD
export const mode: string = import.meta.env.MODE
export const hot: { accept(): void } | undefined = import.meta.hot
export const directory: string = import.meta.dirname
export const filename: string = import.meta.filename
export const url: string = import.meta.url
export const alias: ImportMeta = import.meta
export const { env } = import.meta
export const computed: string = import.meta["dirname"]
export const passed = ((meta: ImportMeta): ImportMeta => meta)(import.meta)
export const spread: ImportMeta = { ...import.meta }
`)
  for (const stockTwin of [true, false]) {
    const result = check(root, stockTwin)
    assert.equal(result.status, 0, result.text)
  }
})

test("bad glob, environment and metadata types retain TypeScript diagnostics", async t => {
  const root = await fixture(t)
  await twin(root, `
export const eager: Record<string, number> = import.meta.glob<string>("./*.md", { eager: true })
export const lazy: Record<string, string> = import.meta.glob<string>("./*.md")
export const production: string = import.meta.env.PROD
export const hot: string = import.meta.hot
export const directory: number = import.meta.dirname
export const unknown = import.meta.notDeclaredByAnyHost
export const badUrl = import.meta.url.notAProperty
`)
  const expected = ["TS2322", "TS2322", "TS2322", "TS2322", "TS2322", "TS2339", "TS2339"]
  for (const stockTwin of [true, false]) {
    const result = check(root, stockTwin)
    assert.equal(result.status, 2, result.text)
    assert.deepEqual(result.text.match(/TS\d+/g), expected, result.text)
    assert.doesNotMatch(result.text, /EK4402/)
  }
})

test("glob and Node metadata need their declarations; url and the object remain available", async t => {
  const root = await fixture(t, [])
  await twin(root, `
export const url: string = import.meta.url
export const meta: ImportMeta = import.meta
export const glob = import.meta.glob
export const env = import.meta.env
export const hot = import.meta.hot
export const directory = import.meta.dirname
`)
  for (const stockTwin of [true, false]) {
    const result = check(root, stockTwin)
    assert.equal(result.status, 2, result.text)
    assert.deepEqual(result.text.match(/TS\d+/g), ["TS2339", "TS2339", "TS2339", "TS2339"], result.text)
    assert.doesNotMatch(result.text, /EK4402/)
  }
})

test("Vite builds eager and lazy raw globs from a .vibe entry and preserves their values", async t => {
  const root = await fixture(t)
  await writeFile(join(root, "a.md"), "alpha")
  await writeFile(join(root, "b.md"), "beta")
  await writeFile(join(root, "main.vibe"), `
export const eager = import.meta.glob<string>("./*.md", { query: "?raw", import: "default", eager: true })
export const lazy = import.meta.glob<string>("./*.md", { query: "?raw", import: "default" })
export const production: boolean = import.meta.env.PROD
export const hot = import.meta.hot
export const url: string = import.meta.url
`)
  const result = await build({ root, configFile: false, plugins: [vibelang({ compiler })], logLevel: "silent",
    build: { ssr: join(root, "main.vibe"), outDir: "dist", minify: false,
      rollupOptions: { output: { entryFileNames: "entry.mjs" } } } })
  const output = result.output || result[0].output
  assert.ok(output.some(file => file.type === "chunk"))
  const bundle = await import(pathToFileURL(join(root, "dist/entry.mjs")).href)
  assert.deepEqual(bundle.eager, { "./a.md": "alpha", "./b.md": "beta" })
  assert.deepEqual(Object.keys(bundle.lazy).sort(), ["./a.md", "./b.md"])
  for (const key of Object.keys(bundle.lazy)) assert.equal(await bundle.lazy[key](), bundle.eager[key])
  assert.equal(bundle.production, true)
  assert.equal(bundle.hot, undefined)
  assert.equal(bundle.url, pathToFileURL(join(root, "dist/entry.mjs")).href)
})

// A Vite project's .vibe module and its .ts twin: both type-check (vibelang and stock tsc),
// both build under Vite, and the two bundles export the same glob, env and url values.
test("a .vibe glob module builds and runs like its stock TypeScript twin under Vite", async t => {
  const root = await fixture(t)
  await mkdir(join(root, "pages"), { recursive: true })
  await writeFile(join(root, "pages/intro.md"), "# Intro\n")
  await writeFile(join(root, "pages/usage.md"), "# Usage\n")
  await twin(root, `
const pages = import.meta.glob<string>("./pages/*.md", { query: "?raw", import: "default", eager: true })
const loaders = import.meta.glob<string>("./pages/*.md", { query: "?raw", import: "default" })
export const titles: ReadonlyArray<string> = Object.keys(pages).sort().map(path => pages[path].split("\\n")[0])
export const lazyKeys: ReadonlyArray<string> = Object.keys(loaders).sort()
export const loadAll = (): Promise<ReadonlyArray<string>> => Promise.all(lazyKeys.map(key => loaders[key]()))
export const mode: string = import.meta.env.MODE
export const production: boolean = import.meta.env.PROD
export const file: string = import.meta.url.slice(import.meta.url.lastIndexOf("/") + 1)
`)
  for (const stockTwin of [true, false]) {
    const result = check(root, stockTwin)
    assert.equal(result.status, 0, result.text)
  }
  const bundles = {}
  for (const entry of ["main.vibe", "main.ts"]) {
    const outDir = "dist-" + entry.replace(".", "-")
    await build({ root, configFile: false, plugins: entry === "main.vibe" ? [vibelang({ compiler })] : [], logLevel: "silent",
      build: { ssr: join(root, entry), outDir, minify: false, rollupOptions: { output: { entryFileNames: "entry.mjs" } } } })
    const bundle = await import(pathToFileURL(join(root, outDir, "entry.mjs")).href)
    bundles[entry] = { titles: bundle.titles, lazyKeys: bundle.lazyKeys, loaded: await bundle.loadAll(),
      mode: bundle.mode, production: bundle.production, file: bundle.file }
  }
  assert.deepEqual(bundles["main.vibe"], {
    titles: ["# Intro", "# Usage"], lazyKeys: ["./pages/intro.md", "./pages/usage.md"],
    loaded: ["# Intro\n", "# Usage\n"], mode: "production", production: true, file: "entry.mjs",
  })
  assert.deepEqual(bundles["main.vibe"], bundles["main.ts"])
})
