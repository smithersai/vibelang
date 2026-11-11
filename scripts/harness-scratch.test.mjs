import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const source = fileURLToPath(new URL("../typescript/vibelang/", import.meta.url))
function snapshot(root) {
  const result = {}
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name), name = path.relative(root, at)
      const stat = fs.lstatSync(at)
      result[name] = [stat.mode, stat.mtimeMs, stat.ctimeMs, entry.isSymbolicLink() ? fs.readlinkSync(at) :
        entry.isFile() ? createHash("sha256").update(fs.readFileSync(at)).digest("hex") : "directory"]
      if (entry.isDirectory()) walk(at)
    }
  }
  walk(root)
  return result
}
function chmodTree(dir, writable) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) chmodTree(at, writable)
    else fs.chmodSync(at, fs.statSync(at).mode & ~0o222 | (writable ? 0o200 : 0))
  }
  fs.chmodSync(dir, writable ? 0o755 : 0o555)
}
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "harness scratch "))
  const repo = path.join(temp, "repo"), scratch = path.join(temp, "scratch")
  const put = (name, text, mode) => {
    const at = path.join(repo, name)
    fs.mkdirSync(path.dirname(at), { recursive: true })
    fs.writeFileSync(at, text, mode ? { mode } : {})
  }
  t.after(() => { chmodTree(repo, true); fs.rmSync(temp, { recursive: true, force: true }) })
  for (const file of ["harness.mjs", "harness-command.mjs", "late-start-scheduler.mjs"]) {
    put("typescript/vibelang/" + file, fs.readFileSync(path.join(source, file)))
  }
  put("typescript/package.json", '{"type":"module"}')
  put("typescript/vibelang/cases/package.json", '{"type":"module"}')
  put("typescript/vibelang/cases/shared.mjs", 'export const value = 42')
  put("typescript/vibelang/helper.mjs", 'export const value = 42')
  put("typescript/.cache/keep", "original cache")
  put("typescript/vibelang/test/cache.mjs", 'import fs from "node:fs"; import { fileURLToPath } from "node:url"; export function cache() { const at = new URL("../../.cache/helper", import.meta.url); fs.mkdirSync(at, { recursive: true }); fs.writeFileSync(new URL("entry", at.href + "/"), "private"); return fileURLToPath(at) }')
  put("package.json", '{"type":"module"}')
  put("runtime/package.json", '{"name":"vibelang-runtime","files":[]}')
  put("runtime/dist/index.js", "")
  put("modules/effect/package.json", '{"name":"effect","version":"4.1.0"}')
  put("typescript/built/local/tsc", `#!/usr/bin/env node
import fs from "node:fs"
if (fs.existsSync("expected-error")) { console.log("main.ts(1,1): error TS9999: expected"); process.exit(1) }
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'console.log(42)')
`, 0o755)
  for (const name of ["pass", "expected-error", "custom", "failure"]) {
    put("typescript/vibelang/cases/" + name + "/tsconfig.json", "{}")
    put("typescript/vibelang/cases/" + name + "/main.ts", name === "expected-error" ? "// expect: TS9999\n" : "export const n = 42")
    put("typescript/vibelang/cases/" + name + "/expected/stdout.txt", name === "failure" ? "wrong\n" : "42\n")
  }
  put("typescript/vibelang/cases/expected-error/expected-error", "")
  put("typescript/vibelang/cases/custom/run.mjs", `import { value } from "../shared.mjs"
import { value as other } from "../../helper.mjs"
import { cache } from "../../test/cache.mjs"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
assert.equal(value, other)
assert.ok(cache().startsWith(process.env.EXPECT_SCRATCH))
for (const dir of [os.tmpdir(), os.homedir()]) {
  assert.ok(dir.startsWith(process.env.EXPECT_SCRATCH), dir)
  fs.writeFileSync(path.join(dir, "child-output"), "private")
}
console.log(value)
`)
  const harness = path.join(repo, "typescript/vibelang/harness.mjs")
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(repo, "modules"), VIBELANG_RUNTIME: path.join(repo, "runtime"), EXPECT_SCRATCH: scratch }
  return { repo, scratch, invoke: (args, extraEnv = {}) => spawnSync(process.execPath, [harness, ...args], { cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 30_000 }) }
}

test("scratch cases run against a read-only repository without changing any path", t => {
  const f = fixture(t)
  chmodTree(f.repo, false)
  const before = snapshot(f.repo)
  const result = f.invoke(["--isolated", "--scratch", f.scratch, "pass", "expected-error", "custom"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /3 ok, 0 FAIL/)
  assert.deepEqual(snapshot(f.repo), before)
  assert.deepEqual(fs.readdirSync(f.scratch), [], "successful run must remove its private tree")
})

test("failed scratch runs retain copies, helper temporary files and command logs", t => {
  const f = fixture(t), before = snapshot(f.repo)
  const result = f.invoke(["--scratch", f.scratch, "--status", "failure"])
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const logFile = /log: +(.+?)(?:\)|$)/m.exec(result.stdout)?.[1]
  assert.ok(logFile?.startsWith(f.scratch), result.stdout)
  const log = JSON.parse(fs.readFileSync(logFile, "utf8"))
  assert.ok(log.commands[0].cwd.startsWith(f.scratch))
  assert.ok(fs.existsSync(path.join(log.commands[0].cwd, "out/main.js")))
  assert.match(result.stdout, /scratch: /)
  assert.deepEqual(snapshot(f.repo), before)
})

test("scratch options and paths cannot cause writes inside the repository", t => {
  const f = fixture(t), before = snapshot(f.repo)
  fs.symlinkSync(f.repo, path.join(path.dirname(f.repo), "alias"), "dir")
  for (const args of [
    ["--scratch"], ["--scratch", "--status"], ["--scratch", f.scratch, "--scratch", f.scratch],
    ["--scratch", path.join(f.repo, "new")],
    ["--scratch", path.join(path.dirname(f.repo), "alias", "new")],
    ["--isolated", "--report", path.join(f.repo, "report.json")],
  ]) {
    const result = f.invoke([...args, "pass"])
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.deepEqual(snapshot(f.repo), before)
  }
})

test("default isolation uses TMPDIR and relative reports stay in scratch", t => {
  const f = fixture(t)
  // Relative reports are resolved inside the private run, never against cwd.
  const result = f.invoke(["--scratch", f.scratch, "--report", "timings.json", "pass"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const report = /report: (.+)/.exec(result.stdout)?.[1]
  assert.ok(report?.startsWith(f.scratch), result.stdout)
  const receipt = JSON.parse(fs.readFileSync(report, "utf8"))
  assert.equal(receipt.complete, true)
  assert.equal(receipt.cases[0].status, "ok")
  assert.deepEqual(fs.readdirSync(path.dirname(report)), ["timings.json"])
  assert.equal(fs.existsSync(receipt.cases[0].commands[0].cwd), false)
})

test("isolated without a scratch option defaults to a fresh TMPDIR child", t => {
  const f = fixture(t)
  fs.mkdirSync(f.scratch)
  const before = snapshot(f.repo)
  const result = f.invoke(["--isolated", "pass"], { TMPDIR: f.scratch })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(snapshot(f.repo), before)
  assert.deepEqual(fs.readdirSync(f.scratch), [])
})

test("reports survive successful cleanup under work-like directory names", t => {
  const f = fixture(t)
  for (const prefix of ["repo", "tmp", "home", "logs"]) {
    const result = f.invoke(["--scratch", f.scratch, "--report", prefix + "/timings.json", "pass"])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const report = /report: (.+)/.exec(result.stdout)?.[1]
    assert.ok(report, result.stdout)
    assert.equal(JSON.parse(fs.readFileSync(report, "utf8")).complete, true)
  }
})

test("a report cannot overwrite a failing case's command evidence", t => {
  const f = fixture(t)
  const result = f.invoke(["--scratch", f.scratch, "--report", "logs/failure.json", "failure"])
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const report = /report: (.+)/.exec(result.stdout)?.[1]
  const log = /log: +(.+?)(?:\)|$)/m.exec(result.stdout)?.[1]
  assert.notEqual(report, log)
  assert.equal(JSON.parse(fs.readFileSync(report, "utf8")).complete, true)
  assert.equal(JSON.parse(fs.readFileSync(log, "utf8")).case, "failure")
})

test("scratch cases can read sibling fixtures before and after execution", t => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.repo, "typescript/vibelang/cases/fixture-inputs"))
  fs.writeFileSync(path.join(f.repo, "typescript/vibelang/cases/fixture-inputs/value.txt"), "fixture input")
  fs.writeFileSync(path.join(f.repo, "typescript/vibelang/cases/pass/run.mjs"), `
import assert from "node:assert/strict"
import fs from "node:fs"
assert.match(fs.readFileSync(new URL("../expected-error/main.ts", import.meta.url), "utf8"), /expect: TS9999/)
assert.equal(fs.readFileSync(new URL("../fixture-inputs/value.txt", import.meta.url), "utf8"), "fixture input")
fs.writeFileSync(new URL("../fixture-inputs/child-output", import.meta.url), "private")
console.log(42)
`)
  chmodTree(f.repo, false)
  const before = snapshot(f.repo)
  for (const jobs of [1, 2]) for (const names of [["pass"], ["pass", "expected-error"], ["expected-error", "pass"]]) {
    const result = f.invoke(["--scratch", f.scratch, "--jobs", String(jobs), ...names])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(snapshot(f.repo), before)
    assert.deepEqual(fs.readdirSync(f.scratch), [], "successful input copies must be removed")
  }
})
