import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import vibelang from "../src/index.js"
import { runChild } from "./child.mjs"

// Vitest runs tests in Node processes and passes them its server conditions
// as --conditions. It leaves `module` out of its defaults, since a package's
// `module` export is often bundler-only ESM, and the plugin's config hook used
// to add Vite's own defaults back, `module` included, before Vitest's hook ran.
// Smithers' observability, platform and integrations packages then loaded
// @opentelemetry/api's build/esm, whose extensionless imports Node rejects (64
// tests in 5 packages, 2026-11-02).

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const compiler = join(packageRoot, "../compiler/bin/vibelang")
const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs")

// Smithers' failure, minimized: a dependency whose `module` export is
// bundler-only ESM, as @opentelemetry/api's build/esm is, with a CommonJS
// default.
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/smithers-otel-module-condition.json", import.meta.url)))

test("under Vitest, a .vibe module's dependency loads through Node's own conditions, not Vite's module", async (t) => {
  const base = join(packageRoot, "test/.fixtures")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "conditions-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(corpus.files)) {
    await mkdir(dirname(join(root, name)), { recursive: true })
    await writeFile(join(root, name), text)
  }
  await writeFile(join(root, "vitest.config.ts"), `
import { defineConfig } from "vitest/config"
import vibelang from ${JSON.stringify(join(packageRoot, "src/index.js"))}
export default defineConfig({
  plugins: [vibelang({ compiler: ${JSON.stringify(compiler)} })],
  test: { include: ["test/*.test.ts"] }
})
`)
  const { code, output } = await runChild(process.execPath, [vitest, "run", "--no-color"], { cwd: root, env: { ...process.env, NO_COLOR: "1" } })
  assert.equal(code, 0, output)
})

// The neighbourhood: under Vitest, whatever conditions another config hook
// sets, before or after the plugin's, `module` reaches the resolved
// conditions, which Vitest passes to Node, only when that hook set it, and
// vibelang-source is always there. Outside Vitest, Vite's own defaults stand.
test("under Vitest the plugin adds no `module` condition of its own", async (t) => {
  const { resolveConfig } = await import(createRequire(import.meta.url).resolve("vite"))
  const root = join(packageRoot, "test/coverage") // resolving a config reads it and writes nothing
  const saved = process.env.VITEST
  t.after(() => { if (saved === undefined) delete process.env.VITEST; else process.env.VITEST = saved })
  const pool = ["node", "module", "browser", "import", "development|production", "custom-a"]
  await fc.assert(fc.asyncProperty(fc.subarray(pool), fc.subarray(pool), fc.boolean(), fc.boolean(), async (ssr, client, hostFirst, underVitest) => {
    if (underVitest) process.env.VITEST = "true"
    else delete process.env.VITEST
    const host = { name: "host", enforce: "pre", config: () => ({ resolve: { conditions: client }, ssr: { resolve: { conditions: ssr } } }) }
    const plugins = hostFirst ? [host, vibelang({ compiler })] : [vibelang({ compiler }), host]
    const config = await resolveConfig({ configFile: false, root, logLevel: "silent", plugins }, "build")
    for (const [name, resolved, set] of [["ssr", config.ssr.resolve.conditions, ssr], ["client", config.resolve.conditions, client]]) {
      assert.ok(resolved.includes("vibelang-source"), `${name}: ${resolved}`)
      if (underVitest) assert.equal(resolved.includes("module"), set.includes("module"), `${name}: ${resolved} from ${set}`)
      if (hostFirst) assert.deepEqual(new Set(resolved), new Set([...set, "vibelang-source"]), `${name}: ${resolved} from ${set}`)
    }
  }), { numRuns: 60 })
  // resolveConfig leaves reads of its own running; wait for them to finish.
  for (let waited = 0; waited < 5000 && process.getActiveResourcesInfo().includes("FSReqPromise"); waited += 50) await new Promise((settle) => setTimeout(settle, 50))
})
