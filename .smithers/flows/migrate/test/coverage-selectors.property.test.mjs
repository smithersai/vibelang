import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, matchesGlob } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { addCoverageSelectors, widenCoverageGlob, wireVite } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-vitest-coverage-selectors.json", import.meta.url), "utf8"))

test("foldkit-145: foldkit's coverage block keeps .vibe modules and drops sidecars", () => {
  assert.equal(addCoverageSelectors(corpus.before, ts), corpus.after)
  assert.equal(addCoverageSelectors(corpus.after, ts), corpus.after, "a second setup changes nothing")
})

test("setup wires the selectors into the config the tests load", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-coverage-"))
  try {
    mkdirSync(join(root, "packages/a"), { recursive: true })
    writeFileSync(join(root, "packages/a/package.json"), JSON.stringify({ name: "a", scripts: { test: "vitest run" } }))
    writeFileSync(join(root, "packages/a/vitest.config.ts"), corpus.before)
    wireVite({ root, packages: [{ dir: "packages/a" }], test: { cwd: ".", command: "pnpm -r test" }, ts, specsFor: () => ({ vibelang: "0", "vibelang-vite": "0" }) })
    const wired = readFileSync(join(root, "packages/a/vitest.config.ts"), "utf8")
    assert.match(wired, /include: \['src\/\*\*\/\*\.\{ts,vibe\}'\]/)
    assert.match(wired, /'\*\*\/\*\.d\.vibe\.ts'\]/)
    assert.match(wired, /vibelang/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const stem = fc.constantFrom("src/**/*", "**/*", "packages/*/src/**/*", "src/*", "lib/a*")
const extensions = fc.constantFrom(".ts", ".{ts,tsx}", ".{js,ts}", ".{ts,js,tsx}")

test("a widened glob selects what it did, and the .vibe twin of each .ts it selected", () => {
  fc.assert(fc.property(stem, extensions, fc.constantFrom("src/a", "src/deep/a", "packages/p/src/a", "lib/a1"), (head, extension, file) => {
    const before = head + extension, after = widenCoverageGlob(before)
    for (const path of [file + ".ts", file + ".tsx", file + ".js", file + ".css"]) assert.equal(matchesGlob(path, after), matchesGlob(path, before), path)
    assert.equal(matchesGlob(file + ".vibe", after), matchesGlob(file + ".ts", before), file)
    assert.equal(widenCoverageGlob(after), after)
  }), { seed: 145145, numRuns: 200 })
})

test("globs with nothing to widen stay", () => {
  for (const glob of ["src/a.ts", "src/**/*.js", "src/**/*.{js,jsx}", "src/**/*.vibe", "src/**/*.{ts,vibe}", "src/**/*.d.ts", "!src/**/*.ts", "src/**/*.mts"]) assert.equal(widenCoverageGlob(glob), glob)
})

const config = (coverage) => `import { defineConfig } from "vitest/config"\nexport default defineConfig({ test: { ${coverage} } })\n`

test("every config shape: exclude added, appended, or left; other options untouched", () => {
  const out = (coverage) => addCoverageSelectors(config(coverage), ts)
  assert.equal(out('coverage: { include: ["src/**/*.ts"] }'), config('coverage: { include: ["src/**/*.{ts,vibe}"], exclude: ["**/*.d.vibe.ts"] }'))
  assert.equal(out('coverage: { include: ["src/**/*.ts"], exclude: [] }'), config('coverage: { include: ["src/**/*.{ts,vibe}"], exclude: ["**/*.d.vibe.ts"] }'))
  for (const same of ["", "coverage: { provider: 'v8' }", 'coverage: { include: ["src/**/*.js"] }', "include: ['src/**/*.test.ts']", "coverage: shared"]) assert.equal(out(same), config(same), same)
  assert.equal(addCoverageSelectors("export default {}\n", ts), "export default {}\n")
  assert.throws(() => out("coverage: { include: globs }"), /coverage\.include is not an array literal/)
  assert.throws(() => out('coverage: { include: ["src/**/*.ts"], exclude: shared }'), /coverage\.exclude is not an array literal/)
})

test("a config the edit refuses still gets its plugin, with a warning", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-coverage-"))
  try {
    mkdirSync(join(root, "a"))
    writeFileSync(join(root, "a/package.json"), JSON.stringify({ name: "a" }))
    writeFileSync(join(root, "a/vitest.config.ts"), config("coverage: { include: globs }"))
    const { warnings } = wireVite({ root, packages: [{ dir: "a" }], test: { cwd: ".", command: "pnpm -r test" }, ts, specsFor: () => ({ vibelang: "0", "vibelang-vite": "0" }) })
    assert.match(warnings.join("\n"), /coverage\.include is not an array literal/)
    assert.match(readFileSync(join(root, "a/vitest.config.ts"), "utf8"), /vibelang/)
    assert.match(readFileSync(join(root, "a/package.json"), "utf8"), /vibelang-vite/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
