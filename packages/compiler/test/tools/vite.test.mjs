// plugin-react's React Compiler in a Vite build with vibelang-vite: it sees a
// .vibe module only with .vibe in its include, which the migrate flow's
// setup writes (lib/react-tools.mjs, addReactCompilerInclude).
import { strict as assert } from "node:assert"
import { cpSync, mkdirSync, readFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import react from "@vitejs/plugin-react"
import { compilerPackage, hooks, project, tools } from "./helpers.mjs"

async function fixturePlugin(root) {
  const plugin = join(root, "node_modules/vibelang-vite")
  mkdirSync(plugin)
  cpSync(join(compilerPackage, "../vite/package.json"), join(plugin, "package.json"))
  cpSync(join(compilerPackage, "../vite/src"), join(plugin, "src"), { recursive: true })
  // The private package must resolve its runtime dependencies beside the
  // compiler peer, just as an installed plugin does.
  const { dependencies } = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"))
  for (const name of Object.keys(dependencies)) {
    const target = join(plugin, "node_modules", name)
    mkdirSync(join(target, ".."), { recursive: true })
    symlinkSync(join(tools, name), target)
  }
  return (await import(pathToFileURL(join(plugin, "src/index.js")))).default
}

test("the Vite fixture resolves the compiler peer beside its private plugin", async (t) => {
  const root = project(t, {})
  const plugin = await fixturePlugin(root)
  assert.equal(typeof plugin, "function")
  assert.ok(plugin())
})

async function bundle(t, options) {
  const root = project(t, { ...hooks, "index.js": 'export { useLabel } from "./src/useLabel.vibe"\n' }, ["react", "@types/react"])
  const vibelang = await fixturePlugin(root)
  const result = await build({
    root, configFile: false, logLevel: "silent",
    plugins: [vibelang(), react(options)],
    build: { write: false, minify: false, lib: { entry: join(root, "index.js"), formats: ["es"] }, rollupOptions: { external: [/^react/] } }
  })
  return [result].flat()[0].output[0].code
}

test("plugin-react's default filter leaves a .vibe hook unmemoized", async (t) => {
  assert.doesNotMatch(await bundle(t, { compiler: true }), /react\/compiler-runtime/)
})

test("with .vibe in its include the React Compiler memoizes a .vibe hook", async (t) => {
  const { reactInclude } = await import(join(compilerPackage, "../../.smithers/flows/migrate/lib/react-tools.mjs"))
  const code = await bundle(t, { compiler: true, include: new Function(`return ${reactInclude}`)() })
  assert.match(code, /react\/compiler-runtime/)
  assert.match(code, /function useLabel/)
})
