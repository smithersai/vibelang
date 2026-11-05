import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { matchesGlob } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { loadTypeScript } from "../lib/declarations.mjs"
import { addCoverageSelectors } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-secrets-module-body-coverage.json", import.meta.url)))
const config = (include, exclude) => "export default defineConfig({ test: { coverage: { include: " + JSON.stringify(include) + (exclude === undefined ? "" : ", exclude: " + JSON.stringify(exclude)) + " } } })"
const coverage = text => runInNewContext(text.replace(/^import .*\n/m, "").replace("export default", "result ="), { defineConfig: value => value }).test.coverage
const selected = (file, options) => options.include.some(glob => matchesGlob(file, glob)) && !(options.exclude ?? []).some(glob => matchesGlob(file, glob))

test("Smithers inline platform declarations do not become uncovered implementation files", () => {
  const before = coverage(corpus.config)
  assert.equal(selected(corpus.generatedDeclaration, before), true)
  const output = addCoverageSelectors(corpus.config, ts), after = coverage(output)
  assert.equal(selected(corpus.generatedDeclaration, after), false)
  assert.equal(selected(corpus.sourceFile, after), true)
  assert.equal(selected(corpus.implementation, after), true)
  assert.equal(JSON.stringify(after.thresholds), JSON.stringify(before.thresholds))
  assert.equal(after.enabled, true)
  assert.equal(after.provider, "v8")
  assert.equal(addCoverageSelectors(output, ts), output)
})

test("all module names exclude only declarations and preserve authored implementation coverage", () => {
  const identifier = fc.array(fc.constantFrom(..."abcXYZ09_$"), { minLength: 1, maxLength: 18 }).map(parts => "m" + parts.join(""))
  fc.assert(fc.property(identifier, identifier, fc.constantFrom("vibe", "vibex"),
    fc.constantFrom("src", "src/nested", "src/deeper/nested"),
    fc.constantFrom(undefined, [], ["src/ignored/**"], ["**/*.d.vibe.ts"]), (stem, body, extension, dir, exclude) => {
      const text = config(["src/**/*.{ts,vibe,vibex}"], exclude)
      const output = addCoverageSelectors(text, ts), options = coverage(output)
      const base = dir + "/" + stem
      assert.equal(selected(base + "." + extension + "." + body + ".d.ts", options), false)
      for (const suffix of [".ts", ".vibe", ".vibex", ".platform.ts", "." + extension + "." + body + ".ts"]) assert.equal(selected(base + suffix, options), true, suffix)
      assert.equal(addCoverageSelectors(output, ts), output)
      for (const glob of exclude ?? []) assert.ok(options.exclude.includes(glob))
    }), { seed: 440204, numRuns: 200 })
})
