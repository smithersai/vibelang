import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import fc from "fast-check"

const runtime = fileURLToPath(new URL("../../runtime/", import.meta.url))
const services = ["Animations", "AudioContext", "Request", "Crypto", "Document", "FileReader", "Info", "Locks", "MediaQuery", "ResizeObserver", "Window", "Headers"]
const serviceModule = name => name === "Info" ? "BrowserInfo" : name
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}

test("packed browser layers retain only selected services across barrel import forms", { timeout: 120_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-layer-bundle-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const installed = join(root, "node_modules/vibelang-runtime")
  mkdirSync(installed, { recursive: true })
  const [packed] = JSON.parse(run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", root], runtime))
  run("tar", ["-xzf", join(root, packed.filename), "--strip-components=1", "-C", installed], root)
  const bundle = async ({ selected, namespace = false, minify = false }) => {
    const names = selected.map(name => "ExperimentalBrowser" + name)
    const specifier = "vibelang-runtime/experimental/platform-browser"
    const source = namespace
      ? `import * as platform from "${specifier}"; console.log(${names.map(name => "platform." + name + ".layer").join(",")})`
      : `import { ${names.join(",")} } from "${specifier}"; console.log(${names.map(name => name + ".layer").join(",")})`
    const result = await build({
      absWorkingDir: root, stdin: { contents: source, resolveDir: root },
      bundle: true, write: false, format: "esm", platform: "browser", minify, metafile: true,
      // Keep Effect external so the oracle measures the runtime's module graph.
      external: ["effect", "effect/*", "@effect/*"]
    })
    return new Set(Object.entries(Object.values(result.metafile.outputs)[0].inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([path]) => path.replaceAll("\\", "/")))
  }
  const retains = (modules, name) => [...modules].some(path => path.endsWith("/dist/experimental/" + serviceModule(name) + ".js"))
  const check = async input => {
    const modules = await bundle(input)
    for (const name of services) {
      assert.equal(retains(modules, name), input.selected.includes(name) || input.selected.includes("Services"),
        `${name} must be retained exactly when selected: ${JSON.stringify(input)}; modules: ${[...modules].join(", ")}`)
    }
  }
  const witness = JSON.parse(readFileSync(new URL("./property-regressions/lang-site-browser-request.json", import.meta.url), "utf8"))
  await check(witness.input)
  for (const name of services) await check({ selected: [name] })
  await check({ selected: ["Services"] })
  await fc.assert(fc.asyncProperty(fc.record({
    selected: fc.subarray(services, { minLength: 1, maxLength: 4 }),
    namespace: fc.boolean(),
    minify: fc.boolean()
  }), check), { seed: 731058, numRuns: 24 })
  // Recreate the reported package metadata in this isolated consumer. This
  // control proves the module-id oracle catches retention of unrelated layers.
  const manifestFile = join(installed, "package.json")
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  delete manifest.sideEffects
  writeFileSync(manifestFile, JSON.stringify(manifest))
  const unpruned = await bundle(witness.input)
  assert.ok(retains(unpruned, "Animations"), "the original metadata must reproduce unrelated layer retention")
})
