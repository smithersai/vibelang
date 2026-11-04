import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import { unplugin } from "../src/index.js"

const quote = "A `.vibex` file is a `.vibe` file read with TypeScript's JSX language variant."
const frameworks = ["vite", "rollup", "rolldown", "webpack", "rspack", "esbuild"]
const hooks = frameworks.map(framework => [framework, unplugin.raw({}, { framework }).loadInclude])

test("VIP-39 bundler source oracle quotes the file-kind contract", () => {
  assert.ok(readFileSync(SpecPath("../vips/0039-vibex.md"), "utf8").includes(quote))
})

test("VIP-39 actual loadInclude accepts the JSX source witness", () => {
  for (const [framework, include] of hooks) {
    assert.equal(include("/app/Card.vibex"), true, framework)
    assert.equal(include("/app/Card.vibex?import"), true, framework)
    assert.equal(include("/app/Card.vibe"), true, framework)
    for (const suffix of [".tsx", ".js", ".d.vibex.ts", ".vibex.map", ".vibexx"]) {
      assert.equal(include("/app/Card" + suffix), false, framework + suffix)
    }
  }
})

test("VIP-39 generated module IDs retain source suffix boundaries before queries", () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom("a", "Z", "0", "雪", " ", ".", "-", "_"), { minLength: 1, maxLength: 24 }),
    fc.constantFrom("src/", "/app/", "/nested/components/", "C:/app/"),
    fc.constantFrom(".vibe", ".vibex", ".tsx", ".d.vibex.ts", ".vibex.map", ".vibexx"),
    fc.constantFrom("", "?import", "?v=1", "?raw&file=Other.vibex", "?file=Other.vibe"),
    (letters, directory, suffix, query) => {
      const id = directory + letters.join("") + suffix + query
      const expected = suffix === ".vibe" || suffix === ".vibex"
      for (const [framework, include] of hooks) assert.equal(include(id), expected, framework + ": " + id)
    }
  ), { numRuns: 400, seed: 391239 })
})
