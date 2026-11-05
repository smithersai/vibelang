import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { runnerHelpers, runnerSeconds, stageSeconds } from "./harness-command.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))

// A runner killed as a whole names no stage, and post-merge fails on a healthy
// case. A runner without a line cannot fall short, so this holds an explicit
// line to the stages. It reads files only, so it runs before anything is built.
test("every runner's deadline covers its stages and the stages of the helpers it imports", () => {
  const cases = path.join(here, "cases")
  const short = []
  for (const name of fs.readdirSync(cases)) {
    const runner = path.join(cases, name, "run.mjs")
    if (!fs.existsSync(runner)) continue
    const stages = [runner, ...runnerHelpers(runner)].reduce((sum, file) => sum + stageSeconds(fs.readFileSync(file, "utf8")), 0)
    if (runnerSeconds(runner) < stages) short.push(`${name}: ${runnerSeconds(runner)} s for ${stages} s of stages`)
  }
  assert.deepEqual(short, [], "a runner killed as a whole names no stage; set `// run-seconds: N` to the sum of the deadlines")
})

test("a runner without a line gets at least the stage deadlines written for it", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-harness-stages-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const write = (name, text) => {
    fs.writeFileSync(path.join(dir, name), text)
    return path.join(dir, name)
  }
  write("_stages.mjs", 'export const run = () => spawn({ timeout: 120_000 })\n')
  write("_budget.mjs", "// run-seconds: 300\nexport const budget = 1\n")
  assert.equal(runnerSeconds(write("none.mjs", "console.log(1)\n")), 60)
  assert.equal(runnerSeconds(write("short.mjs", "spawn({ timeout: 30_000 })\n")), 60)
  assert.equal(runnerSeconds(write("own-stages.mjs", "spawn({ timeout: 60_000 }); spawn({ timeout: 60_000 })\n")), 120)
  assert.equal(runnerSeconds(write("helper-stages.mjs", 'import { run } from "./_stages.mjs"\nspawn({ timeout: 30_000 })\n')), 150)
  assert.equal(runnerSeconds(write("budget-wins.mjs", 'import { run } from "./_stages.mjs"\nimport { budget } from "./_budget.mjs"\n')), 300)
  assert.equal(runnerSeconds(write("own-line.mjs", "// run-seconds: 90\nspawn({ timeout: 60_000 }); spawn({ timeout: 60_000 })\n")), 90)
})

test("the stage sum reads written deadlines and nothing else", () => {
  assert.equal(stageSeconds('run({ timeout: 30_000 }); run({timeout:60000}); const timeout = 5'), 90)
  assert.equal(stageSeconds("run({ retries: 2 })"), 0)
})

test("a helper's budget does not come from compiled output or a missing file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-harness-helpers-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, "out"))
  fs.writeFileSync(path.join(dir, "out/run.mjs"), "// run-seconds: 900\n")
  const runner = path.join(dir, "run.mjs")
  fs.writeFileSync(runner, 'import a from "./out/run.mjs"\nimport b from "./missing.mjs"\n')
  assert.deepEqual(runnerHelpers(runner), [])
  assert.equal(runnerSeconds(runner), 60)
})
