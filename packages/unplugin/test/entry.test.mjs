// An explicit application runner executes through every bundle format.
// A library can export main without acquiring startup behavior (VIP-26).
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { runChild } from "./child.mjs"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const hasBun = spawnSync("bun", ["--version"]).status === 0
const expected = "app main ran with helper\n"
let root

before(async () => {
  root = await mkdtemp(join(here, ".fixtures", "entry-"))
  await cp(join(here, "entry"), root, { recursive: true })
  const compiled = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json"], { cwd: root, encoding: "utf8" })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
})
after(() => root === undefined ? undefined : rm(root, { recursive: true, force: true }))

// Rollup resolves no packages without @rollup/plugin-node-resolve; Node
// resolves these from the fixtures' node_modules when the bundle runs.
const external = (id) => /^(?:effect|vibelang-runtime)(?:\/|$)/.test(id)

async function webpackLike(create, entry, outfile, format) {
  const esm = format === "esm"
  const compiler = create({
    mode: "none", context: root, target: "node", entry,
    output: { path: dirname(outfile), filename: basename(outfile), ...(esm ? { module: true, chunkFormat: "module", library: { type: "module" } } : {}) },
    ...(esm ? { experiments: { outputModule: true } } : {}),
    infrastructureLogging: { level: "error" }
  })
  const stats = await new Promise((accept, reject) => compiler.run((error, stats) => compiler.close(() => error ? reject(error) : accept(stats))))
  assert.ok(!stats.hasErrors(), stats.toString("errors-only"))
}

// Each bundles entry into outfile in format, "esm" or "cjs".
const bundlers = {
  async esbuild(entry, outfile, format) {
    const { build } = await import("esbuild")
    await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format, logLevel: "silent" })
  },
  // A server bundle often leaves packages to node_modules; then the runtime is not in the bundle.
  async "esbuild, packages external"(entry, outfile, format) {
    const { build } = await import("esbuild")
    await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format, packages: "external", logLevel: "silent" })
  },
  async rolldown(entry, outfile, format) {
    const { rolldown } = await import("rolldown")
    const bundle = await rolldown({ input: entry, platform: "node", onLog() {} })
    await bundle.write({ file: outfile, format })
    await bundle.close()
  },
  async rollup(entry, outfile, format) {
    const { rollup } = await import("rollup")
    const bundle = await rollup({ input: entry, external, onwarn() {} })
    await bundle.write({ file: outfile, format })
    await bundle.close()
  },
  async vite(entry, outfile, format) {
    const { build } = await import("vite")
    await build({
      root, configFile: false, logLevel: "silent",
      build: { ssr: entry, outDir: dirname(outfile), emptyOutDir: false, rolldownOptions: { output: { format, entryFileNames: basename(outfile) } } }
    })
  },
  async webpack(entry, outfile, format) {
    await webpackLike((await import("webpack")).default, entry, outfile, format)
  },
  async rspack(entry, outfile, format) {
    await webpackLike((await import("@rspack/core")).rspack, entry, outfile, format)
  },
  async bun(entry, outfile, format) {
    const script = `const result = await Bun.build(${JSON.stringify({ entrypoints: [entry], outdir: dirname(outfile), naming: basename(outfile), target: "node", format })})
if (!result.success) { console.error(result.logs.map(String).join("\\n")); process.exit(1) }`
    const result = spawnSync("bun", ["-e", script], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
  }
}

async function run(file) {
  const { code, stdout, stderr } = await runChild(process.execPath, [file], { cwd: root })
  return { code, stdout, stderr }
}

describe("an explicit entry runner in a bundle (VIP-26)", () => {
  it("runs the written entry runner and leaves the library main inert", async () => {
    assert.deepEqual(await run("dist/main.js"), { code: 0, stdout: expected, stderr: "" })
    assert.deepEqual(await run("dist/lib.js"), { code: 0, stdout: "", stderr: "" })
  })

  for (const [bundler, bundle] of Object.entries(bundlers)) {
    for (const format of ["esm", "cjs"]) {
      const skip = bundler === "bun" && !hasBun && "bun is not installed"
      it(`${bundler}, ${format === "esm" ? "an ES module" : "CommonJS"}: runs only the written entry runner`, { skip }, async () => {
        const name = `${bundler.replace(/\W+/g, "-")}-${format}`
        const outfile = join(root, "out", name, format === "esm" ? "main.mjs" : "main.cjs")
        await bundle(join(root, "dist/main.js"), outfile, format)
        assert.deepEqual(await run(outfile), { code: 0, stdout: expected, stderr: "" })
      })
    }
  }
  it("generated entry names, runners and values preserve explicit startup", async () => {
    const rule = "gets no entry diagnostic and causes no implicit startup"
    assert.ok((await readFile(SpecPath("007-tooling.md"), "utf8")).includes(rule))
    const file = join(root, "src/main.vibe")
    const original = await readFile(file, "utf8")
    try {
      await checkProperty(fc, {
        name: "explicit-entry-runner", rule,
        arbitrary: fc.record({
          bundler: fc.constantFrom(...Object.keys(bundlers)),
          format: fc.constantFrom("esm", "cjs"),
          runner: fc.constantFrom("runSync", "runPromise"),
          entryName: fc.constantFrom("main", "start", "run"),
          value: fc.integer({ min: -1000, max: 1000 })
        }),
        numRuns: 16, regressions: new URL("./entry-regressions/", import.meta.url),
        command: 'node --test --test-name-pattern="generated entry names" test/entry.test.mjs',
        async check({ bundler, format, runner, entryName, value }) {
          const source = original
            .replace("function main()", `function ${entryName}()`)
            .replace("Effect.runSync(main())", `Effect.${runner}(${entryName}())`)
            .replace("app main ran", `app ${value} ran`)
          await writeFile(file, source)
          const compiled = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json"], { cwd: root, encoding: "utf8" })
          assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
          const outfile = join(root, "out", "generated", format === "esm" ? "main.mjs" : "main.cjs")
          await bundlers[bundler](join(root, "dist/main.js"), outfile, format)
          assert.deepEqual(await run(outfile), { code: 0, stdout: `app ${value} ran with helper\n`, stderr: "" })
          assert.deepEqual(await run("dist/lib.js"), { code: 0, stdout: "", stderr: "" })
        }
      })
    } finally { await writeFile(file, original) }
  })

})
