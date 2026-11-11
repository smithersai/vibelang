import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const reporter = fileURLToPath(new URL("./testing/migrate-progress.mjs", import.meta.url))
const records = output => output.split("\n").filter(line => line.startsWith("[migrate-test] ")).map(line => JSON.parse(line.slice(15)))
function fixture(t, sources) {
  const root = mkdtempSync(join(tmpdir(), "migrate-progress-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return Object.entries(sources).map(([name, source]) => {
    const file = join(root, name + ".test.mjs")
    writeFileSync(file, 'import { test } from "node:test"\nimport assert from "node:assert/strict"\n' + source)
    return file
  })
}
function run(t, files, signalAfter, withProgress = true, withSpec = true) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
    const child = spawn(process.execPath, ["--test", ...(withSpec ? ["--test-reporter=spec", "--test-reporter-destination=stdout"] : []),
      ...(withProgress ? ["--test-reporter=" + reporter, "--test-reporter-destination=stderr"] : []), ...files],
      { env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = "", done = false
    const kill = signal => {
      if (done) return
      try { process.platform === "win32" ? child.kill(signal) : process.kill(-child.pid, signal) } catch (error) { if (error.code !== "ESRCH") throw error }
    }
    const deadline = setTimeout(() => kill("SIGKILL"), signalAfter ? 50_000 : 15_000)
    const signal = signalAfter ? setTimeout(() => kill("SIGTERM"), signalAfter) : null
    t.after(() => { clearTimeout(deadline); clearTimeout(signal); kill("SIGKILL") })
    child.stdout.on("data", bytes => { stdout += bytes })
    child.stderr.on("data", bytes => { stderr += bytes })
    child.once("error", reject)
    child.once("close", (code, signal) => { done = true; clearTimeout(deadline); resolve({ code, signal, stdout, stderr, records: records(stderr) }) })
  })
}

test("migration progress names every selected file and completes without changing a passing exit", { timeout: 20_000 }, async t => {
  const files = fixture(t, { a: 'test("pass", () => {})\n', b: 'test("skip", { skip: "fixture" }, () => {})\n' })
  const result = await run(t, files)
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.signal, null)
  assert.deepEqual(result.records.find(r => r.event === "start").files, files.map(file => relative(process.cwd(), file)))
  const final = result.records.at(-1)
  assert.equal(final.event, "complete")
  assert.equal(final.filesSelected, 2)
  assert.equal(final.filesCompleted, 2)
  assert.equal(final.counts.skipped, 1)
  assert.equal(final.success, true)
})

test("migration progress preserves complete assertion details and the failing exit", { timeout: 20_000 }, async t => {
  const witness = "x".repeat(20_000) + " FULL_ASSERTION_DETAIL_END"
  const files = fixture(t, { a: 'test("assertion witness", () => assert.equal(false, true, ' + JSON.stringify(witness) + '))\n' })
  const result = await run(t, files)
  assert.equal(result.code, 1)
  assert.equal(result.signal, null)
  assert.ok(result.stdout.includes("FULL_ASSERTION_DETAIL_END"))
  assert.ok(result.records.find(r => r.event === "test-failed").error.includes(witness))
  assert.equal(result.records.at(-1).counts.failed, 1)
  assert.equal(result.records.at(-1).success, false)
})

test("migration progress exposes unfinished files and preserves termination signals", { timeout: 55_000 }, async t => {
  const files = fixture(t, { a: 'test("before interruption", () => assert.fail("INTERRUPTED_ASSERTION_WITNESS"))\n',
    b: 'test("unfinished", async () => { await new Promise(resolve => setTimeout(resolve, 120_000)) })\n' })
  const [result, baseline] = await Promise.all([run(t, files, 40_000), run(t, files, 40_000, false)])
  assert.deepEqual({ code: result.code, signal: result.signal }, { code: baseline.code, signal: baseline.signal })
  assert.notEqual(result.code, 0)
  assert.ok(result.records.some(r => r.event === "test-failed" && r.error.includes("INTERRUPTED_ASSERTION_WITNESS")), JSON.stringify(result.records))
  const progress = result.records.find(r => r.event === "progress")
  assert.ok(progress, result.stderr)
  assert.equal(progress.filesCompleted, 1)
  assert.ok(progress.pending.some(p => p.file === relative(process.cwd(), files[1])))
  assert.equal(result.records.some(r => r.event === "complete"), false)
  // SIGTERM can stop Node before an EOF trailer; pending progress must not become complete.
  assert.ok(["progress", "incomplete"].includes(result.records.at(-1).event))
})

test("migration progress calls a file that cannot load incomplete and preserves its failure", { timeout: 20_000 }, async t => {
  const files = fixture(t, { a: 'test("pass", () => {})\n', b: 'test("invalid", => {})\n' })
  const result = await run(t, files)
  assert.equal(result.code, 1)
  assert.ok((result.stdout + result.stderr).includes("SyntaxError"))
  const final = result.records.at(-1)
  assert.equal(final.event, "incomplete")
  assert.ok(final.missing.includes(relative(process.cwd(), files[1])))
  assert.equal(final.success, false)
})

test("migration failures remain visible after more files than the graph's live output budget", async () => {
  const { default: progress } = await import("./testing/migrate-progress.mjs")
  const events = async function* () {
    for (let i = 0; i < 350; i++) {
      const file = join(process.cwd(), "fixture", `file-${i}.test.mjs`)
      yield { type: "test:pass", data: { file, name: "passing control" } }
      yield { type: "test:summary", data: { file, success: true, counts: { tests: 1, passed: 1 } } }
    }
    yield { type: "test:fail", data: { file: join(process.cwd(), "fixture", "late.test.mjs"),
      name: "late assertion", details: { error: new Error("LATE_FAILURE_WITNESS") } } }
  }
  const output = []
  for await (const line of progress(events())) output.push(line)
  const visible = output.join("").split("\n").slice(0, 200).join("\n")
  assert.ok(visible.includes("LATE_FAILURE_WITNESS"),
    "successful file lifecycle records consumed the graph's first 200 lines")
  const final = records(output.join("")).at(-1)
  assert.equal(final.counts.passed, 350)
})

test("migration target uses the progress reporter without verbose successful test output", () => {
  const source = readFileSync(new URL("../packages/PACKAGE.ts", import.meta.url), "utf8")
  const declaration = readFileSync(new URL("./testing/migrate-shards.mjs", import.meta.url), "utf8")
  assert.ok(source.includes("shell: migrateShardShell(shard)"))
  assert.ok(declaration.includes("--test-reporter=../../scripts/testing/migrate-progress.mjs"))
  assert.ok(!declaration.includes("--test-reporter=spec"))
  assert.ok(declaration.includes('"migrate/test/*.test.mjs", "convert/*.test.mjs"'))
})

test("the compact reporter alone preserves assertion and loader failures", { timeout: 20_000 }, async t => {
  const files = fixture(t, {
    assertion: 'test("assertion", () => assert.fail("COMPACT_ASSERTION_WITNESS"))\n',
    syntax: 'test("broken", => {})\n',
  })
  const result = await run(t, files, undefined, true, false)
  assert.equal(result.code, 1)
  assert.ok(result.stderr.includes("COMPACT_ASSERTION_WITNESS"), result.stderr)
  assert.ok(result.stderr.includes("SyntaxError"), result.stderr)
  assert.equal(result.records.at(-1).event, "incomplete")
  assert.equal(result.records.at(-1).success, false)
})

test("migration progress distinguishes todo failures in an otherwise successful execution", { timeout: 20_000 }, async t => {
  const reason = 'future "quoted" control\nUnicode ☃'
  const files = fixture(t, { a: [
    'test("passing", () => {})',
    'test("skipped", { skip: "skip control" }, () => assert.fail("SKIP_BODY"))',
    'test("todo reason", { todo: ' + JSON.stringify(reason) + ' }, () => assert.fail("TODO_REASON"))',
    'test("todo boolean", { todo: true }, () => assert.fail("TODO_BOOLEAN"))'
  ].join("\n") })
  const result = await run(t, files, undefined, true, false)
  assert.equal(result.code, 0, result.stderr)
  const failed = result.records.filter(record => record.event === "test-failed")
  assert.deepEqual(failed.map(record => ({ name: record.name, todo: record.todo, skip: !!record.skip })), [
    { name: "todo reason", todo: reason, skip: false },
    { name: "todo boolean", todo: true, skip: false }
  ])
  assert.ok(failed.every(record => record.error.includes("TODO_")))
  assert.ok(!result.stderr.includes("SKIP_BODY"))
  assert.equal(result.records.at(-1).counts.failed, 0)
  assert.equal(result.records.at(-1).counts.todo, 2)
  assert.equal(result.records.at(-1).counts.skipped, 1)
  assert.equal(result.records.at(-1).success, true)
})
