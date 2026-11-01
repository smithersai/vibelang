import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { buildInventory } from "../lib/inventory.mjs"
import { candidates, draftPlan, validatePlan, planPrompt } from "../lib/plan.mjs"
import { makeConfig, paths, report } from "../lib/steps.mjs"
import { writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-runtime-singleton-type-only.json", import.meta.url)))
async function check(modes, explicit) {
  const root = mkdtempSync(join(tmpdir(), "migrate-type-only-scope-"))
  try {
    const run = join(root, "run"), target = join(root, "repo")
    const put = (file, text) => { mkdirSync(dirname(join(target, file)), { recursive: true }); writeFileSync(join(target, file), text) }
    put("package.json", JSON.stringify({ private: true, type: "module" }))
    put(corpus.path, corpus.source)
    const typePaths = [corpus.path]
    for (const [i, mode] of modes.entries()) {
      const file = "src/type" + i + "." + mode.ext
      const clause = mode.inline ? '{ type Context as Ctx }' : 'type { Context as Ctx }'
      put(file, 'import ' + clause + ' from "effect"\nexport type Frame = { ctx: Ctx.Context<never> }\nexport const keep = (frame: Frame) => frame.ctx\n')
      typePaths.push(file)
    }
    put("src/value.ts", 'import { Effect, type Context } from "effect"\nexport const live = Effect.succeed(1)\n')
    put("src/plain.ts", "export const plain = 1\n")
    put("src/value.test.ts", 'import { Effect } from "effect"\nexport const testValue = Effect.succeed(1)\n')
    const inventory = buildInventory({ root: target, packages: [{ dir: ".", sources: ["src"] }] })
    const prompt = planPrompt({ inventory, draft: draftPlan(inventory), output: "plan.json" })
    assert.match(prompt, /Files whose Effect imports are all types stay TypeScript/)
    assert.equal(prompt.split("Files with no Effect code").length - 1, 1)
    assert.doesNotMatch(prompt, /\\n- Files/)
    const original = structuredClone(inventory)
    assert.deepEqual(candidates(inventory).map(f => f.path), ["src/value.ts"])
    assert.deepEqual(draftPlan(inventory).batches.flatMap(b => b.files), ["src/value.ts"])
    for (const file of typePaths) {
      const source = readFileSync(join(target, file), "utf8")
      const emitted = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText
      assert.doesNotMatch(emitted, /from ['"]effect|Context\.Context/, "the generated type-only source has no runtime Effect use")
    }
    const selected = ["src/value.ts", ...(explicit ? [corpus.path] : [])]
    const plan = { batches: [{ files: selected, reason: "value operations plus an explicit valid type-only selection" }] }
    const validation = validatePlan(plan, inventory)
    assert.deepEqual(validation.errors, [])
    assert.equal(validation.warnings.some(w => w.includes(corpus.path + " imports only Effect types")), explicit)
    assert.ok(validatePlan({ batches: [{ files: ["src/plain.ts"], reason: "invalid" }] }, inventory).errors.some(e => e.includes("no Effect code")))
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.setup, { tests: { passed: 1, failed: [], skipped: 0 } })
    writeJson(p.inventory, inventory)
    writeJson(p.plan, plan)
    const data = await report({ run })
    assert.ok(data.scope, "the report must expose ownership rather than silently losing retained files")
    assert.equal(data.scope.counts.owned, typePaths.length + 3)
    assert.equal(data.scope.counts.effectImports, typePaths.length + 2)
    assert.equal(data.scope.counts.automaticCandidates, 1)
    assert.deepEqual(data.scope.automaticCandidates, ["src/value.ts"])
    assert.deepEqual(data.scope.planned, [...selected].sort())
    assert.deepEqual(data.scope.retainedTypeOnly.map(f => f.path), typePaths.filter(f => !selected.includes(f)).sort())
    assert.ok(data.scope.retainedTypeOnly.every(f => f.reason === corpus.retainedReason))
    assert.deepEqual(data.scope.owned.map(f => f.path), inventory.files.map(f => f.path))
    assert.ok(data.scope.owned.find(f => f.path === "src/value.test.ts").test)
    assert.match(readFileSync(p.report, "utf8"), /automatic candidates/)
    assert.deepEqual(inventory, original, "scope reporting cannot shrink or rewrite inventory")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("foldkit runtimeSingleton: retain type-only scope and full ownership in the report", async () => check([], false))
test("type-only import spellings, extensions and explicit selection retain the original ownership", async () => {
  // Detail 279: "Keep the full ownership list and original test/tool coverage."
  await fc.assert(fc.asyncProperty(fc.array(fc.record({ inline: fc.boolean(), ext: fc.constantFrom("ts", "mts") }), { maxLength: 8 }),
    fc.boolean(), check), { seed: 279031, numRuns: 120 })
})
