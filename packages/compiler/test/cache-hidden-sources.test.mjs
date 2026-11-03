import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { projectCache } from "../cache.mjs"

// foldkit-17074: TypeScript's wildcards skip a dotted name unless the pattern
// itself writes the dot, as `.source-collector-*.vibe` does. The cache must see
// what the compile would read, in both directions.
async function warm(t, config, files) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-cache-hidden-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const app = join(root, "app")
  mkdirSync(join(app, "src"), { recursive: true })
  const project = join(app, "tsconfig.json")
  writeFileSync(project, JSON.stringify(config))
  const old = new Date(Date.now() - 10000)
  const inputs = []
  for (const name of files) {
    const path = join(app, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "export const value = 1\n")
    utimesSync(path, old, old)
    inputs.push(path)
  }
  // Every directory's stamp is old, so a later listing is what decides.
  for (const directory of new Set(files.map((name) => dirname(join(app, name))))) utimesSync(directory, old, old)
  await sleep(120) // The ordinary file timestamp safety margin.
  const cache = projectCache({ project, root: app, compiler: process.execPath, cache: { directory: join(root, "cache") }, debug: () => {} })
  cache.store(cache.begin(), { outputs: new Map(), errors: [], warnings: [] }, inputs)
  assert.ok(cache.lookup().result, "the controlled compile hits its cache")
  return {
    cache,
    add(name) {
      const path = join(app, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, "export const added = 43\n")
    }
  }
}

const seen = [
  // [include, existing file, added file]
  [["src/.source-collector-*.vibe"], "src/.source-collector-anchor.vibe", "src/.source-collector-added.vibe"],
  [[".source-collector-*.vibe"], ".source-collector-anchor.vibe", ".source-collector-added.vibe"],
  [["src/.*"], "src/.anchor.vibe", "src/.added.vibe"],
  [["src/.?nchor.vibe", "src/.?dded.vibe"], "src/.anchor.vibe", "src/.added.vibe"],
  [["src/.*/*.vibe"], "src/.gen/anchor.vibe", "src/.gen/added.vibe"],
  [["src/.*/*.vibe"], "src/.gen/anchor.vibe", "src/.other/added.vibe"],
  // The compile reads this one, so a repository's folder gets no exception.
  [["src/.*/*.vibe"], "src/.gen/anchor.vibe", "src/.jj/added.vibe"],
  [["src/main.vibe", "src/.literal.vibe"], "src/main.vibe", "src/.literal.vibe"],
  [["src/**/.h-*.vibe"], "src/a/.h-anchor.vibe", "src/a/.h-added.vibe"],
  // A visible control under each hidden pattern, and a dotted literal parent.
  [["src/.h-*.vibe", "src/*.vibe"], "src/main.vibe", "src/added.vibe"],
  [[".config/**/*.vibe"], ".config/a/anchor.vibe", ".config/a/added.vibe"],
]
for (const [include, anchor, added] of seen) {
  test(`include ${JSON.stringify(include)} sees ${added}`, async (t) => {
    const { cache, add } = await warm(t, { include }, [anchor])
    add(added)
    assert.ok(cache.lookup().miss, "a file the compile would read changes the project")
  })
}

const unseen = [
  // The compile skips these, so they must not cost a recompile.
  [["src"], "src/main.vibe", "src/.hidden.vibe"],
  [["src/*.vibe"], "src/main.vibe", "src/.hidden.vibe"],
  [["src/**/*"], "src/a/main.vibe", "src/a/.hidden.vibe"],
  [["src/**/*"], "src/a/main.vibe", "src/.hidden/added.vibe"],
  [[".config/**/*.vibe"], ".config/a/anchor.vibe", ".config/a/.hidden.vibe"],
  // A hidden file that cannot enter a program.
  [["src/.*"], "src/.anchor.vibe", "src/.notes.txt"],
]
for (const [include, anchor, added] of unseen) {
  test(`include ${JSON.stringify(include)} ignores ${added}`, async (t) => {
    const { cache, add } = await warm(t, { include }, [anchor])
    add(added)
    const hit = cache.lookup()
    assert.ok(hit.result, "needless recompile: " + hit.miss)
  })
}

test("a project with vibe.sidecarDir sees an added hidden source too", async (t) => {
  const { cache, add } = await warm(t, { include: ["src/.c-*.vibe"], vibe: { sidecarDir: ".vibe/d" } }, ["src/.c-anchor.vibe"])
  add("src/.c-added.vibe")
  assert.ok(cache.lookup().miss)
})

test("a project with vibe.sidecarDir and no hidden pattern ignores a hidden file", async (t) => {
  const { cache, add } = await warm(t, { include: ["src"], vibe: { sidecarDir: ".vibe/d" } }, ["src/main.vibe"])
  add("src/.hidden.vibe")
  assert.ok(cache.lookup().result)
})

test("hidden pattern, hidden name and directory agree with the compile", async () => {
  await checkProperty(fc, {
    name: "cache-hidden-sources",
    rule: "foldkit-17074: a warm loader observes every included addition, as a cold compile does",
    command: "node --test test/cache-hidden-sources.test.mjs",
    numRuns: 25,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      prefix: fc.constantFrom(".source-collector-", ".a", ".with.dot-", ".Ω-", "..double-"),
      suffix: fc.integer({ min: 0, max: 999 }),
      extension: fc.constantFrom(".vibe", ".ts", ".mts", ".json"),
      directory: fc.constantFrom("src", "src/nested", "."),
      hiddenPattern: fc.boolean(),
    }),
    check: async ({ prefix, suffix, extension, directory, hiddenPattern }) => {
      let cleanup = () => {}
      try {
        const include = [hiddenPattern ? `${directory}/${prefix}*${extension}` : `${directory}/*${extension}`]
        const anchor = `${directory}/${hiddenPattern ? prefix + "anchor" : "anchor"}${extension}`
        const { cache, add } = await warm({ after: (fn) => { cleanup = fn } }, { include }, [anchor])
        add(`${directory}/${prefix}${suffix}${extension}`)
        const found = cache.lookup()
        assert.equal(Boolean(found.result), !hiddenPattern, found.miss ?? "unexpected hit")
      } finally { cleanup() }
    }
  })
})
