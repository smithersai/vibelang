import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { buildInventory } from "../lib/inventory.mjs"
import { candidates, validatePlan } from "../lib/plan.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-smoke-fixture-effect-import.json", import.meta.url), "utf8"))
const quote = "TypeScript's meaning outside Effect code"
const policy = "So does a file with no Effect code."

test("fixture import classification quotes the language and migration policy", () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/src/000-intro.md", import.meta.url), "utf8").includes(quote))
  assert.ok(readFileSync(new URL("../rules.md", import.meta.url), "utf8").includes(policy))
})

function check(source, file, control = "none") {
  const root = mkdtempSync(join(tmpdir(), "migrate-fixture-effect-"))
  try {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    const extra = control === "values" ? '\nimport * as Effect from "effect/Effect"\n' :
      control === "types" ? '\nimport type * as Effect from "effect/Effect"\n' : ""
    writeFileSync(join(root, file), source + extra)
    const inventory = buildInventory({ root, packages: [{ dir: ".", sources: ["."] }] })
    assert.equal(inventory.files.length, 1)
    assert.equal(inventory.files[0].effect, control)
    assert.deepEqual(inventory.files[0].effectImports, control === "none" ? [] : ["effect/Effect"])
    assert.equal(candidates(inventory).length, control === "values" ? 1 : 0)
    const plan = { batches: [{ files: [file], reason: "convert selected source" }] }
    const result = validatePlan(plan, inventory)
    if (control === "none") {
      assert.equal(result.errors.length, 1)
      assert.match(result.errors[0], /has no Effect code/)
    } else assert.deepEqual(result.errors, [])
    assert.equal(readFileSync(join(root, file), "utf8"), source + extra)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit-114: an Effect import in a smoke fixture leaves its platform script in TypeScript", () => {
  check(corpus.source, corpus.path)
  for (const control of ["values", "types"]) check(corpus.source, corpus.path, control)
})

test("fixture classification spans strings, templates, comments, imports and nested script paths", () => {
  fc.assert(fc.property(fc.record({
    kind: fc.constantFrom("double", "single", "template", "line-comment", "block-comment"),
    module: fc.constantFrom("effect", "effect/Effect", "@effect/platform-node"),
    depth: fc.integer({ min: 0, max: 3 }),
    name: fc.constantFrom("smoke", "check-create-foldkit-app-smoke", "Unicodeé"),
    control: fc.constantFrom("none", "values", "types"),
  }), input => {
    const fixture = 'import { Effect } from "' + input.module + '";'
    const literal = input.kind === "double" ? JSON.stringify(fixture) :
      input.kind === "single" ? "'" + fixture + "'" :
      input.kind === "template" ? "`" + fixture + "`" : undefined
    const source = 'import { writeFileSync } from "node:fs"\n' + (literal ?
      "const fixture = " + literal + '\nwriteFileSync("fixture.ts", fixture)\n' :
      (input.kind === "line-comment" ? "// " + fixture : "/* " + fixture + " */") + "\nexport const count = 1\n")
    const file = ["scripts", ...Array.from({ length: input.depth }, (_, i) => "d" + i), input.name + ".ts"].join("/")
    check(source, file, input.control)
  }), { seed: 11417063, numRuns: 120, endOnFailure: true })
})
