import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const here = path.dirname(fileURLToPath(import.meta.url))

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-harness-test-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, "typescript")
  const dir = path.join(root, "vibelang")
  fs.mkdirSync(dir, { recursive: true })
  for (const file of ["harness.mjs", "harness-command.mjs"]) {
    if (fs.existsSync(path.join(here, file))) fs.copyFileSync(path.join(here, file), path.join(dir, file))
  }
  const compiler = path.join(root, "built/local/tsc")
  fs.mkdirSync(path.dirname(compiler), { recursive: true })
  fs.writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
const scenario = fs.readFileSync("scenario", "utf8")
console.log("compile stdout " + scenario)
console.error("compile stderr " + scenario)
if (scenario === "compile") {
  console.log("main.vibe(1,1): error TS9999: deliberate failure")
  process.exit(1)
}
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'console.log("wrong " + ' + JSON.stringify(scenario) + '); console.error("runtime stderr"); process.exit(7)')
`, { mode: 0o755 })
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}')
  fs.mkdirSync(path.join(root, "runtime/dist"), { recursive: true })
  fs.writeFileSync(path.join(root, "runtime/package.json"), JSON.stringify({
    name: "vibelang-runtime", type: "module", files: ["dist"], exports: "./dist/index.js",
  }))
  fs.writeFileSync(path.join(root, "runtime/dist/index.js"), 'export const name = "runtime"\n')
  for (const name of ["compile", "runtime"]) {
    const at = path.join(dir, "cases", name)
    fs.mkdirSync(path.join(at, "expected"), { recursive: true })
    fs.writeFileSync(path.join(at, "scenario"), name)
    fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
    fs.writeFileSync(path.join(at, "expected/stdout.txt"), "expected\n")
  }
  return { root, harness: path.join(dir, "harness.mjs"), compiler }
}

test("status failures retain per-case command evidence across reruns", (t) => {
  const { root, harness, compiler } = fixture(t)
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const invoke = () => spawnSync(process.execPath, [harness, "--status", "--jobs", "2"], { env, encoding: "utf8", timeout: 10_000 })
  const result = invoke()
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const paths = [...result.stdout.matchAll(/log: (.+?)(?:\)|$)/gm)].map((m) => m[1])
  assert.equal(paths.length, 2, "each failing status line must name its log:\n" + result.stdout)
  const logs = paths.map((file) => JSON.parse(fs.readFileSync(file, "utf8")))
  for (const record of logs) {
    assert.equal(record.case, path.basename(record.commands[0].cwd))
    assert.ok(record.detail)
    const compile = record.commands[0]
    assert.equal(compile.phase, "compile")
    assert.equal(compile.command, compiler)
    assert.deepEqual(compile.argv, ["-p", ".", "--pretty", "false"])
    assert.equal(compile.timeoutMs, 120_000)
    assert.equal(Date.parse(compile.deadline) - Date.parse(compile.startedAt), 120_000)
    assert.match(compile.stdoutTail, new RegExp("compile stdout " + record.case))
    assert.match(compile.stderrTail, new RegExp("compile stderr " + record.case))
    assert.equal(compile.exitCode, record.case === "compile" ? 1 : 0)
    assert.equal(compile.timedOut, false)
    if (record.case === "runtime") {
      const run = record.commands[1]
      assert.equal(run.phase, "run")
      assert.equal(run.command, "node")
      assert.equal(run.exitCode, 7)
      assert.equal(run.timeoutMs, 60_000)
      assert.match(run.stdoutTail, /wrong runtime/)
      assert.match(run.stderrTail, /runtime stderr/)
    }
  }
  const again = invoke()
  assert.equal(again.status, 1, again.stdout + again.stderr)
  const secondPaths = [...again.stdout.matchAll(/log: (.+?)(?:\)|$)/gm)].map((m) => m[1])
  assert.equal(secondPaths.length, 2)
  assert.ok(secondPaths.every((file) => !paths.includes(file)), "reruns must preserve prior evidence")
  for (const file of paths) assert.ok(fs.existsSync(file))
})

test("command evidence records deadline kills, spawn errors, and bounded tails", async () => {
  const { CaseCommands } = await import("./harness-command.mjs")
  const commands = new CaseCommands()
  const timed = await commands.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { phase: "run", timeout: 30 })
  assert.equal(timed.code, "killed by SIGKILL")
  assert.equal(commands.records[0].timedOut, true)
  assert.equal(commands.records[0].signal, "SIGKILL")
  assert.equal(commands.records[0].exitCode, null)
  const missing = await commands.run(path.join(os.tmpdir(), "missing-vibelang-command", "tsc"), [], { phase: "compile", timeout: 1000 })
  assert.equal(missing.code, "ENOENT")
  assert.match(commands.records[1].error, /ENOENT/)
  await commands.run(process.execPath, ["-e", 'console.log("x".repeat(50000) + "stdout end"); console.error("y".repeat(50000) + "stderr end")'], { phase: "run", timeout: 1000 })
  assert.ok(commands.records[2].stdoutTail.length <= 16_384)
  assert.ok(commands.records[2].stderrTail.length <= 16_384)
  assert.match(commands.records[2].stdoutTail, /stdout end\n$/)
  assert.match(commands.records[2].stderrTail, /stderr end\n$/)
})

test("a case's stubs resolve as the packages they name", (t) => {
  const { root, harness, compiler } = fixture(t)
  fs.writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'import { name } from "@scope/platform"; console.log(name)')
`, { mode: 0o755 })
  const at = path.join(root, "vibelang", "cases", "stubbed")
  fs.mkdirSync(path.join(at, "expected"), { recursive: true })
  fs.mkdirSync(path.join(at, "stubs", "platform"), { recursive: true })
  fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
  fs.writeFileSync(path.join(at, "expected/stdout.txt"), "the stub\n")
  fs.writeFileSync(path.join(at, "stubs/platform/package.json"), '{ "name": "@scope/platform", "type": "module", "main": "./index.js" }')
  fs.writeFileSync(path.join(at, "stubs/platform/index.js"), 'export const name = "the stub"\n')
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const result = spawnSync(process.execPath, [harness, "stubbed"], { env, encoding: "utf8", timeout: 10_000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /^ok {6}stubbed$/m)
  assert.equal(fs.realpathSync(path.join(at, "node_modules/@scope/platform")), fs.realpathSync(path.join(at, "stubs/platform")))
})

test("runtime files use the case's peers without exposing development dependencies", (t) => {
  const { root, harness, compiler } = fixture(t)
  const runtime = path.join(root, "runtime")
  fs.mkdirSync(path.join(runtime, "node_modules/@scope/platform"), { recursive: true })
  fs.writeFileSync(path.join(runtime, "node_modules/@scope/platform/package.json"), '{"type":"module","exports":"./index.js"}')
  fs.writeFileSync(path.join(runtime, "node_modules/@scope/platform/index.js"), 'export const name = "development"')
  fs.writeFileSync(path.join(runtime, "dist/index.js"), 'export { name } from "@scope/platform"')
  fs.writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'import { name } from "vibelang-runtime"; console.log(name)')
`, { mode: 0o755 })
  const at = path.join(root, "vibelang/cases/stubbed")
  fs.mkdirSync(path.join(at, "expected"), { recursive: true })
  fs.mkdirSync(path.join(at, "stubs/platform"), { recursive: true })
  fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
  fs.writeFileSync(path.join(at, "expected/stdout.txt"), "the project's peer\n")
  fs.writeFileSync(path.join(at, "stubs/platform/package.json"), '{"name":"@scope/platform","type":"module","exports":"./index.js"}')
  fs.writeFileSync(path.join(at, "stubs/platform/index.js"), 'export const name = "the project\'s peer"')
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: runtime }
  const invoke = () => spawnSync(process.execPath, [harness, "stubbed"], { env, encoding: "utf8", timeout: 10_000 })
  let result = invoke()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(!fs.existsSync(path.join(at, "node_modules/vibelang-runtime/node_modules/@scope/platform")))
  // A rerun sees rebuilt files, rather than a stale copy of dist.
  fs.writeFileSync(path.join(runtime, "dist/index.js"), 'export const name = "rebuilt"')
  fs.writeFileSync(path.join(at, "expected/stdout.txt"), "rebuilt\n")
  result = invoke()
  assert.equal(result.status, 0, result.stdout + result.stderr)
})


test("isolated failures retain their private output and command evidence", (t) => {
  const { root, harness } = fixture(t)
  const original = path.join(root, "vibelang/cases/runtime")
  const result = spawnSync(process.execPath, [harness, "--isolated", "--status", "runtime"], {
    env: { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") },
    encoding: "utf8", timeout: 10_000,
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const logFile = /log: (.+)[)]/.exec(result.stdout)?.[1]
  assert.ok(logFile, result.stdout)
  const log = JSON.parse(fs.readFileSync(logFile, "utf8"))
  const dir = log.commands[0].cwd
  assert.notEqual(dir, original)
  assert.ok(fs.existsSync(path.join(dir, "out/main.js")))
  assert.ok(fs.existsSync(path.join(dir, "node_modules/vibelang-runtime/package.json")))
  assert.equal(fs.existsSync(path.join(original, "out")), false)
  assert.equal(fs.existsSync(path.join(original, "node_modules")), false)
})

// Load the real target declarations with inert build-graph inputs. Execute
// their actual shell commands against a compiler that coordinates the overlap;
// this neither needs a Go build nor recursively invokes the release target.
test("the late-start target and a per-case target compile concurrently without sharing files", { timeout: 60_000 }, async (t) => {
  const { root, compiler } = fixture(t)
  const checkout = path.dirname(root)
  const write = (name, text) => {
    const file = path.join(checkout, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  write("typescript/vibelang/PACKAGE.ts", fs.readFileSync(path.join(here, "PACKAGE.ts"), "utf8"))
  write("typescript/PACKAGE.ts", 'export const Package = { compiler: "compiler" }')
  write("packages/PACKAGE.ts", 'export const Package = { "runtime-dist": "runtime", "runtime-published": "runtime-published" }')
  write("node_modules/@smthrs/targets/package.json", '{"type":"module","exports":"./index.js"}')
  write("node_modules/@smthrs/targets/index.js", `
export const Smithers = {
  file: (value) => value, glob: (value) => value,
  Shell: { Test: (value) => value }, Host: { bin: (value) => value },
  Filegroup: (value) => value, Package: (value) => value,
}
`)
  fs.cpSync(path.join(root, "runtime"), path.join(checkout, "packages/runtime"), { recursive: true })
  const cases = ["uninterruptible-using", "fork-named-region", "fork-arrow-body", "scopes-fork", "ch07-concurrency"]
  for (const name of cases) {
    write("typescript/vibelang/cases/" + name + "/tsconfig.json", "{}")
    write("typescript/vibelang/cases/" + name + "/expected/stdout.txt", "ready\n")
  }
  const declarations = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { Package } from "./typescript/vibelang/PACKAGE.ts"
console.log(JSON.stringify({
  regular: Package.targets["fork-named-region"].shell,
  delayed: Package.targets["fork-late-start"].shell,
}))
`], { cwd: checkout, encoding: "utf8", timeout: 30_000 })
  assert.equal(declarations.status, 0, declarations.stdout + declarations.stderr)
  const targets = JSON.parse(declarations.stdout)
  const barrier = path.join(checkout, "barrier")
  fs.mkdirSync(barrier)
  fs.writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { setTimeout } from "node:timers/promises"
const barrier = process.env.HARNESS_TEST_BARRIER
const side = process.env.HARNESS_TEST_SIDE
const signal = (name) => fs.writeFileSync(path.join(barrier, name), "")
const wait = async (name) => {
  const deadline = Date.now() + 30_000
  while (!fs.existsSync(path.join(barrier, name))) {
    if (Date.now() > deadline) throw new Error("missing barrier " + name)
    await setTimeout(10)
  }
}
const named = path.basename(process.cwd()) === "fork-named-region"
if (named && side === "delayed") {
  signal("delayed-compiling")
  await wait("regular-finished")
}
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'console.log("ready")')
if (named) {
  fs.writeFileSync(path.join(barrier, side + "-cwd"), process.cwd())
  if (side === "regular") {
    signal("regular-emitted")
    await wait("delayed-compiling")
  }
}
`, { mode: 0o755 })
  const start = (side) => {
    const child = spawn("sh", ["-c", targets[side]], {
      cwd: checkout,
      env: { ...process.env, HARNESS_TEST_BARRIER: barrier, HARNESS_TEST_SIDE: side },
      stdio: ["ignore", "pipe", "pipe"],
    })
    t.after(() => child.kill("SIGKILL"))
    let output = ""
    child.stdout.on("data", (data) => { output += data })
    child.stderr.on("data", (data) => { output += data })
    return new Promise((resolve, reject) => {
      child.on("error", reject)
      child.on("close", (code) => resolve({ code, output }))
    })
  }
  const regular = start("regular")
  const deadline = Date.now() + 30_000
  while (!fs.existsSync(path.join(barrier, "regular-emitted"))) {
    assert.ok(Date.now() < deadline, "per-case compiler never emitted")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const delayed = start("delayed")
  const a = await regular
  fs.writeFileSync(path.join(barrier, "regular-finished"), "")
  const b = await delayed
  assert.equal(a.code, 0, a.output)
  assert.equal(b.code, 0, b.output)
  assert.match(a.output, /1 cases: 1 ok, 0 FAIL/)
  assert.match(b.output, /5 cases: 5 ok, 0 FAIL/)
  const ordinaryDir = fs.readFileSync(path.join(barrier, "regular-cwd"), "utf8")
  const delayedDir = fs.readFileSync(path.join(barrier, "delayed-cwd"), "utf8")
  assert.notEqual(ordinaryDir, delayedDir, "targets must own different case directories")
  assert.ok(fs.existsSync(path.join(ordinaryDir, "out/main.js")), "aggregate run preserved the per-case output")
  assert.ok(fs.existsSync(path.join(ordinaryDir, "node_modules/vibelang-runtime/package.json")), "aggregate run preserved the per-case install")
})

test("isolated custom runners keep relative imports of shared helpers", (t) => {
  const { root, harness, compiler } = fixture(t)
  fs.writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'export const value = "expected"')
`, { mode: 0o755 })
  fs.writeFileSync(path.join(root, "vibelang/case-helper.mjs"), 'export const expected = "expected"')
  fs.writeFileSync(path.join(root, "vibelang/cases/runtime/run.mjs"), `
import { expected } from "../../case-helper.mjs"
import { value } from "./out/main.js"
if (value !== expected) throw new Error("wrong result")
console.log(value)
`)
  const result = spawnSync(process.execPath, [harness, "--isolated", "runtime"], {
    env: { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") },
    encoding: "utf8", timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /1 cases: 1 ok, 0 FAIL/)
  assert.equal(fs.existsSync(path.join(root, "vibelang/cases/runtime/out")), false)
  assert.equal(fs.readdirSync(path.join(root, "vibelang")).some((name) => name.startsWith(".smthrs-harness-")), false)
})
