import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const source = process.env.VIBELANG_PROGRESS_SCRIPT ?? new URL("./go-test-shards.sh", import.meta.url)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(predicate, label) {
  const deadline = performance.now() + 3_000
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "missing " + label)
    await delay(10)
  }
}

function launch(t, { mode = "workers", fastStatus = 0, names = ["TestFast", "TestSlow"], shards = 2, slice = "1/1", args = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "go-shard-progress-"))
  const bin = join(dir, "pkg.mjs")
  const script = join(dir, "shards.sh")
  writeFileSync(script, readFileSync(source))
  writeFileSync(bin, "#!" + process.execPath + "\n" + [
    'import { existsSync, writeFileSync } from "node:fs"',
    'import { join } from "node:path"',
    'const root = process.env.SHARD_PROGRESS_ROOT',
    'const names = JSON.parse(process.env.SHARD_PROGRESS_NAMES)',
    'const mark = name => writeFileSync(join(root, name), "")',
    'async function release(name) {',
    '  const deadline = Date.now() + 15_000',
    '  while (!existsSync(join(root, name))) {',
    '    if (Date.now() > deadline) throw new Error("fixture never released: " + name)',
    '    await new Promise(resolve => setTimeout(resolve, 10))',
    '  }',
    '}',
    'if (process.argv.includes("-test.list")) {',
    '  mark("listing")',
    '  if (process.env.SHARD_PROGRESS_MODE === "discovery") await release("list")',
    '  if (process.env.SHARD_PROGRESS_MODE === "listing-failure") { console.error("listing fixture failed"); process.exit(17) }',
    '  console.log(names.join("\\n"))',
    '} else {',
    '  const run = process.argv.find(arg => arg.startsWith("-test.run="))?.slice(10)',
    '  const selected = run ? names.filter(name => new RegExp(run).test(name)) : names',
    '  for (const name of selected) console.log("=== RUN " + name)',
    '  for (const name of selected) mark(name + "-ready")',
    '  for (const name of selected) await release(name)',
    '  for (const name of selected) { console.log("finished fixture " + name); mark(name + "-done") }',
    '  process.exit(selected.includes(names[0]) ? Number(process.env.SHARD_PROGRESS_FAST_STATUS) : 0)',
    '}'
  ].join("\n"), { mode: 0o700 })
  const child = spawn("sh", [script, bin, ...args], {
    cwd: dir,
    env: { ...process.env, GO_TEST_SHARDS: String(shards), GO_TEST_SLICE: slice, TMPDIR: dir,
      SHARD_PROGRESS_ROOT: dir, SHARD_PROGRESS_NAMES: JSON.stringify(names),
      SHARD_PROGRESS_MODE: mode, SHARD_PROGRESS_FAST_STATUS: String(fastStatus) }
  })
  let stdout = "", stderr = ""
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk })
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk })
  const done = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }))
  })
  const release = name => writeFileSync(join(dir, name), "")
  t.after(async () => {
    for (const name of ["list", ...names]) release(name)
    await done
    rmSync(dir, { recursive: true, force: true })
  })
  return { child, done, release, has: name => existsSync(join(dir, name)),
    stdout: () => stdout, stderr: () => stderr }
}

test("Go shard discovery is visible while TestMain is still running", async t => {
  const run = launch(t, { mode: "discovery" })
  await until(() => run.has("listing"), "live discovery fixture")
  await until(() => run.stderr().includes("go-test-shards: listing tests"), "live discovery progress")
  assert.equal(run.child.exitCode, null)
  assert.equal(run.stdout(), "")
})

test("Go shard assignments are visible while both processes are held", async t => {
  const run = launch(t)
  await until(() => run.has("TestFast-ready") && run.has("TestSlow-ready"), "both held test processes")
  await until(() => run.stderr().includes("starting process 0: 1 tests: TestFast") &&
    run.stderr().includes("starting process 1: 1 tests: TestSlow"), "live assignments")
  assert.match(run.stderr(), /go-test-shards: listed tests: exit 0/)
  assert.equal(run.child.exitCode, null)
  assert.equal(run.stdout(), "", "test stdout stays grouped until all workers finish")
})

for (const status of [0, 7]) {
  test("Go shard completion is visible before its sibling exits: status " + status, async t => {
    const run = launch(t, { fastStatus: status })
    await until(() => run.has("TestFast-ready") && run.has("TestSlow-ready"), "both held processes")
    run.release("TestFast")
    await until(() => run.has("TestFast-done"), "first process completion")
    await until(() => run.stderr().includes("finished process 0: exit " + status), "live completion")
    assert.equal(run.has("TestSlow-done"), false)
    assert.equal(run.child.exitCode, null)
    assert.equal(run.stdout(), "")
    run.release("TestSlow")
    const result = await run.done
    assert.equal(result.status, status, result.stdout + result.stderr)
    assert.equal(result.signal, null)
    assert.match(result.stdout, /finished fixture TestFast/)
    assert.match(result.stdout, /finished fixture TestSlow/)
  })
}

test("Go shard progress preserves complete grouped output and exit status", async t => {
  const run = launch(t, { fastStatus: 7 })
  await until(() => run.has("TestFast-ready") && run.has("TestSlow-ready"), "both test processes")
  run.release("TestFast")
  run.release("TestSlow")
  const result = await run.done
  assert.equal(result.status, 7, result.stdout + result.stderr)
  assert.equal(result.signal, null)
  assert.match(result.stdout, /=== RUN TestFast\nfinished fixture TestFast\ngo-test-shards: process 0: 1 tests, exit 7, \d+s\n/)
  assert.match(result.stdout, /=== RUN TestSlow\nfinished fixture TestSlow\ngo-test-shards: process 1: 1 tests, exit 0, \d+s\n/)
})

test("Go shard discovery failure retains output and reports its stage", async t => {
  const result = await launch(t, { mode: "listing-failure" }).done
  assert.equal(result.status, 1)
  assert.equal(result.signal, null)
  assert.equal(result.stdout, "listing fixture failed\n")
  assert.match(result.stderr, /go-test-shards: listing failed: exit 17/)
  assert.doesNotMatch(result.stderr, /starting process/)
})

test("generated shard layouts report exact assignments without losing selected names", async t => {
  for (let seed = 0; seed < 12; seed++) {
    const names = Array.from({ length: 2 + seed % 5 }, (_, i) => "TestSeed" + seed + "Name" + i)
    const denominator = 1 + seed % 3
    const numerator = 1 + seed % denominator
    const run = launch(t, { names, shards: 2 + seed % 4, slice: numerator + "/" + denominator, fastStatus: seed % 2 ? 7 : 0 })
    await until(() => run.has("listing"), "generated discovery")
    // Equal-weight names are dealt in order to the least-loaded slice.
    const selected = names.filter((_, i) => i % denominator === numerator - 1)
    await until(() => selected.every(name => run.has(name + "-ready")), "generated held assignments")
    if (selected.length) {
      assert.equal(run.child.exitCode, null, "held layout " + seed)
      assert.equal(run.stdout(), "")
    } else {
      assert.equal((await run.done).status, 0, "an empty nonfirst slice succeeds without workers")
    }
    const assigned = [...run.stderr().matchAll(/starting process \d+: \d+ tests: ([^\n]+)/g)].flatMap(m => m[1].split(",")).sort()
    assert.deepEqual(assigned, selected.toSorted())
    for (const name of names) run.release(name)
    const result = await run.done
    assert.equal(result.status, selected.includes(names[0]) && seed % 2 ? 7 : 0, result.stdout + result.stderr)
    assert.deepEqual([...result.stdout.matchAll(/^=== RUN (.+)$/gm)].map(m => m[1]).sort(), selected.toSorted())
    assert.equal((result.stderr.match(/finished process /g) ?? []).length, Math.min(2 + seed % 4, selected.length))
  }
})

test("native selector pass-through produces no invented shard lifecycle", async t => {
  const run = launch(t, { args: ["-test.run=TestFast"] })
  await until(() => run.has("TestFast-ready"), "native selected process")
  assert.equal(run.has("listing"), false)
  run.release("TestFast")
  const result = await run.done
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stderr, "")
})
