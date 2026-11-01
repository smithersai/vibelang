import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import vibelang from "../src/index.js"

// The backend is deliberately observable: ignored output events must neither
// invalidate its compile nor clear the served module and its importer.
async function checkEvent({ directories = [], stem = "main", extension = ".d.vibe.ts", companion = true }) {
  const root = await mkdtemp(join(tmpdir(), "vibelang-vite-sidecars-"))
  let plugin
  try {
    const backend = join(root, "node_modules/vibelang")
    await mkdir(backend, { recursive: true })
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await writeFile(join(backend, "package.json"), JSON.stringify({ name: "vibelang", type: "module", exports: { "./project": "./project.mjs" } }))
    await writeFile(join(backend, "project.mjs"), `
export const stats = { loads: 0, invalidations: 0 }
export const findCompiler = () => "unused"
export const projects = () => ({
  invalidate() { stats.invalidations++ },
  async load() { stats.loads++; return { project: "tsconfig.json", code: "export const value = 1", map: null, errors: [], warnings: [] } },
  async close() {}
})
`)
    const source = join(root, "served.vibe")
    const event = join(root, ...directories, stem + extension)
    await mkdir(dirname(event), { recursive: true })
    await writeFile(source, "export const value = 1")
    await writeFile(event, "// changed")
    if (companion) await writeFile(join(root, ...directories, stem + ".vibe"), "export const value = 2")
    const { stats } = await import(pathToFileURL(join(backend, "project.mjs")).href)
    plugin = vibelang()
    plugin.configResolved({ root, logger: { warn() {} } })
    await plugin.transform.call({ addWatchFile() {} }, "", source)
    const importer = { file: join(root, "entry.ts"), importers: new Set(), transformResult: {} }
    const served = { file: source, importers: new Set([importer]), transformResult: {} }
    const invalidated = []
    const context = { file: event, modules: [], server: {
      moduleGraph: { idToModuleMap: new Map([[source, served]]), invalidateModule(module) { invalidated.push(module.file); module.transformResult = null } }
    } }
    plugin.watchChange(event)
    await plugin.handleHotUpdate(context)
    // Only a declaration with its owning source is compiler output. An
    // independently authored TS declaration still affects source contracts.
    const generated = extension === ".d.vibe.ts" && companion
    const input = extension !== ".txt" && !generated
    assert.equal(stats.invalidations, input ? 2 : 0, JSON.stringify({ event, companion, stats }))
    assert.equal(stats.loads, input ? 2 : 1)
    assert.deepEqual(invalidated, input ? [source, importer.file] : [])
    assert.equal(importer.transformResult === null, input)
  } finally {
    await plugin?.closeBundle()
    await rm(root, { recursive: true, force: true })
  }
}

test("compiler declaration sidecars do not invalidate the served graph", () => checkEvent({}))
test("an authored declaration without a VibeLang companion still invalidates", () => checkEvent({ companion: false }))
test("generated-sidecar neighbourhood", async () => {
  await checkProperty(fc, {
    name: "vite-generated-sidecars", numRuns: 100,
    rule: "docs/user/src/setup/vite.md: Generated declarations; only source changes invalidate served modules and their importers",
    command: "node --test test/generated-sidecars.test.mjs",
    arbitrary: fc.record({
      directories: fc.array(fc.constantFrom("src", "nested", "with spaces", "name.with.dots"), { maxLength: 3 }),
      stem: fc.constantFrom("main", "a.b", "with space", "component.test"),
      extension: fc.constantFrom(".d.vibe.ts", ".d.ts", ".ts", ".tsx", ".mts", ".cts", ".json", ".vibe", ".txt"),
      companion: fc.boolean()
    }), check: checkEvent
  })
})
