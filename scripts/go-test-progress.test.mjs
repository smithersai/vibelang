import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, delimiter } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { processKinds, progressState } from "./go-test-progress.mjs"

const script = fileURLToPath(new URL("./go-test-progress.mjs", import.meta.url))
function fixture(t, body) {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // This is a process/stream fixture, not a compiler or a Go admission implementation.
  writeFileSync(join(dir, "fixture.mjs"), body)
  writeFileSync(join(dir, "go"), '#!/bin/sh\nexec "' + process.execPath + '" "' + join(dir, "fixture.mjs") + '" "$@"\n', { mode: 0o700 })
  return { ...process.env, PATH: dir, OBSERVABILITY_TEST_VALUE: "private-fixture-value" }
}
const args = [script, "go", "test", "-json", "-count=1", "private-fixture-argument"]

test("Go progress counts fragmented events and recovers after a bounded oversized line", () => {
  const observer = progressState(), events = []
  const consume = text => observer.consume(text, event => events.push(event))
  consume('{"Action":"sta')
  consume('rt","Package":"fixture"}\n{"Action":"run","Test":"TestOne"}\n')
  consume('{"Action":"output","Output":"' + "x".repeat(70000))
  consume('"}\n{"Action":"pass","Test":"TestOne"}\nnot-json\n')
  consume('{"Action":"pass","Package":"fixture"}\n')
  assert.deepEqual(observer.state, { packagesStarted: 1, packagesFinished: 1, testsStarted: 1, testsFinished: 1, buildFailures: 0 })
  assert.deepEqual(events, ["package-start", "package-pass"])
})

test("Go progress classifies only bounded executable kinds, tolerating missing and cyclic processes", t => {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-proc-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [pid, exe, children] of [[1,"bash","2"], [2,"go","3 4 9"], [3,"compile","1"], [4,"vibelang.test",""]]) {
    const base = join(dir, String(pid))
    mkdirSync(join(base, "task", String(pid)), { recursive: true })
    symlinkSync("/private-fixture-path/" + exe, join(base, "exe"))
    writeFileSync(join(base, "task", String(pid), "children"), children)
  }
  assert.deepEqual(processKinds(1, dir), { launcher: 1, go: 1, compile: 1, link: 0, test: 1, other: 0 })
  assert.equal(processKinds(999, dir), null)
})

for (const code of [0, 7]) test("Go progress preserves output and exit " + code + " without logging arguments or environment", t => {
  const output = '{"Action":"start","Package":"fixture"}\n{"Action":"run","Test":"TestUnicode"}\n' +
    '{"Action":"output","Output":"λ private-fixture-value"}\n' +
    '{"Action":"' + (code ? "fail" : "pass") + '","Test":"TestUnicode"}\n' +
    '{"Action":"' + (code ? "fail" : "pass") + '","Package":"fixture"}\n'
  const env = fixture(t, "const b=Buffer.from(" + JSON.stringify(output) + "); const split=b.indexOf(Buffer.from(\"λ\"))+1; process.stdout.write(b.subarray(0,split)); setImmediate(()=>{process.stdout.write(b.subarray(split)); process.exitCode=" + code + "})")
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 10000 })
  assert.equal(result.status, code, result.stderr)
  assert.equal(result.stdout, output)
  assert.match(result.stderr, /event=start.*packages_started=0/)
  assert.match(result.stderr, /event=package-start.*phase=tests/)
  assert.match(result.stderr, /event=finish.*packages_finished=1.*tests_finished=1.*cause=exit code=/)
  assert.match(result.stderr, /event=finish.*build_failures=0/)
  assert.doesNotMatch(result.stderr, /event=build-fail|phase=build-failed/)
  assert.doesNotMatch(result.stderr, /private-fixture-(value|argument|path)/)
})

test("Go progress records spawn failure without leaking command arguments", t => {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-empty-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, args, { env: { ...process.env, PATH: dir }, encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /event=finish.*cause=spawn code=ENOENT/)
  assert.doesNotMatch(result.stderr, /private-fixture-argument/)
})

test("Go progress requires JSON test events", () => {
  const result = spawnSync(process.execPath, [script, "go", "test"], { encoding: "utf8" })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /usage:/)
})

test("Go progress forwards termination and reports the signal", async t => {
  const env = fixture(t, 'process.stdout.write(\'{"Action":"start","Package":"fixture"}\\n\'); setInterval(()=>{},1000)')
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] })
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL") })
  let stderr = ""
  child.stderr.on("data", chunk => { stderr += chunk })
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (code, signal) => resolve({ code, signal }))
  })
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve)
    child.once("error", reject)
    child.once("close", () => reject(new Error("fixture closed before startup")))
  })
  child.kill("SIGTERM")
  const result = await closed
  assert.deepEqual(result, { code: 143, signal: null })
  assert.match(stderr, /event=finish.*cause=signal.*signal=SIGTERM/)
})

test("Go progress is invariant across seeded stream chunk boundaries", () => {
  const lines = [
    { Action: "start", Package: "fixture" },
    { Action: "run", Test: "TestParent" },
    { Action: "run", Test: "TestParent/λ" },
    { Action: "output", Output: "arbitrary output stays outside metadata" },
    { Action: "skip", Test: "TestParent/λ" },
    { Action: "fail", Test: "TestParent" },
    { Action: "fail", Package: "fixture" }
  ].map(x => JSON.stringify(x) + "\n").join("")
  for (let seed = 1; seed <= 64; seed++) {
    let random = seed, offset = 0
    const observer = progressState(), events = []
    while (offset < lines.length) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      const width = 1 + random % 29
      observer.consume(lines.slice(offset, offset + width), event => events.push(event))
      offset += width
    }
    assert.deepEqual(observer.state, { packagesStarted: 1, packagesFinished: 1, testsStarted: 2, testsFinished: 2, buildFailures: 0 }, "seed " + seed)
    assert.deepEqual(events, ["package-start", "package-fail"], "seed " + seed)
  }
})

test("Go progress preserves real native test events and pass/fail exits", { timeout: 600_000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-native-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, "go.mod"), "module progress.fixture\n\ngo 1.27\n")
  writeFileSync(join(dir, "progress_test.go"), `package progress
import "testing"
func TestProgressPass(t *testing.T) { t.Log("real native output λ") }
func TestProgressFail(t *testing.T) { t.Fatal("intentional native failure") }
`)
  // Like go-test-cache.test.mjs, run the small native fixture with the
  // selected toolchain directly, inside the caller's admitted test job.
  const goroot = spawnSync("go", ["env", "GOROOT"], { encoding: "utf8" })
  assert.equal(goroot.status, 0, goroot.stderr)
  const nativePath = join(goroot.stdout.trim(), "bin") + delimiter + process.env.PATH
  for (const [pattern, code, finished] of [["^TestProgressPass$", 0, 1], ["^TestProgress", 1, 2]]) {
    const result = spawnSync(process.execPath,
      [script, "go", "test", "-json", "-count=1", "-p", "8", "-run", pattern, "."],
      { cwd: dir, env: { ...process.env, GOMAXPROCS: "8", GOFLAGS: "", GOWORK: "off", PATH: nativePath },
        encoding: "utf8", timeout: 280_000 })
    assert.equal(result.status, code, result.stdout + result.stderr)
    const items = result.stdout.trim().split("\n").map(line => JSON.parse(line))
    assert.ok(items.some(item => item.Test === "TestProgressPass" && item.Action === "pass"))
    if (code) assert.ok(items.some(item => item.Test === "TestProgressFail" && item.Action === "fail"))
    assert.match(result.stdout, /real native output λ/)
    assert.match(result.stderr, new RegExp("event=finish.*packages_finished=1.*tests_finished=" + finished + ".*cause=exit code=" + code))
    assert.match(result.stderr, /event=start.*packages_started=0/)
  }
})

const buildCorpus = readFileSync(new URL("./testdata/go-progress/vibelang-parser-arity-build-fail.jsonl", import.meta.url), "utf8")

test("Go progress counts build failures across fragmented and mixed streams", () => {
  for (let seed = 1; seed <= 128; seed++) {
    const mixed = seed % 2 === 0
    const stream = '{"Action":"build-output","ImportPath":"private-fixture-path","Output":"' + "x".repeat(70000) + '"}\n' + buildCorpus +
      '{"Action":"build-fail","Test":"not-a-build-event"}\nnull\nnot-json\n' +
      (mixed ? '{"Action":"start","Package":"other"}\n{"Action":"run","Test":"TestOther"}\n{"Action":"pass","Test":"TestOther"}\n{"Action":"pass","Package":"other"}\n' : "")
    const observer = progressState(), events = []
    let offset = 0, random = seed
    while (offset < stream.length) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      const width = 1 + random % 4093
      observer.consume(stream.slice(offset, offset + width), event => events.push(event))
      offset += width
    }
    assert.deepEqual(observer.state, {
      packagesStarted: mixed ? 2 : 1, packagesFinished: mixed ? 2 : 1,
      testsStarted: mixed ? 1 : 0, testsFinished: mixed ? 1 : 0, buildFailures: 1,
    }, "seed " + seed)
    assert.deepEqual(events, ["build-fail", "package-start", "package-fail",
      ...(mixed ? ["package-start", "package-pass"] : [])], "seed " + seed)
  }
})

test("Go progress reports build failures while preserving native JSON bytes and exit", t => {
  const output = buildCorpus.replaceAll("not enough arguments", "private-fixture-value not enough arguments")
  const env = fixture(t, "process.stdout.write(" + JSON.stringify(output) + "); process.exitCode=1")
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 10000 })
  assert.equal(result.status, 1, result.stderr)
  assert.equal(result.stdout, output)
  assert.match(result.stderr, /event=build-fail.*phase=build-failed.*build_failures=1/)
  assert.match(result.stderr, /event=finish.*phase=build-failed.*tests_started=0.*tests_finished=0.*build_failures=1.*cause=exit code=1/)
  assert.doesNotMatch(result.stderr, /private-fixture-(value|argument|path)|vibelang_effect_assertion|github\.com/)
})

test("Go progress observes a real native build failure before any test runs", { timeout: 600_000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-build-failure-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, "go.mod"), "module progress.build.fixture\n\ngo 1.27\n")
  writeFileSync(join(dir, "broken_test.go"), `package progress
import "testing"
func TestNeverStarted(t *testing.T) { MissingForBuildFailure() }
`)
  const goroot = spawnSync("go", ["env", "GOROOT"], { encoding: "utf8" })
  assert.equal(goroot.status, 0, goroot.stderr)
  const result = spawnSync(process.execPath, [script, "go", "test", "-json", "-count=1", "-p", "8", "."], {
    cwd: dir, env: { ...process.env, GOMAXPROCS: "4", GOFLAGS: "", GOWORK: "off",
      PATH: join(goroot.stdout.trim(), "bin") + delimiter + process.env.PATH },
    encoding: "utf8", timeout: 280_000,
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const items = result.stdout.trim().split("\n").map(line => JSON.parse(line))
  const failures = items.filter(item => item.Action === "build-fail").length
  assert.ok(failures >= 1, result.stdout)
  assert.equal(items.filter(item => item.Action === "run" && item.Test).length, 0)
  assert.match(result.stdout, /undefined: MissingForBuildFailure/)
  assert.match(result.stderr, /event=build-fail.*phase=build-failed/)
  assert.match(result.stderr, new RegExp("event=finish.*phase=build-failed.*tests_started=0.*tests_finished=0.*build_failures=" + failures + ".*cause=exit code=1"))
  assert.doesNotMatch(result.stderr, /MissingForBuildFailure|broken_test\.go|progress\.build\.fixture/)
})

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) test("Go progress cancels descendants on " + signal, { timeout: 15_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-tree-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const receipt = join(dir, "receipt")
  const leaf = join(dir, "leaf.mjs")
  writeFileSync(leaf, `import { writeFileSync } from "node:fs"
const receipt = ${JSON.stringify(receipt)}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => {
  writeFileSync(receipt, signal); process.exit(0)
})
process.stdout.write("descendant-ready\\n")
setTimeout(() => { writeFileSync(receipt, "escaped"); process.exit(0) }, 1500)
`)
  const env = fixture(t, 'import { spawn } from "node:child_process"; const child=spawn(process.execPath, [' + JSON.stringify(leaf) + '], {stdio:"inherit"}); child.on("close", code => {process.exitCode=code})')
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] })
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL") })
  let stdout = "", stderr = ""
  child.stderr.on("data", bytes => { stderr += bytes })
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", bytes => { stdout += bytes; if (stdout.includes("descendant-ready\n")) resolve() })
    child.once("error", reject)
    child.once("close", () => reject(new Error("closed before descendant started: " + stderr)))
  })
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  await ready
  child.kill(signal)
  const result = await closed
  assert.equal(readFileSync(receipt, "utf8"), signal, "descendant must receive cancellation instead of finishing its work")
  assert.equal(result.code, { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 }[signal], stderr)
  assert.equal(result.signal, null)
  assert.equal(stdout, "descendant-ready\n")
  assert.match(stderr, new RegExp("event=finish.*cause=signal.*signal=" + signal))
  assert.doesNotMatch(stderr, /go-progress-tree-|private-fixture/)
})

test("Go progress cancellation reaches generated branching process trees", {
  timeout: 120_000, skip: process.platform === "win32"
}, async t => {
  for (let seed = 1; seed <= 12; seed++) {
    const signal = ["SIGHUP", "SIGINT", "SIGTERM"][seed % 3]
    const depth = 1 + seed % 3, width = 1 + seed % 2
    const expected = Array.from({ length: depth + 1 }, (_, i) => width ** i).reduce((a, b) => a + b)
    const dir = mkdtempSync(join(tmpdir(), "go-progress-branch-"))
    const worker = join(dir, "worker.mjs"), receipt = join(dir, "receipt")
    try {
      writeFileSync(worker, `import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
const depth = Number(process.argv[2]), width = Number(process.argv[3])
const receipt = ${JSON.stringify(receipt)}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => {
  appendFileSync(receipt, signal + "\\n"); process.exit(0)
})
if (depth > 0) for (let i = 0; i < width; i++) spawn(process.execPath, [
  fileURLToPath(import.meta.url), String(depth - 1), String(width)
], { stdio: "inherit" })
process.stdout.write("tree-ready\\n")
setTimeout(() => { appendFileSync(receipt, "escaped\\n"); process.exit(0) }, 10_000)
`)
      const env = fixture(t, 'import { spawn } from "node:child_process"; spawn(process.execPath, ' +
        JSON.stringify([worker, String(depth), String(width)]) + ', {stdio:"inherit"})')
      const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] })
      t.after(() => { if (child.exitCode === null) child.kill("SIGKILL") })
      let stdout = "", stderr = ""
      child.stderr.on("data", bytes => { stderr += bytes })
      const ready = new Promise((resolve, reject) => {
        child.stdout.on("data", bytes => {
          stdout += bytes
          if (stdout.split("\n").length - 1 === expected) resolve()
        })
        child.once("error", reject)
        child.once("close", () => reject(new Error("tree did not start: " + stderr)))
      })
      const closed = new Promise((resolve, reject) => {
        child.once("error", reject)
        child.once("close", (code, signal) => resolve({ code, signal }))
      })
      await ready
      child.kill(signal)
      const result = await closed
      assert.deepEqual(readFileSync(receipt, "utf8").trim().split("\n"), Array(expected).fill(signal), "seed " + seed)
      assert.equal(stdout, "tree-ready\n".repeat(expected))
      assert.equal(result.code, { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 }[signal], stderr)
      assert.equal(result.signal, null)
      assert.match(stderr, new RegExp("event=cancel.*signal=" + signal))
      assert.match(stderr, new RegExp("event=finish.*cause=signal.*signal=" + signal))
      assert.doesNotMatch(stderr, /go-progress-branch-|private-fixture/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

test("Go progress cancels a child of a real native Go test", {
  timeout: 600_000, skip: process.platform === "win32"
}, async t => {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-native-tree-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const receipt = join(dir, "receipt"), worker = join(dir, "worker.mjs")
  writeFileSync(worker, `import { writeFileSync } from "node:fs"
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => {
  writeFileSync(${JSON.stringify(receipt)}, signal); process.exit(0)
})
process.stdout.write("native-descendant-ready\\n")
setTimeout(() => { writeFileSync(${JSON.stringify(receipt)}, "escaped"); process.exit(0) }, 10_000)
`)
  writeFileSync(join(dir, "go.mod"), "module progress.fixture\n\ngo 1.27\n")
  writeFileSync(join(dir, "progress_test.go"), `package progress
import ("os"; "os/exec"; "testing")
func TestCancellation(t *testing.T) {
  child := exec.Command(os.Getenv("PROGRESS_NODE"), os.Getenv("PROGRESS_WORKER"))
  child.Stdout = os.Stdout
  child.Stderr = os.Stderr
  if err := child.Run(); err != nil { t.Fatal(err) }
}
`)
  const goroot = spawnSync("go", ["env", "GOROOT"], { encoding: "utf8" })
  assert.equal(goroot.status, 0, goroot.stderr)
  const nativePath = join(goroot.stdout.trim(), "bin") + delimiter + process.env.PATH
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    const child = spawn(process.execPath, [script, "go", "test", "-json", "-count=1", "-p", "8", "."], {
      cwd: dir, env: { ...process.env, PATH: nativePath, GOMAXPROCS: "8", GOFLAGS: "", GOWORK: "off",
        PROGRESS_NODE: process.execPath, PROGRESS_WORKER: worker }, stdio: ["ignore", "pipe", "pipe"]
    })
    t.after(() => { if (child.exitCode === null) child.kill("SIGKILL") })
    let stdout = "", stderr = ""
    child.stderr.on("data", bytes => { stderr += bytes })
    const ready = new Promise((resolve, reject) => {
      child.stdout.on("data", bytes => {
        stdout += bytes
        if (stdout.includes("native-descendant-ready")) resolve()
      })
      child.once("error", reject)
      child.once("close", () => reject(new Error("native test did not start: " + stdout + stderr)))
    })
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code, signal) => resolve({ code, signal }))
    })
    await ready
    child.kill(signal)
    const result = await closed
    assert.equal(readFileSync(receipt, "utf8"), signal)
    assert.equal(result.code, { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 }[signal], stderr)
    assert.equal(result.signal, null)
    assert.match(stderr, new RegExp("event=cancel.*signal=" + signal))
    assert.match(stderr, new RegExp("event=finish.*cause=signal.*signal=" + signal))
    assert.doesNotMatch(stderr, /go-progress-native-tree-|PROGRESS_NODE|PROGRESS_WORKER/)
  }
})


test("Go progress sees children owned by secondary threads across seeded process layouts", t => {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-threads-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (let seed = 1; seed <= 64; seed++) {
    const proc = join(dir, String(seed))
    const entry = (pid, exe, threads) => {
      mkdirSync(join(proc, String(pid)), { recursive: true })
      symlinkSync("/private-fixture-path/" + exe, join(proc, String(pid), "exe"))
      for (const [tid, children] of threads) {
        const task = join(proc, String(pid), "task", String(tid))
        mkdirSync(task, { recursive: true })
        if (children !== null) writeFileSync(join(task, "children"), children)
      }
    }
    const root = seed * 100, child = root + 10, leaf = root + 20
    entry(root, "go", [[root, seed % 3 ? "" : null], ["not-a-thread", String(leaf)], [root + 1, `${child} ${child} invalid 999999`], [root + 2, null]])
    entry(child, seed % 2 ? "compile" : "vibelang.test", [[child, ""], [child + 1, `${leaf} ${root}`]])
    entry(leaf, "link", [[leaf, ""]])
    assert.deepEqual(processKinds(root, proc), {
      launcher: 0, go: 1, compile: seed % 2 ? 1 : 0, link: 1, test: seed % 2 ? 0 : 1, other: 0
    }, "seed " + seed)
  }
})

test("Go progress samples a real subprocess launched from a non-main Go thread", { timeout: 600_000, skip: process.platform !== "linux" && "requires Linux per-thread process metadata" }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "go-progress-native-thread-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const source = join(dir, "thread.go"), binary = join(dir, "thread.test")
  writeFileSync(source, `package main
import ("os"; "os/exec"; "runtime")
func main() {
  runtime.LockOSThread()
  done := make(chan error)
  go func() {
    runtime.LockOSThread()
    cmd := exec.Command(os.Args[1], "-e", ${JSON.stringify('process.stdout.write("thread-child-ready\\n"); process.stdin.resume()')})
    cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
    done <- cmd.Run()
  }()
  if <-done != nil { os.Exit(1) }
}
`)
  const built = spawnSync("go", ["build", "-p", "8", "-o", binary, source], {
    env: { ...process.env, GOMAXPROCS: "2", GOWORK: "off" }, encoding: "utf8", timeout: 280_000
  })
  assert.equal(built.status, 0, built.stdout + built.stderr)
  const child = spawn(binary, [process.execPath], { env: { ...process.env, GOMAXPROCS: "2" }, stdio: ["pipe", "pipe", "pipe"] })
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  t.after(() => { child.stdin.end(); if (child.exitCode === null) child.kill("SIGTERM") })
  let stdout = "", stderr = ""
  child.stderr.on("data", chunk => { stderr += chunk })
  await new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => { stdout += chunk; if (stdout.includes("thread-child-ready\n")) resolve() })
    child.once("error", reject)
    child.once("close", () => reject(new Error("native fixture exited before its child: " + stderr)))
  })
  const tasks = join("/proc", String(child.pid), "task")
  const mainChildren = readFileSync(join(tasks, String(child.pid), "children"), "utf8").trim()
  const secondaryChildren = readdirSync(tasks).filter(tid => tid !== String(child.pid)).flatMap(tid => {
    try { return readFileSync(join(tasks, tid, "children"), "utf8").trim().split(/\s+/).filter(Boolean) }
    catch { return [] }
  })
  const sampled = processKinds(child.pid)
  child.stdin.end()
  assert.deepEqual(await closed, { code: 0, signal: null }, stderr)
  assert.equal(mainChildren, "", "the witness must use a non-main native thread")
  assert.ok(secondaryChildren.length >= 1, "the native subprocess must exist in a secondary thread")
  assert.deepEqual(sampled, { launcher: 0, go: 0, compile: 0, link: 0, test: 1, other: 1 })
})
