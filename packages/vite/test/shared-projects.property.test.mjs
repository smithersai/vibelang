import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import vibelang from "../src/index.js"

const context = { addWatchFile() {}, error(error) { throw new Error(error.message) } }
const rule = "packages/vite/README.md: Each project compiles once, and again after an edit."
const native = process.env.VIBELANG_BINARY

async function fixture({ hold = false } = {}) {
  assert.ok(native, "run with the native compiler")
  const root = await mkdtemp(join(tmpdir(), "vibelang-shared-project-"))
  const file = join(root, "main.vibe"), config = join(root, "tsconfig.json")
  const calls = join(root, "calls"), release = join(root, "release")
  const compiler = join(root, "compiler.mjs"), plugins = []
  const put = async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
  await put(join(root, "package.json"), '{"type":"module"}')
  await put(config, JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], skipLibCheck: true }, files: ["main.vibe"] }))
  await put(file, "export const answer: number = 42\n")
  // Count real emits without replacing the compiler's diagnostics or output.
  await put(compiler, `
import { appendFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
const args = process.argv.slice(2)
if (args.includes("--project-emit")) {
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ pid: process.pid, project: args[args.indexOf("--project") + 1] }) + "\\n")
  const deadline = Date.now() + 15000
  while (${hold} && !existsSync(${JSON.stringify(release)}) && Date.now() < deadline) await delay(10)
}
const result = spawnSync(${JSON.stringify(native)}, args, { stdio: "inherit" })
process.exit(result.status ?? 1)
`)
  const plugin = (options = {}, pluginRoot = root) => {
    const value = vibelang({ compiler, ...options })
    value.configResolved({ root: pluginRoot, logger: { warn() {} } })
    plugins.push(value)
    return value
  }
  const starts = async () => { try { return (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse) } catch (e) { if (e.code === "ENOENT") return []; throw e } }
  return { root, file, compiler, config, put, plugin, starts,
    release: () => writeFile(release, ""),
    async close() { await writeFile(release, ""); await Promise.all(plugins.map(p => p.closeBundle())); await rm(root, { recursive: true, force: true }) }
  }
}
const load = (plugin, file) => plugin.load.call(context, file)

async function shared(input) {
  const f = await fixture()
  try {
    const plugins = Array.from({ length: input.consumers }, () => f.plugin())
    const first = await Promise.all(plugins.map(p => load(p, f.file)))
    for (const result of first) assert.match(result.code, /answer\s*=\s*42/)
    assert.equal((await f.starts()).length, 1, "one native compile for concurrent plugin instances")
    // Source maps stay owned by the caller even though compiler results are shared.
    first[0].map.sources.push("caller-only")
    assert.ok(!first[1].map.sources.includes("caller-only"))
    for (let i = 0; i < input.edits; i++) {
      await f.put(f.file, `export const answer: number = ${43 + i}\n`)
      plugins[i % plugins.length].watchChange(f.file)
      const next = await Promise.all(plugins.map(p => load(p, f.file)))
      for (const result of next) assert.match(result.code, new RegExp("answer\\s*=\\s*" + (43 + i)))
      assert.equal((await f.starts()).length, i + 2, "one fresh compile after the shared input changes")
    }
  } finally { await f.close() }
}

test("main and worker plugin instances share project compiles and invalidations", () => shared({ consumers: 3, edits: 1 }))
test("vite-shared-projects", async () => {
  await checkProperty(fc, { name: "vite-shared-projects", rule, numRuns: 12,
    arbitrary: fc.record({ consumers: fc.integer({ min: 2, max: 5 }), edits: fc.integer({ min: 0, max: 2 }) }),
    regressions: new URL("./property-regressions/", import.meta.url),
    command: "node --test test/shared-projects.property.test.mjs", check: shared })
})

test("closing one consumer preserves another consumer's active compiler", async () => {
  const f = await fixture({ hold: true })
  let pending = []
  try {
    const plugins = [f.plugin(), f.plugin()]
    pending = plugins.map(p => load(p, f.file).then(value => ({ value }), error => ({ error })))
    const deadline = Date.now() + 10000
    while (!(await f.starts()).length && Date.now() < deadline) await delay(10)
    const starts = await f.starts()
    assert.ok(starts.length, "a compiler started")
    await plugins[0].closeBundle()
    assert.doesNotThrow(() => process.kill(starts[0].pid, 0), "another consumer still owns this compiler")
    await f.release()
    for (const result of await Promise.all(pending)) {
      assert.ifError(result.error)
      assert.match(result.value.code, /answer\s*=\s*42/)
    }
    assert.equal((await f.starts()).length, 1)
  } finally { await f.close(); await Promise.all(pending) }
})

test("different compiler commands and project options retain independent managers", async () => {
  const f = await fixture()
  try {
    const second = join(f.root, "compiler2.mjs")
    await f.put(second, await readFile(f.compiler, "utf8"))
    await f.put(join(f.root, "other.json"), await readFile(f.config, "utf8"))
    const plugins = [f.plugin(), f.plugin({ compiler: second }), f.plugin({ project: "other.json" })]
    const results = await Promise.all(plugins.map(p => load(p, f.file)))
    for (const result of results) assert.match(result.code, /answer\s*=\s*42/)
    assert.equal((await f.starts()).length, 3)
  } finally { await f.close() }
})

for (const version of ["vite", "vite7"]) test(`${version} builds two workers and a main entry with one shared project compile`, async () => {
  const f = await fixture()
  try {
    const { build } = await import(version)
    await f.put(join(f.root, "index.html"), '<script type="module" src="/main.ts"></script>')
    await f.put(join(f.root, "main.ts"), 'import { answer } from "./main.vibe"; globalThis.answer = answer; globalThis.workers = [new Worker(new URL("./worker1.ts", import.meta.url), {type:"module"}), new Worker(new URL("./worker2.ts", import.meta.url), {type:"module"})]')
    for (const i of [1, 2]) await f.put(join(f.root, `worker${i}.ts`), 'import { answer } from "./main.vibe"; self.postMessage(answer)')
    const result = await build({ root: f.root, configFile: false, logLevel: "silent",
      plugins: [f.plugin()], worker: { format: "es", plugins: () => [f.plugin()] },
      build: { write: false, minify: false } })
    const chunks = result.output.filter(item => item.fileName.endsWith(".js"))
    assert.ok(chunks.length >= 2)
    assert.equal((await f.starts()).length, 1, "workers and main share the real native compile")
  } finally { await f.close() }
})
