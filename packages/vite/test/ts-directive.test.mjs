// Run through test/run.sh, which links effect into test/.fixtures/node_modules.
// A .ts module with the // @vibe directive (VIP-42) is a VibeLang module here.
import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"
import vibelang from "../src/index.js"
import { runChild } from "./child.mjs"
import { fixtureRoot } from "./dep-scan.mjs"
import { devServer, scanServer } from "./dev-server.mjs"

const compiler = fileURLToPath(new URL("../../compiler/bin/vibelang", import.meta.url))

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "ESNext", target: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: true, types: [], allowImportingTsExtensions: true },
    include: ["src"]
  }),
  "src/plain.ts": 'export const suffix: string = "!"\n',
  "src/hello.ts": `// @vibe
import { suffix } from "./plain.ts"

error Empty

effect function greet(name: string) {
  if (name === "") throw new Empty()
  return \`hello \${name}\${suffix}\`
}

export effect function main() {
  const who = greet("") catch () => "nobody"
  return try greet(who)
}
`,
  "src/run.ts": 'import { Effect } from "effect"\nimport { main } from "./hello.ts"\nexport const output = await Effect.runPromise(main())\n'
}

function project(t, extra = {}) {
  const root = fixtureRoot()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries({ ...files, ...extra })) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

const bundle = (root, plugins) => build({
  root, configFile: false, logLevel: "silent", plugins,
  build: { ssr: "src/run.ts", outDir: "dist", write: true, rollupOptions: { output: { entryFileNames: "run.mjs" } } }
})

test("a build compiles a .ts module with the directive and leaves its plain neighbour to Vite", async (t) => {
  const root = project(t)
  await bundle(root, [vibelang({ compiler })])
  const { output } = await import(pathToFileURL(join(root, "dist/run.mjs")).href)
  assert.equal(output, "hello nobody!")
})

test("without the plugin Vite refuses the file", async (t) => {
  const root = project(t)
  await assert.rejects(bundle(root, []), /hello\.ts/)
})

test("a build reports the file's errors under their own codes", async (t) => {
  const root = project(t, { "src/hello.ts": "// @vibe\nexport function plain() {\n  throw new Error('no')\n}\nexport const main = plain\n" })
  await assert.rejects(bundle(root, [vibelang({ compiler })]), /EK0401/)
})

test("the dev server serves JavaScript for the file", async (t) => {
  const root = project(t)
  const server = await devServer({ root, configFile: false, logLevel: "silent", plugins: [vibelang({ compiler })], server: { ws: false, watch: null } })
  t.after(() => server.close())
  const { code } = await server.transformRequest("/src/hello.ts")
  assert.doesNotMatch(code, /effect function/)
  assert.match(code, /Empty/)
})

test("Vitest runs a test that imports the file, and a test written in it", async (t) => {
  const plugin = fileURLToPath(new URL("../src/index.js", import.meta.url))
  const root = project(t, {
    "vitest.config.ts": `import { defineConfig } from "vitest/config"
import vibelang from ${JSON.stringify(plugin)}
export default defineConfig({ plugins: [vibelang({ compiler: ${JSON.stringify(compiler)} })], test: { include: ["src/*.test.ts"] } })
`,
    "src/plain.test.ts": `import { Effect } from "effect"
import { expect, test } from "vitest"
import { main } from "./hello.ts"
test("runs", async () => { expect(await Effect.runPromise(main())).toBe("hello nobody!") })
`,
    "src/written.test.ts": `// @vibe
import { assert, it } from "@effect/vitest"
import { main } from "./hello.ts"
it.effect("runs", effect () => {
  const value = try main()
  try Effect.sync(() => assert.strictEqual(value, "hello nobody!"))
})
`
  })
  const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs")
  const { code, stdout, stderr } = await runChild(process.execPath, [vitest, "run"], { cwd: root })
  assert.equal(code, 0, stdout + stderr)
  assert.match(stdout, /2 passed/)
})

test("a cold dependency scan reads the file's JavaScript", async (t) => {
  const root = project(t, {
    "src/value.ts": "// @vibe\nexport schema Item { value: string }\n",
    "src/entry.ts": 'import { Item } from "./value.ts"\nconsole.log(Item)\n'
  })
  const server = await scanServer({
    root, configFile: false, logLevel: "silent", plugins: [vibelang({ compiler })],
    optimizeDeps: { entries: ["src/entry.ts"] }, server: { ws: false, watch: null }
  })
  t.after(() => server.close())
  const optimizer = server.environments.client.depsOptimizer
  await optimizer.init()
  await optimizer.scanProcessing
  const scanned = Object.keys({ ...optimizer.metadata.discovered, ...optimizer.metadata.optimized })
  assert.ok(scanned.includes("effect/Schema"), `the scan found ${JSON.stringify(scanned)}`)
})
