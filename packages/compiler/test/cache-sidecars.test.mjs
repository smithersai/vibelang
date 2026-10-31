import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { projectCache } from "../cache.mjs"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

async function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-cache-sidecars-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const app = join(root, "app")
  const directory = join(app, "src")
  mkdirSync(directory, { recursive: true })
  const project = join(app, "tsconfig.json")
  writeFileSync(project, JSON.stringify({ include: ["src"] }))
  const old = new Date(Date.now() - 10000)
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name)
    writeFileSync(path, content)
    utimesSync(path, old, old)
  }
  // Force listing validation after subsequent mutations even on coarse clocks.
  utimesSync(directory, old, old)
  const messages = []
  await sleep(120) // The ordinary file timestamp safety margin.
  const cache = projectCache({
    project, root: app, compiler: process.execPath,
    cache: { directory: join(root, "cache") }, debug: (message) => messages.push(message)
  })
  const store = (snapshot, inputs) => {
    cache.store(snapshot, { outputs: new Map(), errors: [], warnings: [] }, inputs.map((name) => join(directory, name)))
    assert.equal(existsSync(cache.file), true, "the controlled compile was cached: " + messages.join("\n"))
  }
  return { directory, cache, store }
}

test("new sidecars beside their sources do not invalidate a successful compile", async (t) => {
  const { directory, cache, store } = await fixture(t, { "main.vibe": "export const value = 1\n" })
  const snapshot = cache.begin()
  const sidecar = join(directory, "main.d.vibe.ts")
  writeFileSync(sidecar, "export declare const value = 1;\n")
  store(snapshot, ["main.vibe"])
  assert.ok(cache.lookup().result, "a generated sidecar is an output")
  writeFileSync(sidecar, "export declare const value: number;\n")
  assert.ok(cache.lookup().result, "rewriting the generated output preserves the cache")
  unlinkSync(sidecar)
  assert.ok(cache.lookup().result, "removing the generated output preserves the cache")
})

test("an orphan declaration sidecar added during a compile invalidates its directory snapshot", async (t) => {
  const { directory, cache, store } = await fixture(t, { "main.ts": "export const value = 1\n" })
  const snapshot = cache.begin()
  writeFileSync(join(directory, "external.d.vibe.ts"), "export declare const external: number;\n")
  store(snapshot, ["main.ts"])
  assert.match(cache.lookup().miss, /gained or lost a file/)
})

test("removing a sidecar's source still invalidates the cache", async (t) => {
  const { directory, cache, store } = await fixture(t, {
    "main.vibe": "export const value = 1\n",
    "main.d.vibe.ts": "export declare const value = 1;\n"
  })
  store(cache.begin(), ["main.vibe"])
  assert.ok(cache.lookup().result)
  unlinkSync(join(directory, "main.vibe"))
  assert.ok(cache.lookup().miss, "the remaining sidecar does not hide a source deletion")
})

test("an orphan sidecar read by the compiler remains a content dependency", async (t) => {
  const { directory, cache, store } = await fixture(t, {
    "main.ts": "export const value = 1\n",
    "external.d.vibe.ts": "export declare const external: number;\n"
  })
  store(cache.begin(), ["main.ts", "external.d.vibe.ts"])
  assert.ok(cache.lookup().result)
  writeFileSync(join(directory, "external.d.vibe.ts"), "export declare const external: string | undefined;\n")
  assert.match(cache.lookup().miss, /external\.d\.vibe\.ts changed/)
})

// VIP-27: "`x.d.vibe.ts` is written next to each `x.vibe`" (0027-declaration-output.md).
// Metamorphic: generated declarations are outputs; their bytes and presence
// cannot change a cached compilation of the corresponding unchanged source.
test("cache-generated-sidecars", async () => {
  await checkProperty(fc, {
    name: "cache-generated-sidecars",
    rule: "docs/design/vips/0027-declaration-output.md: Location; paired declaration sidecars are outputs",
    command: "node --test test/cache-sidecars.test.mjs",
    numRuns: 25,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      stem: fc.tuple(fc.constantFrom("main", "with.dot", "under_score", "dash-name", "Ω"), fc.integer({ min: 0, max: 1000 })).map(([prefix, n]) => prefix + n),
      linked: fc.boolean(),
      mutations: fc.array(fc.record({ remove: fc.boolean(), text: fc.string({ maxLength: 48 }) }), { minLength: 1, maxLength: 5 })
    }),
    check: async ({ stem, linked, mutations }) => {
      let cleanup
      const source = stem + ".vibe"
      const { directory, cache, store } = await fixture({ after: fn => { cleanup = fn } }, {
        [source]: "export const value = 1\n"
      })
      try {
        if (linked) {
          const target = join(directory, ".source-target")
          writeFileSync(target, "export const value = 1\n")
          unlinkSync(join(directory, source))
          symlinkSync(target, join(directory, source))
          await sleep(120)
        }
        const old = new Date(Date.now() - 10000)
        utimesSync(directory, old, old)
        const snapshot = cache.begin()
        const sidecar = join(directory, stem + ".d.vibe.ts")
        writeFileSync(sidecar, "export declare const value: number;\n")
        store(snapshot, [source])
        let hit = cache.lookup()
        assert.ok(hit.result, "new paired sidecar invalidated cache: " + hit.miss)
        for (const mutation of mutations) {
          if (mutation.remove) {
            if (existsSync(sidecar)) unlinkSync(sidecar)
          } else writeFileSync(sidecar, mutation.text)
          hit = cache.lookup()
          assert.ok(hit.result, "paired output mutation invalidated cache: " + hit.miss)
        }
      } finally { cleanup() }
    }
  })
})
