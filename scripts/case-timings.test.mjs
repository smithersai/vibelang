import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const script = fileURLToPath(new URL("./bench/case-timings.mjs", import.meta.url))
const load = () => import("./bench/case-timings.mjs")
let invocation = 0
const trial = (run = 100, compile = 10) => ({
  version: 1, complete: true, startedAt: new Date(1760000000000 + invocation++).toISOString(), selected: ["stack-depth"], jobs: 1, isolated: true, lateStart: false,
  compiler: { path: "/compiler", sha256: "a".repeat(64) },
  node: "v26.5.0", effectVersion: "4.1.0", runtimeVersion: "0.0.11",
  system: { platform: "linux", arch: "x64", release: "kernel", cpu: "fixture", availableParallelism: 4 },
  cases: [{
    name: "stack-depth", status: "ok", wallMs: run + compile + 5,
    commands: [
      { phase: "compile", wallMs: compile, exitCode: 0, signal: null, timedOut: false },
      { phase: "run", wallMs: run, exitCode: 0, signal: null, timedOut: false },
    ],
  }],
})
const trials = (run = 100) => [trial(run), trial(run), trial(run)]
const clone = value => structuredClone(value)

test("case medians flag strictly greater than 50% phase slowdowns and resist one outlier", async () => {
  const { compareTrials } = await load()
  const baseline = [trial(100), trial(1000), trial(100)]
  const current = [trial(150), trial(150), trial(9999)]
  let result = compareTrials(baseline, current)
  const run = result.rows.find(row => row.phase === "run")
  assert.equal(run.baselineMedianMs, 100)
  assert.equal(run.currentMedianMs, 150)
  assert.equal(run.ratio, 1.5)
  assert.equal(result.regressions.length, 0, "50% exactly is not greater than 50%")
  result = compareTrials(baseline, trials(151))
  assert.deepEqual(result.regressions.map(row => row.phase), ["run"])
  assert.equal(result.regressions[0].ratio, 1.51)
  assert.equal(result.baseline.trials, 3)
  assert.equal(result.current.trials, 3)
})

test("case timing comparisons reject incomplete, failed, undersampled or mismatched evidence", async () => {
  const { compareTrials } = await load()
  const bad = [
    [r => { r.complete = false }, /incomplete/],
    [r => { r.version = 2 }, /version/],
    [r => { r.cases[0].status = "pending" }, /outcome/],
    [r => { r.cases[0].status = "XPASS" }, /outcome/],
    [r => { r.cases[0].status = "FAIL" }, /outcome/],
    [r => { r.cases[0].wallMs = NaN }, /wallMs/],
    [r => { r.cases[0].commands[0].wallMs = -1 }, /wallMs/],
    [r => { r.cases[0].commands[1].exitCode = 7 }, /exit/],
    [r => { r.cases[0].commands[1].timedOut = true }, /timeout/],
    [r => { r.cases[0].commands[1].signal = "SIGKILL" }, /signal/],
    [r => { r.cases[0].commands[0].error = "ENOENT" }, /spawn/],
    [r => { r.cases = [] }, /selection/],
    [r => { r.cases.push(clone(r.cases[0])) }, /selection/],
    [r => { r.selected.push("unmeasured") }, /selection/],
    [r => { r.cases[0].commands = [] }, /compile/],
    [r => { r.compiler.sha256 = "unknown" }, /compiler/],
    [r => { r.system.availableParallelism = 0 }, /parallelism/],
    [r => { r.jobs = 8 }, /jobs/],
    [r => { delete r.startedAt }, /start time/],
    [r => { r.node = "" }, /environment/],
    [r => { delete r.runtimeVersion }, /environment/],
    [r => { r.selected.push(r.selected[0]) }, /selection/],
  ]
  for (const [mutate, expected] of bad) {
    const current = trials()
    mutate(current[1])
    assert.throws(() => compareTrials(trials(), current), expected)
  }
  for (const [baseline, current] of [[[], trials()], [trials().slice(1), trials()], [trials(), trials().slice(1)]]) {
    assert.throws(() => compareTrials(baseline, current), /at least 3/)
  }
  for (const mutate of [
    r => { r.node = "v24.0.0" }, r => { r.effectVersion = "4.2.0" },
    r => { r.system.cpu = "other" }, r => { r.system.availableParallelism = 2 },
    r => { r.isolated = false }, r => { r.lateStart = true },
    r => { r.cases[0].commands.pop() },
  ]) {
    const current = trials()
    current.forEach(mutate)
    assert.throws(() => compareTrials(trials(), current), /environment|phases/)
  }
  const duplicated = trials()
  duplicated[2] = clone(duplicated[0])
  assert.throws(() => compareTrials(trials(), duplicated), /duplicate trial/)
  const mixed = trials()
  mixed[2].compiler.sha256 = "b".repeat(64)
  assert.throws(() => compareTrials(trials(), mixed), /compiler/)
})

test("expected-error compile exits and repeated phases preserve all timings", async () => {
  const { compareTrials } = await load()
  const baseline = trials()
  for (const report of baseline) {
    report.cases[0].commands[0].exitCode = 2
    report.cases[0].commands.push({ ...report.cases[0].commands[0], wallMs: 20 })
  }
  const current = clone(baseline)
  for (const report of current) report.compiler.sha256 = "b".repeat(64)
  const result = compareTrials(baseline, current)
  assert.equal(result.regressions.length, 0)
  assert.equal(result.rows.find(row => row.phase === "compile").baselineMedianMs, 30)
  assert.notEqual(result.baseline.compilerSha256, result.current.compilerSha256)
})

test("median comparison properties cover reordered cases, phase fan-in and noisy tails", async () => {
  const { compareTrials } = await load()
  let seed = 840085
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  for (let i = 0; i < 200; i++) {
    const value = 1 + Math.floor(random() * 10000)
    const report = trial(value)
    report.selected.push("other")
    report.cases.push({ ...clone(report.cases[0]), name: "other", wallMs: 2 * value + 20 })
    const base = Array.from({ length: 4 }, (_, index) => ({ ...clone(report), startedAt: new Date(1760000000000 + index).toISOString() }))
    const current = clone(base)
    // Workspace paths and execution order do not change a measurement's identity.
    for (const r of current) {
      r.compiler.path = "/other-workspace/compiler"
      r.selected.reverse()
      r.cases.reverse()
      for (const c of r.cases) c.commands.reverse()
    }
    // One large scheduling outlier cannot move the median.
    for (const c of current[0].cases) {
      c.wallMs *= 100
      for (const command of c.commands) command.wallMs *= 100
    }
    const result = compareTrials(base, current)
    assert.equal(result.regressions.length, 0)
    assert.ok(result.rows.every(row => row.ratio === 1))
    assert.equal(result.rows.length, 6)
  }
})

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang case timings-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const writeTrials = (dir, values) => {
    const target = path.join(root, dir)
    fs.mkdirSync(target, { recursive: true })
    values.forEach((value, i) => fs.writeFileSync(path.join(target, i + ".json"), JSON.stringify(value)))
    return target
  }
  const baseline = writeTrials("baseline", trials())
  const current = writeTrials("current", trials(200))
  const out = path.join(root, "results/result.json")
  const invoke = (...extra) => spawnSync(process.execPath, [script, "--baseline", baseline, "--current", current, "--out", out, ...extra], {
    encoding: "utf8", timeout: 30_000,
  })
  return { root, baseline, current, out, invoke }
}

test("timing CLI preserves inputs and writes nonblocking regressions to a new report", t => {
  const { baseline, out, invoke } = fixture(t)
  const before = fs.readFileSync(path.join(baseline, "0.json"))
  const result = invoke()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /REGRESSION.*stack-depth.*run/)
  const report = JSON.parse(fs.readFileSync(out, "utf8"))
  assert.equal(report.valid, true)
  assert.equal(report.baseline.files.length, 3)
  assert.ok(report.regressions.length > 0)
  const preserved = fs.readFileSync(out)
  const again = invoke()
  assert.equal(again.status, 2)
  assert.match(again.stderr, /already exists/)
  assert.deepEqual(fs.readFileSync(out), preserved)
  assert.deepEqual(fs.readFileSync(path.join(baseline, "0.json")), before)
})

test("timing CLI retains invalid evidence instead of reporting a green comparison", t => {
  const { baseline, current, out, invoke } = fixture(t)
  // Repeated copies of the same trial cannot satisfy the minimum sample count.
  fs.rmSync(path.join(current, "1.json"))
  fs.symlinkSync(path.join(current, "0.json"), path.join(current, "1.json"))
  let result = invoke()
  assert.equal(result.status, 2)
  assert.match(result.stderr, /duplicate trial/)
  let report = JSON.parse(fs.readFileSync(out, "utf8"))
  assert.equal(report.valid, false)
  assert.equal(report.rows, undefined)
  fs.rmSync(out)
  fs.rmSync(path.join(current, "1.json"))
  fs.writeFileSync(path.join(current, "1.json"), '{"complete":false}')
  result = invoke()
  assert.equal(result.status, 2)
  report = JSON.parse(fs.readFileSync(out, "utf8"))
  assert.equal(report.valid, false)
  assert.equal(report.baselinePath, baseline)
  assert.equal(report.currentPath, current)
})

test("timing CLI rejects repeated and unknown options", t => {
  const { invoke } = fixture(t)
  for (const args of [["--out", "other.json"], ["--unknown"], ["--baseline"]]) {
    const result = invoke(...args)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /usage:/)
  }
})

const compareAt = (baseline, current, out) => spawnSync(process.execPath, [
  script, "--baseline", baseline, "--current", current, "--out", out,
], { encoding: "utf8", timeout: 30_000 })

for (const scenario of ["baseline", "current", "nested", "input alias", "output alias", "normalized path", "escaped output alias"]) {
  test("timing output preserves trial inputs: " + scenario, t => {
    const f = fixture(t)
    let baseline = f.baseline, current = f.current, out
    if (scenario === "input alias") {
      baseline = path.join(f.root, "baseline alias")
      fs.symlinkSync(f.baseline, baseline, "dir")
      out = path.join(f.baseline, "comparison.json")
    } else if (scenario === "output alias") {
      const alias = path.join(f.root, "output alias")
      fs.symlinkSync(f.current, alias, "dir")
      out = path.join(alias, "uncreated/result.json")
    } else if (scenario === "escaped output alias") {
      const outside = path.join(f.root, "outside")
      fs.mkdirSync(outside)
      const alias = path.join(f.baseline, "existing-output-directory")
      fs.symlinkSync(outside, alias, "dir")
      out = path.join(alias, "comparison.json")
    } else if (scenario === "nested") out = path.join(f.baseline, "uncreated/result.json")
    else if (scenario === "normalized path") out = path.join(f.root, "uncreated", "..", "current", "result.json")
    else out = path.join(scenario === "baseline" ? baseline : current, "comparison.json")
    const snapshot = dir => fs.readdirSync(dir).map(name => {
      const file = path.join(dir, name), stat = fs.lstatSync(file)
      return [name, stat.isSymbolicLink() ? ["symlink", fs.readlinkSync(file)]
        : stat.isDirectory() ? ["directory"] : ["file", fs.readFileSync(file, "utf8")]]
    })
    const before = [f.baseline, f.current].map(snapshot)
    const result = compareAt(baseline, current, out)
    assert.ifError(result.error)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.match(result.stderr, /output.*outside.*trial|output.*inside.*trial/i)
    assert.equal(fs.existsSync(out), false, "invalid output must not be created")
    const after = [f.baseline, f.current].map(snapshot)
    assert.deepEqual(after, before, "trial directories and bytes remain unchanged")
  })
}

test("generated nested output mistakes do not create directories among trials", t => {
  const f = fixture(t)
  for (let i = 0; i < 32; i++) {
    const input = i % 2 ? f.baseline : f.current
    const out = path.join(input, "new-" + i, "more", "result.json")
    const result = compareAt(f.baseline, f.current, out)
    assert.ifError(result.error)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.match(result.stderr, /output.*outside.*trial|output.*inside.*trial/i)
    assert.equal(fs.existsSync(path.join(input, "new-" + i)), false)
    assert.equal(fs.readdirSync(input).length, 3)
  }
})

test("sibling names and unrelated symlinked output directories remain valid", t => {
  for (const alias of [false, true]) {
    const f = fixture(t)
    const sibling = f.baseline + "-comparisons"
    fs.mkdirSync(sibling)
    let dir = sibling
    if (alias) {
      dir = path.join(f.root, "unrelated alias")
      fs.symlinkSync(sibling, dir, "dir")
    }
    const out = path.join(dir, "nested/result.json")
    const result = compareAt(f.baseline, f.current, out)
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).valid, true)
    assert.equal(fs.readdirSync(f.baseline).length, 3)
    assert.equal(fs.readdirSync(f.current).length, 3)
  }
})

test("bad input archives still retain an invalid-evidence receipt outside the trials", t => {
  for (const unavailable of ["missing", "file"]) {
    const f = fixture(t)
    fs.rmSync(f.baseline, { recursive: true })
    if (unavailable === "file") fs.writeFileSync(f.baseline, "not a directory")
    const result = compareAt(f.baseline, f.current, f.out)
    assert.ifError(result.error)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    const report = JSON.parse(fs.readFileSync(f.out, "utf8"))
    assert.equal(report.valid, false)
    assert.equal(report.baselinePath, f.baseline)
    assert.equal(report.currentPath, f.current)
  }
})
