// VIP-57: a `with { type: "worker" }` import builds as a worker entry chunk.
// Run test/run.sh, which builds the compiler and the runtime and links the
// fixtures' node_modules first.
import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { SourceMap } from "node:module"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"
import { build } from "vite"
import { compilerCommand } from "../../compiler/project.mjs"
import vibelang from "../src/index.js"
import { compilerParser, workerEntryCode, workerOutput } from "../src/worker-output.js"
import { runChild } from "./child.mjs"
import { devServer } from "./dev-server.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? join(here, "../../compiler/bin/vibelang")

async function fixture(t) {
  const base = join(here, ".fixtures")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "worker-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(join(here, "worker"), root, { recursive: true })
  return root
}

const parse = compilerParser({ compilerCommand }, () => compiler, () => {})

// The compiler's lowering of worker imports, as it writes it, and look-alikes
// the rewrite must leave alone: strings, comments, another object's $worker.
const lowered = (runtime, stats, other) => `import * as ${runtime} from "vibelang-runtime/internal";
import { Stats as statsWorker$Stats } from "${stats}";
import { Other as otherWorker$Other } from "${other}";
import * as elsewhere from "./elsewhere.js";
const statsWorker = ${runtime}.$worker(new URL("${stats}", import.meta.url), [statsWorker$Stats]);
const otherWorker = ${runtime}.$worker(new URL("${other}", import.meta.url), [otherWorker$Other]);
const quoted = "${runtime}.$worker(new URL('${stats}', import.meta.url), [statsWorker$Stats])";
// ${runtime}.$worker(new URL("${stats}", import.meta.url), [statsWorker$Stats])
/* ${runtime}.$worker(new URL("${stats}", import.meta.url), [statsWorker$Stats]) */
const alike = elsewhere.$worker(new URL("${stats}", import.meta.url), [statsWorker$Stats]);
export { statsWorker, otherWorker, quoted, alike };
`

for (const [runtime, stats, other] of [["runtime", "./stats.js", "./other%20one.js"], ["runtime_1", "./stats.vibe", "./other%20one.vibe"]]) {
  test(`the rewrite replaces each worker import's URL and only those: ${runtime}, ${stats}`, async (t) => {
    const root = await fixture(t)
    await writeFile(join(root, "other one.vibe"), "")
    const file = join(root, "main.vibe")
    const code = lowered(runtime, stats, other)
    const modules = []
    const output = workerOutput({ code, map: null }, file, {
      parse, replace: ({ module }) => { modules.push(module); return { code: `URL_${modules.length}` } }
    })
    assert.deepEqual(modules, [join(root, "stats.vibe"), join(root, "other one.vibe")])
    assert.ok(output.code.includes(`const statsWorker = ${runtime}.$worker(URL_1, [statsWorker$Stats], true);`), output.code)
    assert.ok(output.code.includes(`const otherWorker = ${runtime}.$worker(URL_2, [otherWorker$Other], true);`), output.code)
    // Everything else is unchanged.
    const untouched = code.split("\n").filter((line) => !line.startsWith("const statsWorker") && !line.startsWith("const otherWorker"))
    for (const line of untouched) assert.ok(output.code.includes(line), line)
    // The map takes the rewritten call back to its line.
    const map = new SourceMap(output.map)
    const lines = output.code.split("\n")
    const line = lines.findIndex((text) => text.startsWith("const otherWorker"))
    const column = lines[line].indexOf("[otherWorker$Other]")
    const entry = map.findEntry(line, column)
    assert.equal(entry.originalLine, code.split("\n").findIndex((text) => text.startsWith("const otherWorker")))
    assert.equal(entry.originalColumn, code.split("\n")[entry.originalLine].indexOf("[otherWorker$Other]"))
  })
}

test("a module without a worker import is not rewritten", async (t) => {
  const root = await fixture(t)
  const code = `const text = "runtime.$worker(new URL('./stats.js', import.meta.url), [x])";\n`
  const output = workerOutput({ code, map: null }, join(root, "main.vibe"), { parse, replace: assert.fail })
  assert.equal(output.code, code)
})

test("the worker entry imports its module and serves it on the platform's runner", () => {
  assert.equal(workerEntryCode("/app/stats.vibe", "node"),
    `import layer from "./stats.vibe"\nimport { ExperimentalNodeRpc } from "vibelang-runtime/experimental/platform-node"\nExperimentalNodeRpc.runWorker(layer)\n`)
  assert.match(workerEntryCode("/app/stats.vibe", "browser"), /ExperimentalBrowserRpc\.runWorker\(layer\)/)
  assert.match(workerEntryCode("/app/stats.vibe", "bun"), /from "vibelang-runtime\/experimental\/platform-bun"/)
  assert.throws(() => vibelang({ workerPlatform: "deno" }), /workerPlatform must be "node", "bun" or "browser"/)
})

// The chunks a chunk loads statically, itself included.
function closure(output, chunk) {
  const byName = new Map(output.filter((item) => item.type === "chunk").map((item) => [item.fileName, item]))
  const seen = new Set(), pending = [chunk]
  while (pending.length) {
    const next = pending.pop()
    if (!next || seen.has(next)) continue
    seen.add(next)
    for (const name of next.imports) pending.push(byName.get(name))
  }
  return [...seen].map((item) => item.code).join("\n")
}

test("vite build emits a browser worker entry chunk and passes its URL", async (t) => {
  const root = await fixture(t)
  const result = await build({
    root, configFile: false, logLevel: "silent", plugins: [vibelang({ compiler })],
    build: { write: false, minify: false, rollupOptions: { input: join(root, "main.vibe") } }
  })
  const output = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output)
  const worker = output.find((item) => item.type === "chunk" && item.name === "stats.worker")
  assert.ok(worker, output.map((item) => item.fileName).join("\n"))
  const main = output.find((item) => item.type === "chunk" && item.name === "main")
  assert.ok(main && main !== worker)
  // The bundler may hoist the runtime's $worker into a binding of its own.
  const call = /\$worker\(new URL\(([^;]*?), import\.meta\.url\), \[[\w$]+\], true\)/.exec(main.code)
  assert.ok(call, main.code)
  assert.ok(call[1].includes(worker.fileName.split("/").at(-1)), call[1])
  const code = closure(output, worker)
  assert.match(code, /runWorker/)
  assert.match(code, /summarize/)
  assert.doesNotMatch(code, /stats\.js/)
})

test("vite build for SSR emits a Node worker entry that answers through worker threads", async (t) => {
  const root = await fixture(t)
  await build({
    root, configFile: false, logLevel: "silent", plugins: [vibelang({ compiler })],
    build: { ssr: join(root, "start.js"), outDir: join(root, "out"), minify: false, rollupOptions: { output: { entryFileNames: "start.js" } } }
  })
  const run = await runChild(process.execPath, [join(root, "out/start.js")], { cwd: root })
  assert.equal(run.code, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim()), { mean: 2, max: 3 })
})

test("vite dev serves a browser worker entry beside its module", async (t) => {
  const root = await fixture(t)
  const server = await devServer({ root, configFile: false, logLevel: "silent", plugins: [vibelang({ compiler })], server: { middlewareMode: true, hmr: false } })
  t.after(() => server.close())
  const main = await server.environments.client.transformRequest("/main.vibe")
  // Vite's dev transform rewrites the base to '' + import.meta.url.
  const call = /\.\$worker\(new URL\("([^"]+)", [^()]*import\.meta\.url\), \[[\w$]+\], true\)/.exec(main.code)
  assert.ok(call, main.code)
  assert.equal(call[1], "/stats.vibe?vibelang-worker=browser")
  const entry = await server.environments.client.transformRequest(call[1])
  assert.match(entry.code, /from "\/stats\.vibe(?:\?import)?"/)
  assert.match(entry.code, /ExperimentalBrowserRpc\.runWorker\(/)
  // A server environment runs modules in Vite's module runner, which no thread
  // can load: the runtime starts the module itself from its source.
  const ssr = await server.environments.ssr.transformRequest("/main.vibe")
  const module = /\.\$worker\(new URL\("([^"]+)"\), \[[^\]]+\]\)/.exec(ssr.code)
  assert.ok(module, ssr.code)
  assert.equal(module[1], pathToFileURL(join(root, "stats.vibe")).href)
})

test("vite dev's module runner answers through worker threads that load .vibe with vibelang/register", async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, "ssr.mjs"), `
import { createServer } from "vite"
import { Effect } from "effect"
import vibelang from ${JSON.stringify(pathToFileURL(join(here, "../src/index.js")).href)}
const server = await createServer({ root: process.cwd(), configFile: false, logLevel: "silent", plugins: [vibelang({ compiler: ${JSON.stringify(compiler)} })],
  server: { middlewareMode: true, hmr: false }, ssr: { external: ["vibelang-runtime"] }, optimizeDeps: { noDiscovery: true, include: [] } })
try {
  const { main } = await server.ssrLoadModule("/main.vibe")
  console.log(JSON.stringify(await Effect.runPromise(main())))
} finally { await server.close() }
`)
  const register = pathToFileURL(join(here, "../../compiler/register.mjs")).href
  const run = await runChild(process.execPath, [`--import=${register}`, join(root, "ssr.mjs")], { cwd: root })
  assert.equal(run.code, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim().split("\n").at(-1)), { mean: 2, max: 3 })
})
