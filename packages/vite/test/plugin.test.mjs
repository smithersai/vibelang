import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"
import { build } from "vite"
import vibelang from "../src/index.js"
import { runChild } from "./child.mjs"
import { devServer } from "./dev-server.mjs"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const compiler = join(packageRoot, "../compiler/bin/vibelang")
const require = createRequire(import.meta.url)
const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs")

const fixtureServers = new Map()

async function fixture(t) {
  const base = join(packageRoot, "test/.fixtures")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "fixture-"))
  fixtureServers.set(root, [])
  // t.after hooks run in the order they were added and stop at the first that
  // throws, so this one hook closes a fixture's servers before removing its files.
  t.after(async () => {
    try {
      await Promise.all(fixtureServers.get(root).map((server) => server.close()))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  await cp(join(packageRoot, "test/project"), root, { recursive: true })
  await writeFile(join(root, "vitest.config.ts"), `
import { defineConfig } from "vitest/config"
import vibelang from ${JSON.stringify(join(packageRoot, "src/index.js"))}
export default defineConfig({
  plugins: [vibelang({ compiler: ${JSON.stringify(compiler)} })],
  test: { include: [process.env.FAILING_TEST ? "failure.test.vibe" : "passing.test.vibe"] }
})
`)
  return root
}

// A server the fixture at options.root closes before it removes its files.
async function serve(options) {
  const server = await devServer(options)
  fixtureServers.get(options.root).push(server)
  return server
}

function runVitest(root, failing = false) {
  return runChild(process.execPath, [vitest, "run", "--no-color"], {
    cwd: root, env: { ...process.env, FAILING_TEST: failing ? "1" : "", NO_COLOR: "1" }
  })
}

// The servers watch by polling. inotify instances are counted per user,
// and on the shared build hosts every lane's watchers draw on one pool of
// 128, so an inotify watcher can fail to start and a test would wait for
// file events that never come.
const watch = { usePolling: true, interval: 50 }

async function until(check) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((accept) => setTimeout(accept, 25))
  }
  assert.fail("Timed out waiting for Vite's file watcher")
}

test("Vitest runs .vibe Effect functions and plain callbacks", async (t) => {
  const result = await runVitest(await fixture(t))
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /2 passed/)
  console.log("PASS .vibe Vitest: 2 assertions")
})

test("Vitest compiles a workspace package's .vibe source with that package's own project", async (t) => {
  // dep lies beside the fixture, outside its root, as a workspace package
  // that the test imports by name through node_modules.
  const root = await fixture(t)
  const dep = `${root}-dep`
  t.after(() => rm(dep, { recursive: true, force: true }))
  await mkdir(join(dep, "src"), { recursive: true })
  await writeFile(join(dep, "package.json"), JSON.stringify({ name: "dep", type: "module", exports: { ".": "./src/index.vibe" } }))
  const config = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8"))
  await writeFile(join(dep, "tsconfig.json"), JSON.stringify({ ...config, include: ["src/**/*"] }))
  await writeFile(join(dep, "src/index.vibe"), "export function twice(value: number): number {\n  return value * 2\n}\n")
  await mkdir(join(root, "node_modules"), { recursive: true })
  await symlink(dep, join(root, "node_modules/dep"))
  await writeFile(join(root, "passing.test.vibe"), `import { assert, it } from "@effect/vitest"
import { twice } from "dep"

it("uses a workspace package's VibeLang source", () => {
  assert.strictEqual(twice(21), 42)
})
`)
  const result = await runVitest(root)
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /1 passed/)
})

test("a Vitest rerun recompiles a .vibe module whose import changed its contract", async (t) => {
  // Vitest 5 keeps transforms on disk between runs (fsModuleCache), keyed by
  // the module's own text; passing.test.vibe does not change, but value()
  // becomes an Effect function, so its call must now run the Effect.
  const root = await fixture(t)
  await writeFile(join(root, "passing.test.vibe"), `import { assert, it } from "@effect/vitest"
import { value } from "./dep.vibe"

it.effect("reads its dependency") {
  assert.strictEqual(value(), 7)
}
`)
  await writeFile(join(root, "dep.vibe"), "export function value(): number {\n  return 7\n}\n")
  let result = await runVitest(root)
  assert.equal(result.code, 0, result.output)
  await writeFile(join(root, "dep.vibe"), "export function value(): number!! {\n  Console.log(\"value\")\n  return 7\n}\n")
  result = await runVitest(root)
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /1 passed/)
  console.log("PASS Vitest rerun: a changed import's contract recompiles its importer")
})

test("register: true lets a Node process a test starts import .vibe source, from any directory", async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, "plain.vibe"), "export function triple(value: number): number {\n  return value * 3\n}\n")
  await writeFile(join(root, "spawn.test.ts"), `import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { expect, it } from "vitest"

it("starts a Node process that imports a .vibe module", () => {
  const plain = new URL("./plain.vibe", import.meta.url).href
  const program = \`const { triple } = await import(\${JSON.stringify(plain)}); console.log(triple(14), process.env.NODE_OPTIONS.includes("--no-warnings"))\`
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", program], { cwd: tmpdir(), encoding: "utf8" })
  expect(output.trim()).toBe("42 true")
}, 60_000) // The child compiles the project; Vitest's 5s default fails on a loaded host.
`)
  const config = (register) => `
import { defineConfig } from "vitest/config"
import vibelang from ${JSON.stringify(join(packageRoot, "src/index.js"))}
export default defineConfig({
  plugins: [vibelang({ compiler: ${JSON.stringify(compiler)}, register: ${register} })],
  test: { include: ["spawn.test.ts"], env: { NODE_OPTIONS: "--no-warnings" } }
})
`
  await writeFile(join(root, "vitest.config.ts"), config(true))
  const registered = await runVitest(root)
  assert.equal(registered.code, 0, registered.output)
  assert.match(registered.output, /1 passed/)
  await writeFile(join(root, "vitest.config.ts"), config(false))
  const plain = await runVitest(root)
  assert.equal(plain.code, 1, plain.output)
  assert.match(plain.output, /ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension "\.vibe"/)
})

test("a deliberate failing assertion reports failure.test.vibe:6", async (t) => {
  const result = await runVitest(await fixture(t), true)
  assert.equal(result.code, 1, result.output)
  assert.match(result.output, /expected 41 to equal 42/)
  assert.match(result.output, /failure\.test\.vibe:6:28/)
  console.log("PASS expected failure: assertion stack at failure.test.vibe:6:28")
})

test("a fixture goes at once after a request, with no dependency optimizer writing into it", async (t) => {
  for (let run = 0; run < 3; run += 1) {
    await t.test(`run ${run}`, async (t) => {
      const root = await fixture(t)
      const server = await serve({
        root, configFile: false, plugins: [vibelang({ compiler })], logLevel: "silent",
        server: { host: "127.0.0.1", port: 0, watch }
      })
      await server.listen()
      const response = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/main.vibe`)
      // main.vibe imports effect: this bare import is what queues an optimizer run.
      assert.match(await response.text(), /from "[^"]*effect/)
      assert.equal(server.environments.client.depsOptimizer, undefined)
    })
  }
})

test("a fixture closes its server before removing the files that server writes", async (t) => {
  for (let run = 0; run < 20; run += 1) {
    await t.test(`run ${run}`, async (t) => {
      const root = await fixture(t)
      const directory = join(root, "node_modules/.vite/deps_temp_writer")
      await mkdir(directory, { recursive: true })
      // Writes like an optimizer run, until the server closes.
      let open = true
      const writing = (async () => {
        for (let chunk = 0; open; chunk += 1) await writeFile(join(directory, `chunk-${chunk}.js`), "")
      })()
      const writer = { name: "writer", async closeBundle() { open = false; await writing } }
      await serve({
        root, configFile: false, plugins: [writer], logLevel: "silent",
        server: { middlewareMode: true, watch: null }
      })
    })
  }
})

test("every Vite dev server in these tests starts through devServer", async () => {
  const directory = join(packageRoot, "test")
  const files = (await readdir(directory)).filter((file) => file.endsWith(".mjs") && file !== "dev-server.mjs")
  assert.ok(files.includes("plugin.test.mjs"))
  for (const file of files) {
    assert.doesNotMatch(await readFile(join(directory, file), "utf8"),
      /import\s*\{[^}]*\bcreateServer\b[^}]*\}\s*from\s*"vite"/, file)
  }
})

test("Vite serves JS and maps, invalidates importers, reports diagnostics and recovers", async (t) => {
  const root = await fixture(t)
  const configPath = join(root, "tsconfig.json")
  const config = JSON.parse(await readFile(configPath, "utf8"))
  config.compilerOptions.sourceRoot = "https://example.invalid/sources/"
  await writeFile(configPath, JSON.stringify(config))
  await writeFile(join(root, "entry.ts"), 'export { answer } from "./main.js"\n')
  const errors = []
  const server = await serve({
    root, configFile: false, plugins: [vibelang({ compiler })],
    customLogger: { info() {}, warn() {}, warnOnce() {}, error: (message) => errors.push(message),
      clearScreen() {}, hasErrorLogged() { return false }, hasWarned: false },
    server: { host: "127.0.0.1", port: 0, watch }
  })
  const messages = []
  const originalSend = server.ws.send.bind(server.ws)
  server.ws.send = (...args) => { messages.push(args[0]); return originalSend(...args) }
  await server.listen()
  const address = server.httpServer.address()
  const base = `http://127.0.0.1:${address.port}`
  let response = await fetch(`${base}/entry.ts`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /main\.vibe/)
  response = await fetch(`${base}/main.vibe`)
  assert.equal(response.status, 200)
  const javascript = await response.text()
  // D274: a single-result Effect body returns its Effect without a generator.
  assert.match(javascript, /Effect\.succeed\(double(\$direct)?\(21\)\)/)
  assert.doesNotMatch(javascript, /value: number/)
  const map = JSON.parse(Buffer.from(javascript.match(/sourceMappingURL=data:application\/json;base64,(\S+)/)[1], "base64"))
  assert.ok(map.sources.some((source) => source.endsWith("main.vibe")))
  assert.ok(map.sources.every((source) => !source.includes("example.invalid")))
  assert.ok(map.sourcesContent.some((source) => source.includes("value: number")))

  const importer = server.moduleGraph.getModuleById(join(root, "entry.ts"))
  assert.ok(importer.transformResult)
  const sourcePath = join(root, "main.vibe")
  const source = await readFile(sourcePath, "utf8")
  await writeFile(sourcePath, source.replace("double(21)", "double(22)"))
  await until(() => !importer.transformResult)
  response = await fetch(`${base}/main.vibe`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /double(\$direct)?\(22\)/)

  await writeFile(sourcePath, source + '\nconst broken: number = "wrong"\n')
  await until(() => messages.some((message) => message?.type === "error"))
  assert.ok(errors.some((message) => /TS2322/.test(message)), errors.join("\n"))
  const diagnostic = messages.find((message) => message?.type === "error").err
  assert.equal(diagnostic.plugin, "vibelang")
  assert.equal(diagnostic.loc.file, sourcePath)
  assert.match(diagnostic.message, /TS2322/)
  response = await fetch(`${base}/main.vibe`)
  assert.equal(response.status, 500)
  await writeFile(sourcePath, source.replace("double(21)", "double(23)"))
  await until(async () => {
    const recovered = await fetch(`${base}/main.vibe`)
    return recovered.status === 200 && /double(\$direct)?\(23\)/.test(await recovered.text())
  })
  console.log("PASS HTTP: JS, .vibe source map, importer invalidation, TS2322 terminal/overlay, recovery")
})

test("Vite serves and builds a module declaration as a module of its own (D403)", async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, "step.ts"), "export const step = 2\n")
  await writeFile(join(root, "counter.vibe"), [
    "module counter {",
    "  import { step } from \"./step.ts\"",
    "",
    "  export let count = 0",
    "",
    "  export function bump(): number {",
    "    count += step",
    "    return count",
    "  }",
    "}",
    "",
    "export { bump, count } from counter",
    ""
  ].join("\n"))
  const server = await serve({
    root, configFile: false, plugins: [vibelang({ compiler })], logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, watch }
  })
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  let response = await fetch(`${base}/counter.vibe`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /from "\/counter\.vibe\.counter\.js"/)
  response = await fetch(`${base}/counter.vibe.counter.js`)
  assert.equal(response.status, 200)
  const module = await response.text()
  assert.match(module, /export let count = 0/)
  assert.match(module, /from "\/step\.ts"/)
  const map = JSON.parse(Buffer.from(module.match(/sourceMappingURL=data:application\/json;base64,(\S+)/)[1], "base64"))
  assert.deepEqual(map.sources.map((source) => source.split("/").at(-1)), ["counter.vibe"])

  const result = await build({
    root, configFile: false, plugins: [vibelang({ compiler })], logLevel: "silent",
    build: { write: false, lib: { entry: join(root, "counter.vibe"), formats: ["es"], fileName: "counter" } }
  })
  const chunk = (result.output || result[0].output).find((file) => file.type === "chunk")
  const bundle = join(root, "counter.bundle.mjs")
  await writeFile(bundle, chunk.code)
  const counter = await import(pathToFileURL(bundle).href)
  assert.equal(counter.count, 0)
  assert.equal(counter.bump(), 2)
  assert.equal(counter.count, 2, "the re-export is a live binding")
})

test("Vite production builds accept .vibe entry modules", async (t) => {
  const root = await fixture(t)
  const result = await build({
    root, configFile: false, plugins: [vibelang({ compiler })], logLevel: "silent",
    build: { write: false, sourcemap: true, lib: { entry: join(root, "main.vibe"), formats: ["es"] },
      rollupOptions: { external: ["effect", "effect/Effect"] } }
  })
  const output = result.output || result[0].output
  assert.ok(output.some((file) => file.type === "chunk" && file.code.includes("succeed")))
  assert.ok(output.some((file) => file.type === "asset" && file.fileName.endsWith(".map")))
})

test("a TypeScript entry reaches a directory's index.vibe and an extensionless .vibe module, as TypeScript resolves them", async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, "mount"))
  await writeFile(join(root, "mount/index.vibe"), "export const mounted = (): string => \"mounted\"\n")
  await writeFile(join(root, "plain.vibe"), "export const plain = 2\n")
  // A stale emit beside its source: TypeScript resolves ./plain to plain.vibe first.
  await writeFile(join(root, "plain.js"), "export const plain = \"stale\"\n")
  const tsconfig = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8"))
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ ...tsconfig, include: ["*.vibe", "mount/*.vibe"] }))
  await writeFile(join(root, "entry.ts"), 'import { mounted } from "./mount"\nimport { plain } from "./plain"\nexport const both = `${mounted()} ${plain}`\n')
  const result = await build({
    root, configFile: false, plugins: [vibelang({ compiler })], logLevel: "silent",
    build: { write: false, lib: { entry: join(root, "entry.ts"), formats: ["es"] }, rollupOptions: { external: [/^effect/] } }
  })
  const code = (result.output || result[0].output).filter((file) => file.type === "chunk").map((file) => file.code).join("\n")
  assert.match(code, /mounted 2/)
  // A config's own extensions keep their order, with .vibe after them.
  assert.deepEqual(vibelang().config({ resolve: { extensions: [".ts", ".js"] } }).resolve, { extensions: [".vibe"] })
  assert.deepEqual(vibelang().config({ resolve: { extensions: [".ts", ".vibe"] } }).resolve, undefined)
})

test("a native compiler named bin/vibelang is executed without Node", async (t) => {
  const root = await fixture(t)
  const native = join(root, "bin", "vibelang")
  await mkdir(dirname(native), { recursive: true })
  await cp(process.env.VIBELANG_BINARY || join(packageRoot, "../../typescript/built/local/tsc"), native)
  const plugin = vibelang({ compiler: native })
  t.after(() => plugin.closeBundle())
  plugin.configResolved({ root, logger: { warn() {} } })
  const file = join(root, "main.vibe")
  const result = await plugin.transform.call({
    addWatchFile() {},
    error(error) { throw new Error(error.message) }
  }, await readFile(file, "utf8"), file)
  assert.match(result.code, /Effect\.succeed/)
})

test("documented Vitest setup includes tests excluded by the app project", async (t) => {
  const root = await fixture(t)
  const docs = await readFile(join(packageRoot, "../../docs/user/src/setup/vite.md"), "utf8")
  const section = docs.split("## 4. Test with Vitest")[1]
  const snippet = section.match(/```ts\n([\s\S]*?)```/)[1]
  await writeFile(join(root, "vitest.config.ts"), snippet.replace(
    'from "vibelang-vite"', `from ${JSON.stringify(join(packageRoot, "src/index.js"))}`
  ))
  const config = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8"))
  config.include = ["src"]
  config.exclude = ["src/**/*.test.vibe"]
  await writeFile(join(root, "tsconfig.json"), JSON.stringify(config))
  await writeFile(join(root, "tsconfig.test.json"), '{"extends":"./tsconfig.json","exclude":[]}')
  await mkdir(join(root, "src"))
  await writeFile(join(root, "src/greet.vibe"), 'export function greet(name: string) { return `Hello, ${name}!` }\n')
  await writeFile(join(root, "src/greet.test.vibe"), `import { assert, it } from "@effect/vitest"
import { greet } from "./greet.vibe"
it.effect("greets") { assert.strictEqual(greet("Vite"), "Hello, Vite!") }
`)
  const result = await runVitest(root)
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /1 passed/)
})

test("Vite hot updates ignore diagnostics in unserved TypeScript sources", async (t) => {
  const root = await fixture(t)
  const configPath = join(root, "tsconfig.json")
  const config = JSON.parse(await readFile(configPath, "utf8"))
  config.include.push("*.ts")
  await writeFile(configPath, JSON.stringify(config))
  const unrelated = join(root, "unrelated.ts")
  await writeFile(unrelated, "export const value: number = 1\n")
  const plugin = vibelang({ compiler })
  t.after(() => plugin.closeBundle())
  const messages = []
  const logger = { warn() {}, error: (message) => messages.push(message) }
  plugin.configResolved({ root, logger })
  const file = join(root, "main.vibe")
  await plugin.transform.call({ addWatchFile() {} }, "", file)
  await writeFile(unrelated, 'export const value: number = "wrong"\n')
  const loaded = { file, importers: [] }
  const affected = await plugin.handleHotUpdate({
    file: unrelated, modules: [],
    server: {
      moduleGraph: { idToModuleMap: new Map([[file, loaded]]), invalidateModule() {} },
      config: { logger }, ws: { send: (message) => messages.push(message) }
    }
  })
  assert.deepEqual(messages, [], "an unrelated watched source must not raise an overlay")
  assert.deepEqual(affected, [loaded], "loaded modules still recompile against changed contracts")
})
