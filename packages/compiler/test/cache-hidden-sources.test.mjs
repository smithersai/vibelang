import { strict as assert } from "node:assert"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { ageDirectories, cacheProject, skip } from "./cache-harness.mjs"

// foldkit-17074: TypeScript's wildcards skip a dotted name unless the pattern
// itself writes the dot, as `.source-collector-*.vibe` does. The cache must see
// what the compile would read, in both directions. Each case compiles a real
// project, adds a file, and checks the cache against the compiler's own
// listing: the addition causes a recompile exactly when --listFilesOnly lists it.
const text = (name, value) => name.endsWith(".json") ? JSON.stringify({ value }) + "\n" : `export const value${value} = ${value}\n`

async function differential(t, config, anchor, added) {
  const project = cacheProject(t, { [anchor]: text(anchor, 1) }, config)
  ageDirectories(project.app)
  await project.settle()
  const cold = project.compile()
  assert.deepEqual(cold.result.errors, [], "the fixture compiles")
  assert.ok(cold.compiled)
  assert.ok(project.entry.lookup().result, "the compile was cached: " + cold.messages.join("\n"))
  project.write(added, text(added, 2))
  const listed = project.listed().has(join(project.app, added))
  const warm = project.compile()
  assert.equal(warm.compiled, listed, listed
    ? `the compiler reads ${added}, and the cache served the stale program`
    : `the compiler does not read ${added}, and the cache recompiled: ${warm.messages.join("\n")}`)
  return listed
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
  test(`include ${JSON.stringify(include)} sees ${added}`, { skip }, async (t) => {
    assert.equal(await differential(t, { include }, anchor, added), true, "the compiler lists the added file")
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
  test(`include ${JSON.stringify(include)} ignores ${added}`, { skip }, async (t) => {
    assert.equal(await differential(t, { include }, anchor, added), false, "the compiler skips the added file")
  })
}

test("a project with vibe.sidecarDir sees an added hidden source too", { skip }, async (t) => {
  const config = { include: ["src/.c-*.vibe"], vibe: { sidecarDir: ".vibe/d" } }
  assert.equal(await differential(t, config, "src/.c-anchor.vibe", "src/.c-added.vibe"), true)
})

test("a project with vibe.sidecarDir and no hidden pattern ignores a hidden file", { skip }, async (t) => {
  const config = { include: ["src"], vibe: { sidecarDir: ".vibe/d" } }
  assert.equal(await differential(t, config, "src/main.vibe", "src/.hidden.vibe"), false)
})

test("hidden pattern, hidden name and directory agree with the compile", { skip }, async () => {
  await checkProperty(fc, {
    name: "cache-hidden-sources",
    rule: "foldkit-17074: a warm loader observes every included addition, as a cold compile does",
    command: "node --test test/cache-hidden-sources.test.mjs",
    numRuns: 12,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      prefix: fc.constantFrom(".source-collector-", ".a", ".with.dot-", ".Ω-", "..double-"),
      suffix: fc.integer({ min: 0, max: 999 }),
      extension: fc.constantFrom(".vibe", ".ts", ".mts", ".json"),
      directory: fc.constantFrom("src", "src/nested", "."),
      hiddenPattern: fc.boolean(),
    }),
    check: async ({ prefix, suffix, extension, directory, hiddenPattern }) => {
      const cleanups = []
      try {
        const include = [hiddenPattern ? `${directory}/${prefix}*${extension}` : `${directory}/*${extension}`]
        const anchor = `${directory}/${hiddenPattern ? prefix + "anchor" : "anchor"}${extension}`
        const listed = await differential({ after: (fn) => cleanups.push(fn) }, { include }, anchor, `${directory}/${prefix}${suffix}${extension}`)
        assert.equal(listed, hiddenPattern, "only a pattern that writes the dot reads a dotted name")
      } finally { for (const cleanup of cleanups) cleanup() }
    }
  })
})
