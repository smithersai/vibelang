import assert from "node:assert/strict"
import { test } from "node:test"
import { candidates, draftPlan, isToolConfig, levels, planPrompt, validatePlan } from "../lib/plan.mjs"

const file = (path, extra = {}) => ({ path, package: ".", test: false, lines: 10, tokens: 50, effect: "values", effectImports: ["effect"], imports: [], dependents: [], testedBy: [], coverage: null, ...extra })

const inventory = {
  packages: ["."],
  summary: { effectValueFiles: 5 },
  files: [
    file("src/leaf.ts", { testedBy: ["src/leaf.test.ts"], coverage: 90 }),
    file("src/mid.ts", { imports: ["src/leaf.ts", "src/plain.ts"] }),
    file("src/top.ts", { imports: ["src/mid.ts"], lines: 400 }),
    file("src/plain.ts", { effect: "none" }),
    file("src/leaf.test.ts", { test: true, imports: ["src/leaf.ts"] }),
    file("src/view.tsx"),
    file("src/cycle-a.ts", { imports: ["src/cycle-b.ts"] }),
    file("src/cycle-b.ts", { imports: ["src/cycle-a.ts"] })
  ]
}

test("candidates are .ts sources that use Effect values; tests stay unless asked", () => {
  assert.deepEqual(candidates(inventory).map((f) => f.path), ["src/leaf.ts", "src/mid.ts", "src/top.ts", "src/cycle-a.ts", "src/cycle-b.ts"])
  assert.ok(candidates(inventory, { includeTests: true }).some((f) => f.path === "src/leaf.test.ts"))
})

// drive-t3code-server 17:30Z: apps/server/graphql.config.ts uses Effect and
// was renamed, so `graphqlgen --check`, which looks for graphql.config.ts,
// failed with "config file not found".
test("t3code: a tool's config stays .ts, in the draft and in a plan that names it", () => {
  const files = [
    { path: "apps/server/graphql.config.ts", effect: "values", test: false, imports: [], testedBy: [], lines: 3 },
    { path: "apps/server/vitest.config.ts", effect: "values", test: false, imports: [], testedBy: [], lines: 3 },
    { path: "apps/server/src/config.ts", effect: "values", test: false, imports: [], testedBy: [], lines: 3 },
    { path: "apps/server/src/app.config.loader.ts", effect: "values", test: false, imports: [], testedBy: [], lines: 3 },
  ]
  assert.deepEqual(candidates({ files }).map((f) => f.path), ["apps/server/src/config.ts", "apps/server/src/app.config.loader.ts"])
  assert.equal(isToolConfig("graphql.config.ts"), true)
  assert.equal(isToolConfig("src/config.ts"), false)
  const { errors } = validatePlan({ batches: [{ files: ["apps/server/graphql.config.ts"], reason: "the server's GraphQL config" }] }, { files })
  assert.ok(errors.some((e) => e.includes("graphql.config.ts is a tool's config")), errors.join("\n"))
})

test("levels put leaves first and an import cycle on one level", () => {
  const l = levels(candidates(inventory))
  assert.equal(l.get("src/leaf.ts"), 0)
  assert.equal(l.get("src/mid.ts"), 1)
  assert.equal(l.get("src/top.ts"), 2)
  assert.equal(l.get("src/cycle-a.ts"), l.get("src/cycle-b.ts"))
})

test("the draft orders leaves and tested files first and respects the limits", () => {
  const draft = draftPlan(inventory, { maxFiles: 2, maxLines: 500 })
  const order = draft.batches.flatMap((b) => b.files)
  assert.equal(order[0], "src/leaf.ts")
  assert.ok(order.indexOf("src/mid.ts") < order.indexOf("src/top.ts"))
  for (const b of draft.batches) {
    assert.ok(b.files.length <= 2)
    assert.ok(b.reason.length > 0)
  }
  assert.deepEqual(validatePlan(draft, inventory, { maxFiles: 2, maxLines: 500 }).errors, [])
})

test("validatePlan refuses unknown, duplicate, non-Effect, oversized and non-.ts entries", () => {
  const { errors } = validatePlan({
    batches: [
      { files: ["src/leaf.ts", "src/missing.ts"], reason: "x" },
      { files: ["src/leaf.ts", "src/plain.ts", "src/view.tsx"], reason: "" },
      { files: ["src/top.ts", "src/mid.ts", "src/cycle-a.ts"], reason: "y" }
    ]
  }, inventory, { maxFiles: 2, maxLines: 300 })
  for (const expected of ["not in the inventory", "already in batch 1", "no Effect code", "not a .ts module", "a reason is required", "at most 2", "lines; a batch holds at most 300"]) {
    assert.ok(errors.some((e) => e.includes(expected)), `expected an error containing "${expected}" in ${JSON.stringify(errors)}`)
  }
  assert.deepEqual(validatePlan({ batches: [] }, inventory).errors, ["the plan needs a non-empty batches array"])
})

test("a single file over the line limit is its own batch, with a warning", () => {
  const { errors, warnings } = validatePlan({ batches: [{ files: ["src/top.ts"], reason: "x" }] }, inventory, { maxFiles: 2, maxLines: 100 })
  assert.deepEqual(errors, [])
  assert.ok(warnings.some((w) => w.includes("400 lines; a batch holds at most 100, but one file cannot be split")))
  assert.deepEqual(validatePlan(draftPlan(inventory, { maxFiles: 2, maxLines: 100 }), inventory, { maxFiles: 2, maxLines: 100 }).errors, [])
})

test("validatePlan warns when a batch migrates a file before its Effect imports", () => {
  const { errors, warnings } = validatePlan({ batches: [{ files: ["src/mid.ts"], reason: "x" }, { files: ["src/leaf.ts"], reason: "y" }] }, inventory)
  assert.deepEqual(errors, [])
  assert.ok(warnings.some((w) => w.includes("imports src/leaf.ts, which a later batch (2)")))
  assert.ok(warnings.some((w) => w.includes("no test that imports it")))
})

test("the prompt lists the candidates, the limits, the output path and the draft", () => {
  const draft = draftPlan(inventory)
  const prompt = planPrompt({ inventory, draft, output: "/run/plan.answer.json" })
  assert.ok(prompt.includes("| src/leaf.ts | 10 | 50 | effect |"))
  assert.ok(prompt.includes("/run/plan.answer.json"))
  assert.ok(prompt.includes("at most 6 files and 900 lines"))
  assert.ok(prompt.includes(JSON.stringify(draft, null, 2)))
})
