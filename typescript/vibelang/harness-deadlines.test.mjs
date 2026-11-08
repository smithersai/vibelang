import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { nearDeadline, runnerHelpers, runnerSeconds, stageSeconds } from "./harness-command.mjs"

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

// A runner that starts a process, itself or through a helper, runs at the
// host's pace: post-merge boxes compile several times slower than a developer
// machine, and the 60-second default killed healthy runs that took 36 to 64 s.
// The budget is the author's decision, written down where the process starts.
const startsProcess = (text) => /\bfrom\s+(["'])(?:node:)?child_process\1|\brequire\(\s*(["'])(?:node:)?child_process\2\s*\)/.test(text)
const declaresSeconds = (text) => /^\/\/ run-seconds: \d+\b/m.test(text)
test("every runner that starts a process declares its deadline, itself or in the helper that starts it", () => {
  const cases = path.join(here, "cases")
  const silent = []
  for (const name of fs.readdirSync(cases)) {
    const runner = path.join(cases, name, "run.mjs")
    if (!fs.existsSync(runner)) continue
    const texts = [runner, ...runnerHelpers(runner)].map((file) => fs.readFileSync(file, "utf8"))
    if (texts.some(startsProcess) && !texts.some(declaresSeconds)) silent.push(name)
  }
  assert.deepEqual(silent, [], "a runner that starts a process runs at the host's pace; write `// run-seconds: N` in the runner, or in the helper that starts the process")
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

test("a passing case that used over half of a phase's deadline is named with that phase", () => {
  const records = [
    { phase: "compile", wallMs: 30_000, timeoutMs: 120_000 },
    { phase: "run", wallMs: 48_200, timeoutMs: 60_000 },
    { phase: "compare", wallMs: 9_000, timeoutMs: 10_000 },
  ]
  assert.deepEqual(nearDeadline(records), { phase: "compare", seconds: 9, limit: 10, ratio: 0.9 }, "the worst ratio wins")
  assert.equal(nearDeadline(records.slice(0, 1)), null)
  assert.equal(nearDeadline([{ phase: "run", wallMs: 30_000, timeoutMs: 60_000 }]), null, "exactly half is inside")
  assert.equal(nearDeadline([{ phase: "run", timeoutMs: 60_000 }, { phase: "run", wallMs: 5, timeoutMs: 0 }]), null, "no wall or no deadline: nothing to compare")
  assert.equal(nearDeadline(records, 0.2).phase, "compare")
})

test("nested helper deadlines cover shared imports once and stop at import cycles", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-nested-deadlines-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const write = (name, text) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, text)
    return file
  }
  const leaf = write("leaf.mjs", "// run-seconds: 180\nexport const run = () => spawn({ timeout: 60_000 })\n")
  const left = write("left.mjs", 'import { run } from "./leaf.mjs"\nexport { run }\n')
  const right = write("right.mjs", 'import { run } from "./leaf.mjs"\nexport { run }\n')
  const runner = write("run.mjs", 'import { run } from "./left.mjs"\nimport { run as other } from "./right.mjs"\n')
  assert.equal(runnerSeconds(runner), 180, "a wrapper must not hide the existing helper budget")
  assert.deepEqual(new Set(runnerHelpers(runner)), new Set([left, right, leaf]))
  fs.appendFileSync(leaf, 'import "node:fs"\nimport { run as again } from "./run.mjs"\n')
  assert.equal(runnerSeconds(runner), 180)
  assert.deepEqual(new Set(runnerHelpers(runner)), new Set([left, right, leaf]), "cycles exclude the runner itself")
  fs.writeFileSync(leaf, "export const run = () => spawn({ timeout: 120_000 })\n")
  assert.equal(runnerSeconds(runner), 120, "a diamond counts shared stage deadlines once")
})

test("generated helper graphs retain reachable budgets and stages without duplicate or output modules", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-helper-graphs-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let state = 1781
  const random = (n) => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) % n)
  for (let sample = 0; sample < 100; sample++) {
    const at = path.join(dir, String(sample))
    fs.mkdirSync(path.join(at, "out"), { recursive: true })
    fs.writeFileSync(path.join(at, "out/ignored.mjs"), "// run-seconds: 9000\n")
    const n = 2 + random(6)
    const names = Array.from({ length: n }, (_, i) => "helper-" + i + ".mjs").concat("run.mjs", "out/ignored.mjs")
    const nodes = Array.from({ length: n + 1 }, (_, i) => ({
      budget: i === n ? 0 : [0, 90, 180][random(3)],
      stage: [0, 5, 10, 20][random(4)],
      edges: i === n ? [0, random(n + 2), 0] : Array.from({ length: random(4) }, () => random(n + 2)),
    }))
    for (let i = 0; i <= n; i++) {
      const node = nodes[i]
      const imports = node.edges.map((edge, j) => {
        const quote = random(2) ? "'" : '"'
        return "import { x as x" + j + " } from " + quote + "./" + names[edge] + quote + "\n"
      }).join("")
      fs.writeFileSync(path.join(at, names[i]),
        (node.budget ? "// run-seconds: " + node.budget + "\n" : "") +
        imports + "export const x = () => spawn({ timeout: " + node.stage * 1000 + " })\n")
    }
    const reachable = new Set([n])
    const visit = (i) => {
      for (const edge of nodes[i].edges) {
        if (edge > n || reachable.has(edge)) continue
        reachable.add(edge)
        visit(edge)
      }
    }
    visit(n)
    const inherited = [...reachable].filter(i => i !== n).map(i => nodes[i].budget).filter(Boolean)
    const stages = [...reachable].reduce((sum, i) => sum + nodes[i].stage, 0)
    const expected = Math.max(inherited.length ? Math.max(...inherited) : 60, stages)
    const runner = path.join(at, "run.mjs")
    assert.equal(runnerSeconds(runner), expected, "generated graph " + sample)
    assert.deepEqual(new Set(runnerHelpers(runner)),
      new Set([...reachable].filter(i => i !== n).map(i => path.join(at, names[i]))), "generated graph " + sample)
  }
})

test("realpath aliases count a module once and resolve its own relative helpers", { skip: process.platform === "win32" }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-helper-alias-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, "shared"))
  const leaf = path.join(dir, "shared/leaf.mjs")
  const grand = path.join(dir, "shared/grand.mjs")
  const alias = path.join(dir, "alias.mjs")
  fs.writeFileSync(leaf, 'import { x } from "./grand.mjs"\nexport const run = () => spawn({ timeout: 30_000 })\n')
  fs.writeFileSync(grand, "export const x = () => spawn({ timeout: 80_000 })\n")
  fs.symlinkSync(leaf, alias)
  const runner = path.join(dir, "run.mjs")
  fs.writeFileSync(runner, 'import { run } from "./alias.mjs"\nimport { run as other } from "./shared/leaf.mjs"\n')
  assert.deepEqual(new Set(runnerHelpers(runner)), new Set([alias, grand]))
  assert.equal(runnerSeconds(runner), 110)
})


test("the process census recognizes single-quoted child process imports and requires", () => {
  for (const name of ["node:child_process", "child_process"]) {
    for (const prefix of [
      "import { execFileSync } from ", "import childProcess from ",
      "import * as childProcess from ", "const childProcess = require(",
    ]) {
      const source = prefix + "'" + name + "'" + (prefix.includes("require") ? ")" : "")
      assert.equal(startsProcess(source), true, source)
    }
  }
})

test("process import spelling and whitespace preserve census admission", () => {
  for (const name of ["node:child_process", "child_process"]) {
    for (const quote of ['"', "'"]) {
      for (const space of ["", " ", "\n", "\t"]) {
        for (const source of [
          "import { spawn } from" + (space || " ") + quote + name + quote,
          "const cp = require(" + space + quote + name + quote + space + ")",
        ]) assert.equal(startsProcess(source), true, source)
      }
    }
  }
  for (const source of [
    'import assert from "node:assert/strict"',
    "const fs = require('node:fs')",
    'import cp from "node:child_process-extra"',
    "const cp = require('child_process-extra')",
    'import cp from "./node:child_process"',
    "const cp = require('prefix/child_process')",
  ]) assert.equal(startsProcess(source), false, source)
})

test("single-quoted helpers retain budgets through mixed-quote wrappers", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-helper-quotes-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const leaf = path.join(dir, "leaf.mjs")
  fs.writeFileSync(leaf, "// run-seconds: 180\nexport const run = () => spawn({ timeout: 90_000 })\n")
  for (const outer of ['"', "'"]) {
    for (const inner of ['"', "'"]) {
      const wrapper = path.join(dir, "wrapper.mjs")
      fs.writeFileSync(wrapper, "export { run } from " + inner + "./leaf.mjs" + inner + "\n")
      const runner = path.join(dir, "run.mjs")
      fs.writeFileSync(runner, "import { run } from " + outer + "./wrapper.mjs" + outer + "\n")
      assert.deepEqual(new Set(runnerHelpers(runner)), new Set([wrapper, leaf]), outer + inner)
      assert.equal(runnerSeconds(runner), 180, outer + inner)
      fs.writeFileSync(leaf, "export const run = () => spawn({ timeout: 90_000 })\n")
      assert.equal(runnerSeconds(runner), 90, "stage floor survives " + outer + inner)
      fs.writeFileSync(leaf, "// run-seconds: 180\nexport const run = () => spawn({ timeout: 90_000 })\n")
      fs.appendFileSync(runner, "// run-seconds: 240\n")
      assert.equal(runnerSeconds(runner), 240, "explicit runner line still wins")
    }
  }
})

test("helper quote matching keeps missing, output, and mismatched imports excluded", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-helper-quote-controls-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, "out"))
  fs.writeFileSync(path.join(dir, "out/ignored.mjs"), "// run-seconds: 900\n")
  fs.writeFileSync(path.join(dir, "leaf.mjs"), "// run-seconds: 900\n")
  const runner = path.join(dir, "run.mjs")
  fs.writeFileSync(runner, [
    "import x from './out/ignored.mjs'",
    "import x from './missing.mjs'",
    "import x from './leaf.mjs\"",
    "import x from \"./leaf.mjs'",
  ].join("\n"))
  assert.deepEqual(runnerHelpers(runner), [])
  assert.equal(runnerSeconds(runner), 60)
})

function helperQuotePathCases(platform) {
  return [['"', "single'quote.mjs"], ["'", 'double"quote.mjs']]
    .filter(([, name]) => platform !== "win32" || !name.includes('"'))
}

test("quoted helper filename fixtures respect each platform's filename contract", () => {
  for (const platform of ["win32", "linux", "darwin"]) {
    const cases = helperQuotePathCases(platform)
    assert.ok(cases.length > 0, "retain a native filesystem control on " + platform)
    for (const [quote, name] of cases) {
      assert.ok(!name.includes(quote), "the filename needs no escaped import delimiter")
      if (platform === "win32") assert.doesNotMatch(name, /[<>:"/\\|?*\u0000-\u001f]/)
    }
  }
})

test("helper paths can contain the other quote character", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-helper-path-quotes-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const [quote, name] of helperQuotePathCases(process.platform)) {
    const leaf = path.join(dir, name)
    fs.writeFileSync(leaf, "// run-seconds: 180\nexport const value = 1\n")
    const runner = path.join(dir, "run.mjs")
    fs.writeFileSync(runner, "import { value } from " + quote + "./" + name + quote + "\n")
    assert.deepEqual(runnerHelpers(runner), [leaf])
    assert.equal(runnerSeconds(runner), 180)
  }
})
