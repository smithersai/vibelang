import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "vite"
import { devServer } from "./dev-server.mjs"
import vibelang from "../src/index.js"

// Smithers' apps/mvp: vibelang({ project: "tsconfig.json" }) over a root
// tsconfig that leaves db/ to worker/tsconfig.json.
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const compiler = join(packageRoot, "../compiler/bin/vibelang")
const options = { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true }

async function fixture(t, files) {
  const base = join(packageRoot, "test/.fixtures")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "sibling-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const old = new Date(Date.now() - 60_000)
  for (const [path, value] of Object.entries({ "package.json": '{"type":"module"}', ...files })) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), typeof value === "string" ? value : JSON.stringify({ compilerOptions: options, ...value }))
    await utimes(join(root, path), old, old)
  }
  return root
}

const bundle = (root, input) => build({
  root, configFile: false, logLevel: "silent",
  plugins: [vibelang({ project: "tsconfig.json", compiler })],
  build: { write: false, minify: false, lib: { entry: join(root, input), formats: ["es"], fileName: "out" } }
})

test("smithers-mvp: a Vite build compiles a module under the sibling tsconfig that includes it", async (t) => {
  const root = await fixture(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": "export const app: string = \"app\"\n",
    "worker/tsconfig.json": { include: [".", "../db"] },
    "db/x.vibe": "export const answer: number = 42\n",
    "entry.ts": "export { answer } from \"./db/x.vibe\"\n"
  })
  const [{ output }] = [await bundle(root, "entry.ts")].flat()
  assert.match(output[0].code, /answer = 42/)
})

test("a Vite build still fails, naming every tsconfig asked, for a module none includes", async (t) => {
  const root = await fixture(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": "export const app: string = \"app\"\n",
    "worker/tsconfig.json": { include: ["."] },
    "worker/main.vibe": "export const main: number = 1\n",
    "db/x.vibe": "export const answer: number = 42\n",
    "entry.ts": "export { answer } from \"./db/x.vibe\"\n"
  })
  await assert.rejects(bundle(root, "entry.ts"), /x\.vibe is not part of .*tsconfig\.json or .*worker\/tsconfig\.json\. Add it to the tsconfig's include\./)
})

// Alchemy's cloudflare-runtime: Vite's root is a directory inside the package
// and the plugin names the package's ../tsconfig.json, which includes core/
// beside that root. Its modules there are the project's own.
test("alchemy-vite-nested-root: a project above Vite's nested root serves its modules outside that root", async (t) => {
  const root = await fixture(t, {
    "tsconfig.json": { include: ["core/*.vibe", "vite/*.vibe"] },
    "core/Leaf.vibe": "export const value: number = 1\n",
    "vite/entry.vibe": "export { value } from \"../core/Leaf.vibe\"\n"
  })
  const plugins = [vibelang({ project: "../tsconfig.json", compiler })]
  const server = await devServer({ root: join(root, "vite"), configFile: false, logLevel: "silent", plugins, server: { middlewareMode: true, watch: null }, appType: "custom" })
  t.after(() => server.close())
  assert.equal((await server.ssrLoadModule(join(root, "core/Leaf.vibe"))).value, 1)
  assert.equal((await server.ssrLoadModule(join(root, "vite/entry.vibe"))).value, 1)
  const [{ output }] = [await build({
    root: join(root, "vite"), configFile: false, logLevel: "silent", plugins,
    build: { write: false, minify: false, lib: { entry: join(root, "vite/entry.vibe"), formats: ["es"], fileName: "out" } }
  })].flat()
  assert.match(output[0].code, /value = 1/)
})
