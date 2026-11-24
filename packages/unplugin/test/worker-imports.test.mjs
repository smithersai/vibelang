// VIP-57: a `with { type: "worker" }` import bundles as a worker chunk, and
// the bundle answers through real worker threads. Run test/run.sh, which
// builds the compiler and the runtime and links the fixtures' node_modules.
import assert from "node:assert/strict"
import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { runChild } from "./child.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))

async function fixture(t) {
  // Fixtures share test/.fixtures/node_modules, which run.sh links.
  const root = await mkdtemp(join(here, ".fixtures", "worker-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(join(here, "worker"), root, { recursive: true })
  return root
}

// Rollup does not resolve packages; Node resolves these from the fixture at run time.
const external = (id) => /^(?:effect|vibelang-runtime)(?:\/|$)/.test(id)

async function answer(root, bundle) {
  const run = await runChild(process.execPath, [join(root, bundle)], { cwd: root })
  assert.equal(run.code, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim()), { mean: 2, max: 3 })
}

test("the plugins share one worker-import rewrite", async () => {
  assert.equal(await readFile(join(here, "../src/worker-output.js"), "utf8"), await readFile(join(here, "../../vite/src/worker-output.js"), "utf8"))
})

test("rollup emits a worker entry chunk, and the bundle answers through worker threads", async (t) => {
  const root = await fixture(t)
  const { rollup } = await import("rollup")
  const { default: vibelang } = await import("vibelang-unplugin/rollup")
  const bundle = await rollup({ input: join(root, "start.js"), external, plugins: [vibelang({ root, workerPlatform: "node" })], onwarn() {} })
  const { output } = await bundle.write({ dir: join(root, "out"), format: "es", sourcemap: true })
  await bundle.close()
  const worker = output.find((item) => item.type === "chunk" && item.name === "stats.worker")
  assert.ok(worker, output.map((item) => item.fileName).join("\n"))
  const main = output.find((item) => item.fileName === "start.js")
  assert.match(main.code, new RegExp(String.raw`\.\$worker\(new URL\(new URL\('${worker.fileName.replace(/[.]/g, "\\.")}', import\.meta\.url\)\.href, import\.meta\.url\), \[[\w$]+\], true\)`))
  assert.doesNotMatch(main.code, /stats\.js/)
  assert.match(output.filter((item) => item.type === "chunk" && (item === worker || worker.imports.includes(item.fileName))).map((item) => item.code).join("\n"), /ExperimentalNodeRpc\.runWorker\(/)
  await answer(root, "out/start.js")
})

test("rolldown emits a worker entry chunk for its node platform, and the bundle answers", async (t) => {
  const root = await fixture(t)
  const { rolldown } = await import("rolldown")
  const { default: vibelang } = await import("vibelang-unplugin/rolldown")
  const bundle = await rolldown({ cwd: root, input: join(root, "start.js"), platform: "node", external, plugins: [vibelang()], onLog() {} })
  const { output } = await bundle.write({ dir: join(root, "out"), format: "es" })
  await bundle.close()
  assert.ok(output.some((item) => item.type === "chunk" && item.name === "stats.worker"), output.map((item) => item.fileName).join("\n"))
  await answer(root, "out/start.js")
})

test("vite's SSR build through vibelang-unplugin emits a Node worker entry, and the bundle answers", async (t) => {
  const root = await fixture(t)
  const { build } = await import("vite")
  const { default: vibelang } = await import("vibelang-unplugin/vite")
  await build({
    root, configFile: false, logLevel: "silent", plugins: [vibelang()],
    build: { ssr: join(root, "start.js"), outDir: join(root, "out"), minify: false, rolldownOptions: { output: { entryFileNames: "start.js" } } }
  })
  await answer(root, "out/start.js")
})

for (const bundler of ["webpack", "rspack"]) {
  test(`${bundler} bundles the worker entry through its worker syntax, and the bundle answers`, async (t) => {
    const root = await fixture(t)
    const create = bundler === "webpack" ? (await import("webpack")).default : (await import("@rspack/core")).rspack
    const { default: vibelang } = await import(`vibelang-unplugin/${bundler}`)
    const compiler = create({
      mode: "none", context: root, target: "node", entry: join(root, "start.js"),
      output: { path: join(root, "out"), filename: "start.cjs" },
      plugins: [vibelang()], infrastructureLogging: { level: "error" }
    })
    const stats = await new Promise((accept, reject) => compiler.run((error, result) => error ? reject(error) : accept(result)))
    await new Promise((accept) => compiler.close(accept))
    assert.ok(!stats.hasErrors(), stats.compilation.errors.map((item) => item.message).join("\n"))
    const chunks = [...stats.compilation.chunks]
    assert.ok(chunks.length >= 2, `${bundler} emitted one chunk`)
    await answer(root, "out/start.cjs")
  })
}

test("esbuild fails the build with the worker import named", async (t) => {
  const root = await fixture(t)
  const esbuild = await import("esbuild")
  const { default: vibelang } = await import("vibelang-unplugin/esbuild")
  await assert.rejects(esbuild.build({
    absWorkingDir: root, entryPoints: [join(root, "start.js")], bundle: true, platform: "node", format: "esm",
    outfile: join(root, "out/start.js"), plugins: [vibelang()], logLevel: "silent"
  }), (error) => {
    const text = error.errors.map((item) => item.text).join("\n")
    assert.match(text, /main\.vibe imports "\.\/stats\.(?:js|vibe)" with \{ type: "worker" \}, and esbuild cannot emit a worker chunk from a plugin/)
    assert.match(text, /Bundle it with Rollup, Rolldown, Vite, webpack or Rspack/)
    return true
  })
})
