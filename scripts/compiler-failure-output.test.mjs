import assert from "node:assert/strict"
import { nodeTestSelection } from "./testing/node-selection.mjs"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../", import.meta.url))
const source = readFileSync(join(repo, "packages/PACKAGE.ts"), "utf8")
const expression = source.match(/const compilerTest =[\s\S]*?\bshell:\s*([\s\S]*?),\n\s*\/\//)?.[1]
assert.ok(expression, "read the actual compiler shard command")
const command = shard => Function("files", "names", "nodeTestSelection", "return (" + expression + ")")(["compiler/test/" + ["a","b","c","d"][shard - 1] + ".test.mjs"], undefined, nodeTestSelection)
const reporter = "scripts/testing/node-failures.mjs"

function run(shard, mode) {
  const root = mkdtempSync(join(tmpdir(), "compiler-failure-output-"))
  try {
    mkdirSync(join(root, "packages/compiler/test"), { recursive: true })
    mkdirSync(join(root, "scripts/testing"), { recursive: true })
    mkdirSync(join(root, "bin"))
    // The graph provisions packages before invoking the shard. This isolated
    // fixture has only built-ins; never install into the repository's packages.
    writeFileSync(join(root, "bin/bun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    symlinkSync(process.execPath, join(root, "bin/node"))
    if (existsSync(join(repo, reporter))) copyFileSync(join(repo, reporter), join(root, reporter))
    let body
    if (mode === "nested") body = `
test("outer", async t => {
  await t.test("passing child", () => {})
  await t.test("failing child", () => { throw new Error("NESTED_DETAIL") })
})`
    else if (mode === "deep-cause") body = `
test("deep", () => {
  throw new Error("WRAPPER " + "w".repeat(2000), { cause: new Error("MIDDLE", { cause: new Error("ROOT_CAUSE_DETAIL") }) })
})`
    else if (mode === "cancelled") body = 'test("unfinished", { timeout: 25 }, () => new Promise(() => {}))'
    else if (mode === "mixed") body = `
test("passing", () => {})
test("skipped", { skip: "skip control" }, () => { throw new Error("SKIP_BODY_EXECUTED") })
test("todo", { todo: "todo control" }, () => { throw new Error("TODO_DETAIL") })`
    else body = `
console.log("✔ preserve ordinary stdout")
console.error("preserve ordinary stderr")
for (let i = 0; i < 260; i++) test("ordinary " + i, () => appendFileSync("executed", "pass\\n"))
test("last", () => {
  appendFileSync("executed", "last\\n")
  if (${JSON.stringify(mode)} === "failure") throw new Error("LATE_DETAIL", {
    cause: new Error("NESTED_CAUSE_DETAIL")
  })
})`
    const fixture = 'import { test } from "node:test"\nimport { appendFileSync } from "node:fs"\n' + body
    for (const name of ["a", "b", "c", "d"]) writeFileSync(join(root, "packages/compiler/test", name + ".test.mjs"), fixture)
    const env = { ...process.env, PATH: join(root, "bin") + delimiter + process.env.PATH, FORCE_COLOR: "0", NODE_OPTIONS: "" }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync("sh", ["-c", command(shard)], {
      cwd: root, encoding: "utf8", timeout: 10_000,
      env
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null, "the reporter must not keep cancelled test processes alive")
    const output = result.stdout + result.stderr
    const preview = output.split("\n").slice(0, 200).join("\n")
    const records = output.split("\n").filter(line => line.startsWith("[node-test] ")).map(line => JSON.parse(line.slice(12)))
    const summary = records.find(record => record.event === "summary")
    return { ...result, output, preview, records, summary,
      executions: ["failure", "success"].includes(mode) ? readFileSync(join(root, "packages/compiler/executed"), "utf8").split("\n").filter(Boolean).length : undefined }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const shard of [1, 2, 3, 4]) test("compiler shard " + shard + " retains late failure evidence and all executions", () => {
  const result = run(shard, "failure")
  assert.equal(result.status, 1)
  assert.equal(result.executions, 261)
  assert.ok(result.preview.includes("LATE_DETAIL"), "late error must fit in the graph's first 200 lines")
  assert.ok(result.preview.includes("NESTED_CAUSE_DETAIL"), "retain the original error cause")
  assert.match(result.output, /✔ preserve ordinary stdout/)
  assert.match(result.output, /preserve ordinary stderr/)
  assert.equal(result.summary.counts.tests, 261)
  assert.equal(result.summary.counts.passed, 260)
  assert.equal(result.summary.counts.failed, 1)
  assert.equal(result.summary.success, false)
})

test("compiler reporter retains a fully successful run and totals", () => {
  const result = run(1, "success")
  assert.equal(result.status, 0, result.output)
  assert.equal(result.executions, 261)
  assert.equal(result.summary.counts.tests, 261)
  assert.equal(result.summary.counts.passed, 261)
  assert.equal(result.summary.counts.failed, 0)
  assert.equal(result.summary.success, true)
})

test("compiler reporter preserves nested failure attribution", () => {
  const result = run(1, "nested")
  assert.equal(result.status, 1)
  assert.match(result.preview, /NESTED_DETAIL/)
  assert.ok(result.records.some(row => row.event === "failure" && row.name === "failing child"))
  assert.equal(result.summary.counts.tests, 3)
  assert.equal(result.summary.counts.failed, 2)
})

test("compiler reporter preserves cancellation and does not keep the process alive", () => {
  const result = run(1, "cancelled")
  assert.equal(result.status, 1)
  assert.equal(result.summary.counts.cancelled, 1)
  assert.equal(result.summary.success, false)
})

test("compiler reporter retains skip and todo semantics", () => {
  const result = run(1, "mixed")
  assert.equal(result.status, 0, result.output)
  assert.equal(result.summary.counts.tests, 3)
  assert.equal(result.summary.counts.skipped, 1)
  assert.equal(result.summary.counts.todo, 1)
  assert.equal(result.summary.success, true)
  assert.doesNotMatch(result.output, /SKIP_BODY_EXECUTED/)
  assert.ok(result.records.some(row => row.event === "failure" && row.todo === "todo control"))
})

// The graph's live output keeps the first 1,600 characters of each line; the
// captured output keeps all of it. A wrapped failure must name its innermost
// cause inside that live prefix.
test("a failure record names its innermost cause within the live line limit", () => {
  const result = run(1, "deep-cause")
  assert.equal(result.status, 1)
  const line = result.output.split("\n").find(l => l.startsWith("[node-test] ") && l.includes('"event":"failure"'))
  assert.ok(line, "a failure record")
  assert.ok(line.length > 1600, "the fixture's record exceeds the live limit")
  assert.ok(line.slice(0, 1600).includes("ROOT_CAUSE_DETAIL"), line.slice(0, 1600))
  assert.ok(line.includes("WRAPPER") && line.includes("MIDDLE"), "the whole error stays in the record")
})
