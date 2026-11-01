// plugin-react's React Compiler in a Vite build with vibelang-vite: it sees a
// .vibe module only with .vibe in its include, which the migrate flow's
// setup writes (lib/react-tools.mjs, addReactCompilerInclude).
import { strict as assert } from "node:assert"
import { symlinkSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import react from "@vitejs/plugin-react"
import { compilerPackage, hooks, project } from "./helpers.mjs"

const vibelang = (await import(pathToFileURL(join(compilerPackage, "../vite/src/index.js")))).default

async function bundle(t, options) {
  const root = project(t, { ...hooks, "index.js": 'export { useLabel } from "./src/useLabel.vibe"\n' }, ["react", "@types/react"])
  symlinkSync(join(compilerPackage, "../vite"), join(root, "node_modules/vibelang-vite"))
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
