import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { flowDigest, stepKey } from "../step-key.mjs"

const flows = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function flow(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "step-key-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, "demo")
  mkdirSync(path.join(dir, "lib"), { recursive: true })
  mkdirSync(path.join(dir, "test"))
  for (const [file, text] of [["flow.ts", "flow\n"], ["run.ts", "run\n"], ["lib/steps.mjs", "steps\n"], ["eval.ts", "eval\n"],
    ["baseline.json", "{}\n"], ["README.md", "# demo\n"], ["test/steps.test.mjs", "test\n"]]) writeFileSync(path.join(dir, file), text)
  return dir
}

test("a change to the code a run executes changes the step key", (t) => {
  const dir = flow(t)
  for (const file of ["flow.ts", "run.ts", "lib/steps.mjs"]) {
    const before = flowDigest(dir)
    writeFileSync(path.join(dir, file), `changed ${file}\n`)
    assert.notEqual(flowDigest(dir), before, file)
  }
  const before = flowDigest(dir)
  writeFileSync(path.join(dir, "lib/new.mjs"), "new\n")
  assert.notEqual(flowDigest(dir), before, "an added lib file")
  const withLib = flowDigest(dir)
  mkdirSync(path.join(dir, "templates"))
  writeFileSync(path.join(dir, "templates/runner.mjs"), "template\n")
  assert.notEqual(flowDigest(dir), withLib, "a template the run writes into its target")
})

test("the eval, its baseline, tests and README leave the step key alone", (t) => {
  const dir = flow(t)
  const before = flowDigest(dir)
  for (const file of ["eval.ts", "baseline.json", "README.md", "test/steps.test.mjs"]) writeFileSync(path.join(dir, file), "edited\n")
  assert.equal(flowDigest(dir), before)
})

test("a flow's key covers the code it imports from another flow", (t) => {
  const dir = flow(t)
  const other = path.join(path.dirname(dir), "other")
  cpSync(dir, other, { recursive: true })
  const before = stepKey("case", dir, other)
  writeFileSync(path.join(other, "lib/steps.mjs"), "changed\n")
  assert.notEqual(stepKey("case", dir, other), before)
  assert.match(before, /^case@[0-9a-f]{12}$/)
})

test("the same code in another checkout has the same key", (t) => {
  const dir = flow(t)
  const copy = mkdtempSync(path.join(os.tmpdir(), "step-key-copy-"))
  t.after(() => rmSync(copy, { recursive: true, force: true }))
  cpSync(dir, path.join(copy, "demo"), { recursive: true })
  assert.equal(flowDigest(path.join(copy, "demo")), flowDigest(dir))
})

test("every flow eval keys its cases with stepKey", async () => {
  const { readFileSync, readdirSync, existsSync } = await import("node:fs")
  const evals = readdirSync(flows).map((name) => path.join(flows, name, "eval.ts")).filter(existsSync)
  assert.ok(evals.length >= 4, evals.join(" "))
  for (const file of evals) assert.match(readFileSync(file, "utf8"), /stepKey: stepKey\(suiteCase\.name, /, file)
})
