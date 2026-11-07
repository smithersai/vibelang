import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import fc from "fast-check"
import vibelang from "../src/index.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const chapter = "428-part4-ch28-tooling.md"
const quote = "the Vite plugin always serves them"
const cacheQuote = "directories, the installed packages, and every file the compile read are\nunchanged"

test("cache event rules remain quoted", () => {
  const spec = readFileSync(SpecPath(chapter), "utf8")
  for (const text of [quote, cacheQuote]) assert.ok(spec.includes(text), text)
})

test("compiler cache entries leave maps intact while input changes invalidate", async () => {
  async function check({ hash, directory, event }) {
    const root = await mkdtemp(join(tmpdir(), "vibelang-cache-watch-"))
    const previous = process.env.VIBELANG_CACHE_DIR
    const cache = join(root, directory)
    process.env.VIBELANG_CACHE_DIR = cache
    let plugin
    try {
      const source = join(root, "main.vibe")
      await writeFile(source, "export const answer = 42\n")
      await writeFile(join(root, "package.json"), '{"type":"module"}')
      const backend = join(root, "node_modules/vibelang")
      await mkdir(backend, { recursive: true })
      await writeFile(join(backend, "package.json"),
        JSON.stringify({ type: "module", exports: { "./project": "./project.mjs" } }))
      await writeFile(join(backend, "project.mjs"), [
        "export let invalidations = 0",
        "export const findCompiler = () => 'unused'",
        "export const projects = () => ({",
        "invalidate() { invalidations++ }, close: async () => {},",
        "load: async () => ({ project: 'tsconfig.json', code: 'export const answer = 42',",
        "map: { version: 3, sources: [], names: [], mappings: '' }, errors: [], warnings: [] }) })"
      ].join("\n"))
      const state = await import(pathToFileURL(join(backend, "project.mjs")).href)
      plugin = vibelang()
      plugin.configResolved({ root, command: "serve", logger: { warn: assert.fail } })
      await plugin.load.call({ addWatchFile() {}, error: assert.fail }, source)
      const module = { id: source, file: source, importers: new Set(), transformResult: { map: "retained" } }
      let invalidated = 0
      const graph = {
        idToModuleMap: new Map([[source, module]]),
        invalidateModule(value) { invalidated++; value.transformResult = undefined }
      }
      const environment = { name: "ssr", moduleGraph: graph, hot: { send: assert.fail } }
      async function update(file) {
        plugin.watchChange(file)
        const context = {
          type: event, file, modules: [],
          server: { moduleGraph: graph, ws: environment.hot, config: { logger: { error: assert.fail } } }
        }
        await plugin.hotUpdate.call({ environment }, context)
        await plugin.handleHotUpdate(context)
      }
      await update(join(cache, hash + ".json"))
      assert.equal(invalidated, 0, "cache metadata must retain the loaded module's map")
      assert.equal(state.invalidations, 0, "cache output is not a compile input")
      assert.ok(module.transformResult)
      // A common prefix is not containment, and ordinary JSON remains input.
      for (const file of [
        join(cache + "-other", hash + ".json"), join(cache, "tsconfig.json"),
        join(cache, hash.slice(1) + ".json"), join(cache, hash + "0.json")
      ]) {
        const before = invalidated
        await update(file)
        assert.ok(invalidated > before, "real JSON changes still invalidate")
      }
      delete process.env.VIBELANG_CACHE_DIR
      const before = invalidated
      await update(join(cache, hash + ".json"))
      assert.ok(invalidated > before, "without a configured cache the file remains input")
    } finally {
      if (previous === undefined) delete process.env.VIBELANG_CACHE_DIR
      else process.env.VIBELANG_CACHE_DIR = previous
      await plugin?.closeBundle()
      await rm(root, { recursive: true, force: true })
    }
  }
  await checkProperty(fc, {
    name: "vite-cache-watch-maps", rule: chapter + ": Debugging, D299",
    command: "node --test test/cache-watch.property.test.mjs",
    arbitrary: fc.record({
      hash: fc.array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"), { minLength: 32, maxLength: 32 }).map(x => x.join("")),
      directory: fc.constantFrom("", "cache", "cache space", "cache%25", "nested/cache", "nested/../cache"),
      event: fc.constantFrom("create", "update", "delete")
    }),
    regressions: new URL("./property-regressions/", import.meta.url), numRuns: 24, check
  })
})
