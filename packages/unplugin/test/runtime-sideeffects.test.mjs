// run.sh builds a private runtime under .fixtures before these package-boundary
// tests. Use esbuild's normal package metadata, with no treeshaking overrides.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { it } from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const fixtures = fileURLToPath(new URL(".fixtures/", import.meta.url))
const runtime = join(fixtures, "vibelang-runtime")

async function fixture(t, version) {
  const root = await mkdtemp(join(fixtures, "runtime-sideeffects-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const modules = join(root, "node_modules")
  const installed = join(modules, "vibelang-runtime")
  await mkdir(installed, { recursive: true })
  await cp(join(runtime, "dist"), join(installed, "dist"), { recursive: true })
  await cp(join(runtime, "package.json"), join(installed, "package.json"))
  await cp(join(runtime, "node_modules/@effect"), join(modules, "@effect"), { recursive: true, dereference: true })
  const effect = join(modules, "effect")
  await mkdir(effect)
  const metadata = JSON.parse(await readFile(join(runtime, "node_modules/effect/package.json"), "utf8"))
  await writeFile(join(effect, "package.json"), JSON.stringify({ ...metadata, ...(version ? { version } : {}) }))
  await symlink(join(runtime, "node_modules/effect/dist"), join(effect, "dist"))
  await writeFile(join(root, "package.json"), '{"type":"module"}')
  return root
}

async function bundle(root, source, conditions = []) {
  return build({
    stdin: { contents: source, resolveDir: root, sourcefile: "entry.js" },
    bundle: true, platform: "browser", format: "esm", minify: true,
    metafile: true, write: false, logLevel: "silent", conditions
  })
}

it("a single browser service drops unrelated experimental and Effect crypto modules", async (t) => {
  const root = await fixture(t)
  const result = await bundle(root, `
    import { ExperimentalBrowserWindow } from "vibelang-runtime/experimental/platform-browser"
    globalThis.browserLayer = ExperimentalBrowserWindow.layer
  `)
  // inputs also includes parsed modules that contributed no output. Check
  // bytesInOutput so this asserts the code the browser actually downloads.
  const inputs = Object.entries(result.metafile.outputs).flatMap(([, output]) =>
    Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path))
  assert.ok(inputs.some((path) => path.endsWith("/experimental/platform-browser/ExperimentalBrowserWindow.js")))
  assert.deepEqual(inputs.filter((path) => /\/experimental\//.test(path) && !/\/(?:Window|ExperimentalBrowserWindow)\.js$/.test(path)), [])
  assert.deepEqual(inputs.filter((path) => /\/effect\/dist\/crypto\//.test(path)), [])
  assert.ok(!result.outputFiles[0].text.includes("effect/crypto/Aead"))
})

for (const specifier of ["vibelang-runtime", "vibelang-runtime/internal"]) {
  for (const conditions of [[], ["module-sync"]]) {
    it(`a bare ${specifier} import keeps the version guard (${conditions[0] ?? "import"})`, async (t) => {
      const root = await fixture(t, "0.0.0")
      const result = await bundle(root, `import "${specifier}"`, conditions)
      const output = join(root, "bundle.mjs")
      await writeFile(output, result.outputFiles[0].text)
      const ran = spawnSync(process.execPath, [output], { encoding: "utf8", timeout: 10_000 })
      assert.equal(ran.signal, null)
      assert.equal(ran.status, 1)
      const metadata = JSON.parse(await readFile(join(runtime, "package.json"), "utf8"))
      assert.ok(ran.stderr.includes(`requires effect@${metadata.peerDependencies.effect}; found effect@0.0.0`))
    })
  }
}

it("a bare runtime import keeps Symbol.customMatcher initialization", async (t) => {
  const root = await fixture(t)
  const result = await bundle(root, `
    import "vibelang-runtime"
    console.log(typeof Symbol.customMatcher)
  `)
  assert.ok(Object.values(result.metafile.outputs).some((output) =>
    Object.entries(output.inputs).some(([path, input]) => path.endsWith("/dist/match.js") && input.bytesInOutput > 0)))
  const output = join(root, "bundle.mjs")
  await writeFile(output, result.outputFiles[0].text)
  const ran = spawnSync(process.execPath, [output], { encoding: "utf8", timeout: 10_000 })
  assert.equal(ran.signal, null)
  assert.equal(ran.status, 0, ran.stderr)
  assert.equal(ran.stdout.trim(), "symbol")
})
