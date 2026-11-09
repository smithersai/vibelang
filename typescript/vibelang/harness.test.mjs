import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createRequire } from "node:module"
const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")

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
  fs.mkdirSync(path.join(root, "modules/effect"), { recursive: true })
  fs.writeFileSync(path.join(root, "modules/effect/package.json"), '{"name":"effect","version":"4.1.0"}')
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

test("a custom runner's run-seconds line sets its deadline", (t) => {
  const { root, harness } = fixture(t)
  for (const [name, seconds] of [["runner-1s", 1], ["runner-5s", 5]]) {
    const at = path.join(root, "vibelang/cases", name)
    fs.mkdirSync(path.join(at, "expected"), { recursive: true })
    fs.writeFileSync(path.join(at, "scenario"), "runtime")
    fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
    fs.writeFileSync(path.join(at, "expected/stdout.txt"), "expected\n")
    fs.writeFileSync(path.join(at, "run.mjs"), `// run-seconds: ${seconds} (a pipeline of bounded stages)\nawait new Promise((resolve) => setTimeout(resolve, 2500))\nconsole.log("expected")\n`)
  }
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const result = spawnSync(process.execPath, [harness, "--verbose", "--jobs", "2", "runner-1s", "runner-5s"], { env, encoding: "utf8", timeout: 30_000 })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /^ok\s+runner-5s/m, result.stdout)
  assert.match(result.stdout, /^FAIL\s+runner-1s: run.mjs printed printed no result \(exit killed by SIGKILL\)/m, result.stdout)
  const log = /log:\s+(.+?)(?:\)|$)/m.exec(result.stdout)?.[1]
  assert.ok(log, "the failing runner must name its log:\n" + result.stdout)
  const run = JSON.parse(fs.readFileSync(log, "utf8")).commands.find((command) => command.phase === "run")
  assert.equal(run.timeoutMs, 1_000)
  assert.equal(run.timedOut, true)
})

test("a runner takes the largest run-seconds among the helpers it imports", (t) => {
  const { root, harness } = fixture(t)
  const cases = path.join(root, "vibelang/cases")
  fs.writeFileSync(path.join(cases, "_one.mjs"), "// run-seconds: 1\nexport const one = 1\n")
  fs.writeFileSync(path.join(cases, "_five.mjs"), "// run-seconds: 5 (a pipeline)\nexport const five = 5\n")
  fs.writeFileSync(path.join(cases, "_plain.mjs"), "export const plain = 0\n")
  const wait = 'await new Promise((resolve) => setTimeout(resolve, 2500))\nconsole.log("expected")\n'
  const runners = {
    "takes-helper": `import { one } from "../_one.mjs"\n${wait}`,
    "takes-largest": `import { one } from "../_one.mjs"\nimport { five } from "../_five.mjs"\n${wait}`,
    "own-line-wins": `// run-seconds: 5\nimport { one } from "../_one.mjs"\n${wait}`,
    "plain-helper": `import { plain } from "../_plain.mjs"\n${wait}`,
  }
  for (const [name, runner] of Object.entries(runners)) {
    const at = path.join(cases, name)
    fs.mkdirSync(path.join(at, "expected"), { recursive: true })
    fs.writeFileSync(path.join(at, "scenario"), "runtime")
    fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
    fs.writeFileSync(path.join(at, "expected/stdout.txt"), "expected\n")
    fs.writeFileSync(path.join(at, "run.mjs"), runner)
  }
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const result = spawnSync(process.execPath, [harness, "--verbose", "--jobs", "4", ...Object.keys(runners)], { env, encoding: "utf8", timeout: 30_000 })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /^FAIL\s+takes-helper: run.mjs printed printed no result \(exit killed by SIGKILL\)/m, result.stdout)
  for (const name of ["takes-largest", "own-line-wins", "plain-helper"]) assert.match(result.stdout, new RegExp(`^ok\\s+${name}`, "m"), result.stdout)
})

test("nested helper budgets bound the real runner process", (t) => {
  const { root, harness } = fixture(t)
  const cases = path.join(root, "vibelang/cases")
  for (const seconds of [1, 5]) {
    fs.writeFileSync(path.join(cases, "nested-leaf-" + seconds + ".mjs"),
      "// run-seconds: " + seconds + "\nexport const wait = () => new Promise(resolve => setTimeout(resolve, 2500))\n")
    fs.writeFileSync(path.join(cases, "nested-wrapper-" + seconds + ".mjs"),
      'import { wait } from "./nested-leaf-' + seconds + '.mjs"\nexport { wait }\n')
    const at = path.join(cases, "nested-runner-" + seconds)
    fs.mkdirSync(path.join(at, "expected"), { recursive: true })
    fs.writeFileSync(path.join(at, "scenario"), "runtime")
    fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
    fs.writeFileSync(path.join(at, "expected/stdout.txt"), "expected\n")
    fs.writeFileSync(path.join(at, "run.mjs"),
      'import { wait } from "../nested-wrapper-' + seconds + '.mjs"\nawait wait()\nconsole.log("expected")\n')
  }
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const result = spawnSync(process.execPath, [harness, "--jobs", "2", "nested-runner-1", "nested-runner-5"],
    { env, encoding: "utf8", timeout: 30_000 })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /^FAIL\s+nested-runner-1:.*killed by SIGKILL/m)
  assert.match(result.stdout, /^ok\s+nested-runner-5/m)
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
  // The deadline is a hang guard. The child sleeps past one second, so a guard tight enough to fire on a loaded host
  // (at load 150 a plain node start outran 1000 ms, was killed, and left an empty tail) fails here every time.
  await commands.run(process.execPath, ["-e", 'setTimeout(() => { console.log("x".repeat(50000) + "stdout end"); console.error("y".repeat(50000) + "stderr end") }, 1200)'], { phase: "run", timeout: 60_000 })
  assert.equal(commands.records[2].timedOut, false, "the bounded-tail child must finish before its deadline")
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

test("a declaration twin compiles against the case's Effect, not a reference Effect a runner linked", (t) => {
  // cov-ch004 and match-vip7 runners link typescript/node_modules/effect to a
  // pinned reference Effect. The link outlived the run, and every later run in
  // that tree compiled typescript/ against it while out/ used the case's Effect.
  const { root, harness, compiler } = fixture(t)
  fs.writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
const version = createRequire(path.join(process.cwd(), "resolve.js"))("effect/package.json").version
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.d.ts", "export declare const effect: " + JSON.stringify(version) + ";\\n")
`, { mode: 0o755 })
  const identity = path.join(root, "..", "scripts", "api-identity.mjs")
  fs.mkdirSync(path.dirname(identity), { recursive: true })
  fs.writeFileSync(identity, `import fs from "node:fs"
const at = flag => process.argv[process.argv.indexOf(flag) + 1] + "/main.d.ts"
const before = fs.readFileSync(at("--before"), "utf8"), after = fs.readFileSync(at("--after"), "utf8")
if (before !== after) { console.log("before " + before + "after " + after); process.exit(1) }
`)
  const reference = path.join(root, ".cache", "reference", "node_modules", "effect")
  fs.mkdirSync(reference, { recursive: true })
  fs.writeFileSync(path.join(reference, "package.json"), '{"name":"effect","version":"4.0.0"}')
  const at = path.join(root, "vibelang", "cases", "identity")
  fs.mkdirSync(path.join(at, "typescript", "node_modules"), { recursive: true })
  fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
  fs.writeFileSync(path.join(at, "typescript", "tsconfig.json"), "{}")
  fs.symlinkSync(reference, path.join(at, "typescript", "node_modules", "effect"), "dir")
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  for (const args of [["identity"], ["--isolated", "identity"]]) {
    const result = spawnSync(process.execPath, [harness, ...args], { env, encoding: "utf8", timeout: 10_000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /^ok {6}identity$/m)
  }
  assert.equal(fs.readFileSync(path.join(at, "typescript", "out", "main.d.ts"), "utf8"), 'export declare const effect: "4.1.0";\n')
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
  write("experiments/node_modules/effect/package.json", '{"name":"effect","version":"4.1.0"}')
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

function checkNestedFixture(t, { depth, scoped, linked, value }) {
  const { root, harness, compiler } = fixture(t)
  const at = path.join(root, "vibelang/cases/runtime")
  const prefix = path.join("consumer", ...Array.from({ length: depth }, (_, i) => "nested" + i))
  const name = scoped ? "@scope/package" : "package"
  const dependency = path.join(prefix, "node_modules", name)
  const contents = JSON.stringify({ value })
  const write = (name, text) => {
    const file = path.join(at, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  if (linked) {
    const source = path.join(prefix, "fixture-package")
    write(path.join(source, "data.json"), contents)
    fs.mkdirSync(path.dirname(path.join(at, dependency)), { recursive: true })
    fs.symlinkSync(path.relative(path.dirname(dependency), source), path.join(at, dependency))
  } else {
    write(path.join(dependency, "data.json"), contents)
  }
  // A nested installed copy is intentional source data, including below stubs.
  const duplicate = path.join("stubs/wrapper/node_modules/package/data.json")
  write("stubs/wrapper/package.json", '{"name":"wrapper","type":"module"}')
  write(duplicate, contents)
  write("fixture.json", JSON.stringify({ paths: [dependency + "/data.json", duplicate], value }))
  write("node_modules/stale/data.json", '"must not be copied"')
  write("out/retained.json", '"prior original output"')
  const before = fs.readFileSync(path.join(at, "out/retained.json"), "utf8")
  fs.writeFileSync(compiler, `#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
const fixture = JSON.parse(fs.readFileSync("fixture.json", "utf8"))
for (const file of fixture.paths) {
  const resolved = fs.realpathSync(file)
  const relative = path.relative(process.cwd(), resolved)
  assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative), "fixture link escaped the isolated case: " + resolved)
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).value, fixture.value, "nested fixture changed")
}
assert.equal(fs.existsSync("node_modules/stale/data.json"), false, "root install must be regenerated")
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'console.log("expected")')
`, { mode: 0o755 })
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const result = spawnSync(process.execPath, [harness, "--isolated", "runtime"], { env, encoding: "utf8", timeout: 10_000 })
  const evidence = /log:\s+([^\n)]+)/.exec(result.stdout)?.[1]
  const details = evidence && fs.existsSync(evidence) ? fs.readFileSync(evidence, "utf8") : ""
  assert.equal(result.status, 0, result.stdout + result.stderr + details)
  assert.match(result.stdout, /1 cases: 1 ok, 0 FAIL/)
  assert.equal(fs.readFileSync(path.join(at, "out/retained.json"), "utf8"), before)
  assert.equal(fs.readFileSync(path.join(at, "node_modules/stale/data.json"), "utf8"), '"must not be copied"')
  assert.equal(JSON.parse(fs.readFileSync(path.join(at, duplicate), "utf8")).value, value)
}

test("isolated cases retain nested package fixtures and relative workspace links", (t) => {
  checkNestedFixture(t, { depth: 0, scoped: false, linked: true, value: 7 })
  checkNestedFixture(t, { depth: 1, scoped: false, linked: false, value: 8 })
})

test("isolated case package fixtures survive scope, depth, links and payload mutations", (t) => {
  fc.assert(fc.property(fc.record({
    depth: fc.integer({ min: 0, max: 3 }),
    scoped: fc.boolean(),
    linked: fc.boolean(),
    value: fc.integer({ min: 0, max: 255 }),
  }), (input) => checkNestedFixture(t, input)), { seed: 106107, numRuns: 20, endOnFailure: true })
})

test("an isolated case compiles as it does in place: the cases' package scope and its own linked packages", (t) => {
  const { root, harness, compiler } = fixture(t)
  // The compiler stands in for what tsc reads outside the case's files: the nearest package.json scope above the case
  // (cases/package.json in the repository) and a package the case links under a nested node_modules.
  fs.writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
const scope = JSON.parse(fs.readFileSync("../package.json", "utf8"))
if (scope.type !== "module") { console.log("main.vibe(1,1): error TS9999: not an ES module scope"); process.exit(1) }
if (!fs.existsSync("consumer/node_modules/agent/index.js")) { console.log("consumer/main.vibe(1,22): error TS2307: no agent"); process.exit(1) }
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'console.log("expected")')
`, { mode: 0o755 })
  const cases = path.join(root, "vibelang/cases")
  fs.writeFileSync(path.join(cases, "package.json"), '{"type":"module"}')
  const at = path.join(cases, "runtime")
  fs.mkdirSync(path.join(at, "consumer/agent"), { recursive: true })
  fs.mkdirSync(path.join(at, "consumer/node_modules"), { recursive: true })
  fs.writeFileSync(path.join(at, "consumer/agent/index.js"), "export const agent = 1\n")
  fs.symlinkSync("../agent", path.join(at, "consumer/node_modules/agent"))
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  for (const args of [["runtime"], ["--isolated", "runtime"]]) {
    const result = spawnSync(process.execPath, [harness, ...args], { env, encoding: "utf8", timeout: 10_000 })
    assert.equal(result.status, 0, args.join(" ") + "\n" + result.stdout + result.stderr)
    assert.match(result.stdout, /1 cases: 1 ok, 0 FAIL/)
  }
  assert.equal(fs.readdirSync(path.join(root, "vibelang")).some((name) => name.startsWith(".smthrs-harness-")), false)
})

// A compiler older than a file //typescript:compiler builds from is an earlier compiler; tests and testdata are
// not its inputs (typescript/tsc/PACKAGE.ts `srcs`).
test("the summary warns when the compiler is older than a source it builds from", (t) => {
  const { root, harness, compiler } = fixture(t)
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const now = Date.now() / 1000
  const write = (file, at) => {
    const full = path.join(root, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, "package vibelang\n")
    fs.utimesSync(full, at, at)
  }
  write("tsc/internal/vibelang/checker.go", now - 120)
  write("tsc/internal/vibelang/checker_test.go", now)
  write("tsc/internal/vibelang/testdata/fuzz/seed", now)
  fs.utimesSync(compiler, now - 60, now - 60)
  const run = () => spawnSync(process.execPath, [harness, "runtime"], { env, encoding: "utf8", timeout: 10_000 })
  const fresh = run()
  assert.equal(fresh.status, 1, fresh.stdout + fresh.stderr)
  assert.doesNotMatch(fresh.stdout + fresh.stderr, /older than/)
  write("tsc/internal/vibelang/checker.go", now)
  const stale = run()
  assert.equal(stale.status, 1, "the warning leaves the exit status to the cases")
  assert.match(stale.stdout, /^warning: built\/local\/tsc is older than tsc\/internal\/vibelang\/checker\.go, so these cases run an earlier compiler; rebuild it with sh scripts\/build-vibelang\.sh$/m)
})

test("nonzero runners cannot pass with matching stdout", (t) => {
  const { root, harness } = fixture(t)
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const variants = [
    ["empty", "", "process.exit(7)"],
    ["matching", "expected\n", 'console.log("expected"); process.exit(7)'],
    ["signal", "expected\n", 'console.log("expected"); process.kill(process.pid,"SIGTERM")'],
    ["timeout", "expected\n", '// run-seconds: 1\nconsole.log("expected"); setInterval(()=>{},1000)'],
  ]
  for (const [name, stdout, source] of variants) {
    const at = path.join(root, "vibelang/cases", "runner-" + name)
    fs.mkdirSync(path.join(at, "expected"), { recursive: true })
    fs.writeFileSync(path.join(at, "scenario"), "runtime")
    fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
    fs.writeFileSync(path.join(at, "run.mjs"), source)
    fs.writeFileSync(path.join(at, "expected/stdout.txt"), stdout)
    const result = spawnSync(process.execPath, [harness, "--status", "runner-" + name], { env, encoding: "utf8", timeout: 15_000 })
    assert.equal(result.status, 1, name + ": a failed runner matched stdout\n" + result.stdout + result.stderr)
    assert.match(result.stdout, /^runner-\S+\s+-\s+FAIL/m)
    const logFile = /log: (.+?)(?:\)|$)/m.exec(result.stdout)?.[1]
    assert.ok(logFile, result.stdout)
    const record = JSON.parse(fs.readFileSync(logFile, "utf8"))
    assert.equal(record.commands.at(-1).phase, "run")
    assert.notEqual(record.commands.at(-1).exitCode, 0)
  }
})

test("runner exit status is independent of arbitrary matching stdout", (t) => {
  const { root, harness } = fixture(t)
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const at = path.join(root, "vibelang/cases/property-runner")
  fs.mkdirSync(path.join(at, "expected"), { recursive: true })
  fs.writeFileSync(path.join(at, "scenario"), "runtime")
  fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
  const invoke = (code, stdout) => {
    fs.writeFileSync(path.join(at, "run.mjs"), "process.stdout.write(" + JSON.stringify(stdout) + ");process.exit(" + code + ")")
    fs.writeFileSync(path.join(at, "expected/stdout.txt"), stdout)
    return spawnSync(process.execPath, [harness, "property-runner"], { env, encoding: "utf8", timeout: 10_000 })
  }
  fc.assert(fc.property(fc.integer({ min: 1, max: 255 }),
    fc.oneof(fc.constantFrom("", "matched\n", "\u0000", "Ω\r\n"), fc.string({ maxLength: 32 })),
    (code, stdout) => {
      const failed = invoke(code, stdout)
      assert.equal(failed.status, 1, failed.stdout + failed.stderr)
      const control = invoke(0, stdout)
      assert.equal(control.status, 0, control.stdout + control.stderr)
    }), { seed: 0x001005, numRuns: 12 })
})

test("custom runners receive the selected compiler despite absent or stale inherited paths", (t) => {
  const cleanString = fc.string({ maxLength: 24 }).filter(value => !value.includes("\0"))
  fc.assert(fc.property(
    fc.option(cleanString, { nil: undefined }),
    fc.constantFrom("plain root", "space and 'quote", "π [root]"),
    cleanString,
    fc.boolean(),
    (inheritedCompiler, directory, sentinel, isolated) => {
      const original = fixture(t)
      const root = path.join(path.dirname(original.root), directory)
      fs.renameSync(original.root, root)
      const compiler = path.join(root, "built/local/tsc")
      const harness = path.join(root, "vibelang/harness.mjs")
      const at = path.join(root, "vibelang/cases/runner-env")
      fs.mkdirSync(path.join(at, "expected"), { recursive: true })
      fs.writeFileSync(path.join(at, "scenario"), "runtime")
      fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
      fs.writeFileSync(path.join(at, "expected/stdout.txt"), "selected compiler\n")
      fs.writeFileSync(path.join(at, "run.mjs"), [
        'import assert from "node:assert/strict"',
        'import { spawnSync } from "node:child_process"',
        "assert.equal(process.env.VIBELANG_BINARY, " + JSON.stringify(compiler) + ")",
        "assert.equal(process.env.HARNESS_COMPILER_SENTINEL, " + JSON.stringify(sentinel) + ")",
        'const child = spawnSync(process.env.VIBELANG_BINARY, [], { encoding: "utf8" })',
        "assert.ifError(child.error)",
        "assert.equal(child.status, 0, child.stderr)",
        'assert.match(child.stdout, /compile stdout runtime/)',
        'console.log("selected compiler")',
      ].join("\n"))
      const env = {
        ...process.env,
        EFFECT_NODE_MODULES: path.join(root, "modules"),
        VIBELANG_RUNTIME: path.join(root, "runtime"),
        HARNESS_COMPILER_SENTINEL: sentinel,
      }
      delete env.VIBELANG_BINARY
      if (inheritedCompiler !== undefined) env.VIBELANG_BINARY = inheritedCompiler
      const parentCompiler = process.env.VIBELANG_BINARY
      const result = spawnSync(process.execPath, [harness, "--verbose", ...(isolated ? ["--isolated"] : []), "runner-env"], {
        env, encoding: "utf8", timeout: 15_000,
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /^ok\s+runner-env(?:\s|$)/m)
      assert.equal(process.env.VIBELANG_BINARY, parentCompiler)
    },
  ), {
    seed: 4701,
    numRuns: 12,
    examples: [
      [undefined, "plain root", "unset", false],
      ["wrong compiler", "space and 'quote", "stale", true],
      ["", "π [root]", "", false],
    ],
  })
})


test("performance reports retain successful, failing and pending command timings in selection order", (t) => {
  const { root, harness, compiler } = fixture(t)
  const put = (name, text) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  fs.writeFileSync(compiler, '#!/usr/bin/env node\nimport fs from "node:fs"\nfs.mkdirSync("out", { recursive: true })\nfs.writeFileSync("out/main.js", \'console.log("expected")\')\n')
  for (const name of ["success", "pending", "xpass"]) {
    put("vibelang/cases/" + name + "/tsconfig.json", "{}")
    put("vibelang/cases/" + name + "/expected/stdout.txt", name === "pending" ? "other\n" : "expected\n")
  }
  for (const name of ["pending", "xpass"]) put("vibelang/cases/" + name + "/pending", "test intentional status fixture")
  put("vibelang/cases/compile/expected/stdout.txt", "wrong\n")
  put("modules/effect/package.json", '{"name":"effect","version":"4.1.0"}')
  const report = path.join(root, "reports", "trial.json")
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const selected = ["xpass", "success", "compile", "pending"]
  const invoke = (out) => spawnSync(process.execPath, [harness, "--report", out, "--status", "--isolated", "--jobs", "2", ...selected], {
    env, encoding: "utf8", timeout: 30_000,
  })
  const result = invoke(report)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const receipt = JSON.parse(fs.readFileSync(report, "utf8"))
  assert.equal(receipt.version, 1)
  assert.equal(receipt.complete, true)
  assert.equal(receipt.jobs, 2)
  assert.equal(receipt.isolated, true)
  assert.equal(receipt.lateStart, false)
  assert.equal(receipt.compiler.path, compiler)
  assert.match(receipt.compiler.sha256, /^[0-9a-f]{64}$/)
  assert.equal(receipt.effectVersion, "4.1.0")
  assert.equal(receipt.node, process.version)
  assert.ok(receipt.system.availableParallelism > 0)
  assert.ok(Date.parse(receipt.finishedAt) >= Date.parse(receipt.startedAt))
  assert.deepEqual(receipt.cases.map(r => r.name), selected)
  assert.deepEqual(receipt.cases.map(r => r.status), ["XPASS", "ok", "FAIL", "pending"])
  for (const item of receipt.cases) {
    assert.ok(item.wallMs > 0)
    assert.deepEqual(item.commands.map(r => r.phase), ["compile", "run"])
    for (const record of item.commands) {
      assert.ok(record.wallMs > 0)
      assert.equal(record.timedOut, false)
      assert.equal(record.exitCode, 0)
      assert.ok(Date.parse(record.finishedAt) >= Date.parse(record.startedAt))
    }
  }
  // The selected cases ran privately even when their successful copies have gone.
  assert.equal(fs.existsSync(path.join(root, "vibelang/cases/success/out")), false)
  assert.equal(fs.existsSync(receipt.cases[1].commands[0].cwd), false)
  const first = fs.readFileSync(report)
  const again = invoke(report)
  assert.equal(again.status, 2, again.stdout + again.stderr)
  assert.match(again.stderr, /report.*already exists/i)
  assert.deepEqual(fs.readFileSync(report), first, "never overwrite a prior trial")
  const second = path.join(root, "reports", "trial2.json")
  assert.equal(invoke(second).status, 1)
  assert.deepEqual(fs.readFileSync(report), first)
})

test("an interrupted report stays incomplete with invocation metadata", async (t) => {
  const { root, harness, compiler } = fixture(t)
  const report = path.join(root, "interrupted.json")
  const barrier = path.join(root, "compiling")
  fs.writeFileSync(compiler, '#!/usr/bin/env node\nimport fs from "node:fs"\nfs.writeFileSync(' + JSON.stringify(barrier) + ', "")\nsetTimeout(() => {}, 300)\n')
  const child = spawn(process.execPath, [harness, "--report", report, "runtime"], {
    env: { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") },
    stdio: "ignore",
  })
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("close", resolve)
  })
  t.after(() => child.kill("SIGKILL"))
  const deadline = Date.now() + 30_000
  while (!fs.existsSync(barrier)) {
    assert.equal(child.exitCode, null, "harness exited before starting the compiler")
    assert.ok(Date.now() < deadline, "compiler did not start")
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  child.kill("SIGKILL")
  await closed
  const receipt = JSON.parse(fs.readFileSync(report, "utf8"))
  assert.equal(receipt.complete, false)
  assert.equal(receipt.finishedAt, undefined)
  assert.deepEqual(receipt.selected, ["runtime"])
  // Let the short-lived fixture child finish before the fixture directory is removed.
  await new Promise(resolve => setTimeout(resolve, 500))
})

test("performance report arguments reject missing and repeated paths before running cases", (t) => {
  const { root, harness } = fixture(t)
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  for (const args of [["--report"], ["--report", "--status"], ["--report", "one", "--report", "two"]]) {
    const result = spawnSync(process.execPath, [harness, ...args], { env, encoding: "utf8", timeout: 10_000 })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /--report requires one new JSON file path/)
    assert.equal(fs.existsSync(path.join(root, "vibelang/cases/runtime/out")), false)
  }
})


test("an expected compiler error reports a successful case without inventing a run phase", (t) => {
  const { root, harness } = fixture(t)
  fs.writeFileSync(path.join(root, "vibelang/cases/compile/main.vibe"), "// expect: TS9999\n")
  const report = path.join(root, "expected-error.json")
  const result = spawnSync(process.execPath, [harness, "--report", report, "compile"], {
    env: { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") },
    encoding: "utf8", timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const receipt = JSON.parse(fs.readFileSync(report, "utf8"))
  assert.equal(receipt.complete, true)
  assert.equal(receipt.cases[0].status, "ok")
  assert.deepEqual(receipt.cases[0].commands.map(r => r.phase), ["compile"])
  assert.equal(receipt.cases[0].commands[0].exitCode, 1)
  assert.ok(receipt.cases[0].commands[0].wallMs > 0)
})

test("generated report paths and option orders preserve case selection and round-trip through the comparator", async (t) => {
  const { root, harness, compiler } = fixture(t)
  const runtime = path.join(root, "runtime/package.json")
  const manifest = JSON.parse(fs.readFileSync(runtime, "utf8"))
  manifest.version = "0.0.11"
  fs.writeFileSync(runtime, JSON.stringify(manifest))
  fs.writeFileSync(compiler, '#!/usr/bin/env node\nimport fs from "node:fs"\nfs.mkdirSync("out", { recursive: true })\nfs.writeFileSync("out/main.js", \'console.log("expected")\')\n')
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  // This checks arguments and serialization with a fixture compiler, not
  // performance. Shared hosts can change CPU affinity between invocations.
  const reportEnvironment = path.join(root, "report-environment.mjs")
  fs.writeFileSync(reportEnvironment, 'import os from "node:os"\nos.availableParallelism = () => 4\n')
  const receipts = []
  fc.assert(fc.property(
    fc.record({
      suffix: fc.array(fc.constantFrom("a", "Z", "0", " ", "-", "é", "中"), { minLength: 1, maxLength: 12 }).map(xs => xs.join("")),
      first: fc.boolean(),
      status: fc.boolean(),
      verbose: fc.boolean(),
    }),
    ({ suffix, first, status, verbose }) => {
      const output = path.join(root, "reports " + receipts.length, suffix + ".json")
      const reportArgs = ["--report", output]
      const caseArgs = ["--isolated", "--jobs", "1", ...(status ? ["--status"] : []), ...(verbose ? ["-v"] : []), "runtime"]
      const args = first ? [...reportArgs, ...caseArgs] : [...caseArgs, ...reportArgs]
      const result = spawnSync(process.execPath, ["--import", reportEnvironment, harness, ...args], { env, encoding: "utf8", timeout: 10_000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const receipt = JSON.parse(fs.readFileSync(output, "utf8"))
      assert.equal(receipt.system.availableParallelism, 4)
      assert.deepEqual(receipt.selected, ["runtime"])
      assert.deepEqual(receipt.cases.map(c => c.name), ["runtime"])
      assert.equal(receipt.cases[0].status, "ok")
      assert.deepEqual(receipt.cases[0].commands.map(c => c.phase), ["compile", "run"])
      receipts.push(receipt)
    },
  ), { seed: 156084, numRuns: 32 })
  const { compareTrials } = await import("../../scripts/bench/case-timings.mjs")
  const result = compareTrials(receipts, receipts)
  assert.equal(result.valid, true)
  assert.equal(result.baseline.trials, 32)
  assert.equal(result.regressions.length, 0)
  assert.deepEqual(result.rows.map(r => r.phase), ["compile", "run", null])
})

test("invalid report paths preserve the source case and previous evidence", (t) => {
  const { root, harness } = fixture(t)
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const directory = path.join(root, "existing directory")
  fs.mkdirSync(directory)
  const sentinel = path.join(directory, "keep")
  fs.writeFileSync(sentinel, "original")
  for (const output of [directory, path.join(sentinel, "child.json")]) {
    const result = spawnSync(process.execPath, [harness, "--report", output, "runtime"], { env, encoding: "utf8", timeout: 10_000 })
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.match(result.stderr, /harness.mjs: report/)
    assert.equal(fs.readFileSync(sentinel, "utf8"), "original")
    assert.equal(fs.existsSync(path.join(root, "vibelang/cases/runtime/out")), false)
  }
})

// Exercise the real harness renderer as well as the threshold helper. Status
// mode is used for compact case inventories and must retain the timing cause.
test("status output retains a passing runner deadline warning and summary", (t) => {
  const { root, harness } = fixture(t)
  const at = path.join(root, "vibelang/cases/deadline-margin")
  fs.mkdirSync(path.join(at, "expected"), { recursive: true })
  fs.writeFileSync(path.join(at, "scenario"), "runtime")
  fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
  fs.writeFileSync(path.join(at, "expected/stdout.txt"), "expected\n")
  fs.writeFileSync(path.join(at, "run.mjs"), `// run-seconds: 6\nawait new Promise((resolve) => setTimeout(resolve, 3600))\nconsole.log("expected")\n`)
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  for (const flags of [[], ["--status"], ["--verbose"], ["--status", "--verbose"]]) {
    const result = spawnSync(process.execPath, [harness, ...flags, "deadline-margin"], { env, encoding: "utf8", timeout: 30_000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    if (flags.includes("--status")) assert.match(result.stdout, /^deadline-margin\s+-\s+ok$/m)
    else assert.match(result.stdout, /^ok\s+deadline-margin/m)
    assert.match(result.stdout, /^\s+deadline: run took \d+\.\d s of 6 s/m, "every output mode must retain the phase and both times")
    assert.match(result.stdout, /1 passed past half a deadline: deadline-margin/)
  }
})


// Supply deterministic elapsed records after real commands finish: testing the
// renderer must not wait for half of a compiler's two-minute hang guard.
for (const [phase, limit] of [
  ["compile", 120], ["compile typescript", 120],
  ["compare declarations", 120], ["compare", 10], ["run", 60],
  ["future phase", 90],
]) {
  test("deadline advice names the controlling limit for " + phase, (t) => {
    const { root, harness, compiler } = fixture(t)
    fs.writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'console.log("expected")')
`, { mode: 0o755 })
    const cases = ["custom-margin", "ordinary-margin"]
    for (const name of cases) {
      const at = path.join(root, "vibelang/cases", name)
      fs.mkdirSync(path.join(at, "expected"), { recursive: true })
      fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
      fs.writeFileSync(path.join(at, "expected/stdout.txt"), "expected\n")
      if (name === "custom-margin") fs.writeFileSync(path.join(at, "run.mjs"), 'console.log("expected")\n')
    }
    fs.appendFileSync(path.join(root, "vibelang/harness-command.mjs"), `
const nativeRun = CaseCommands.prototype.run
CaseCommands.prototype.run = async function (...args) {
  const result = await nativeRun.apply(this, args)
  Object.assign(this.records.at(-1), {
    phase: ${JSON.stringify(phase)}, timeoutMs: ${limit * 1000}, wallMs: ${limit * 750},
  })
  return result
}
`)
    const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
    for (const flags of [[], ["--status"], ["--verbose"], ["--status", "--verbose"]]) {
      const result = spawnSync(process.execPath, [harness, ...flags, ...cases], { env, encoding: "utf8", timeout: 30_000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const warnings = result.stdout.split("\n").filter(line => /^\s+deadline: /.test(line))
      assert.equal(warnings.length, 2, result.stdout)
      for (const [index, warning] of warnings.entries()) {
        assert.ok(warning.includes("deadline: " + phase + " took " + (limit * 0.75).toFixed(1) + " s of " + limit + " s"), warning)
        if (phase === "run" && index === 0) {
          assert.match(warning, /run\.mjs:.*`\/\/ run-seconds: N`/, warning)
        } else {
          assert.doesNotMatch(warning, /run-seconds|run\.mjs:/, "a custom runner line cannot change this limit: " + warning)
          assert.ok(warning.includes("harness.mjs: review the " + phase + " phase and its fixed deadline"), warning)
        }
      }
      assert.match(result.stdout, /2 passed past half a deadline: custom-margin, ordinary-margin/)
      assert.match(result.stdout, /2 cases: 2 ok, 0 FAIL, 0 pending, 0 XPASS/)
    }
  })
}

test("helper import quote spelling preserves native runner deadline enforcement", (t) => {
  const { root, harness } = fixture(t)
  const cases = path.join(root, "vibelang/cases")
  const names = []
  for (const [style, quote] of [["single", "'"], ["double", '"']]) {
    for (const seconds of [1, 5]) {
      const name = "quoted-helper-" + style + "-" + seconds
      names.push(name)
      const at = path.join(cases, name)
      fs.mkdirSync(path.join(at, "expected"), { recursive: true })
      fs.writeFileSync(path.join(at, "scenario"), "runtime")
      fs.writeFileSync(path.join(at, "tsconfig.json"), "{}")
      fs.writeFileSync(path.join(at, "expected/stdout.txt"), "expected\n")
      fs.writeFileSync(path.join(at, "leaf.mjs"),
        "// run-seconds: " + seconds + "\nexport const wait = () => new Promise(resolve => setTimeout(resolve, 2500))\n")
      fs.writeFileSync(path.join(at, "wrapper.mjs"), "export { wait } from " + quote + "./leaf.mjs" + quote + "\n")
      fs.writeFileSync(path.join(at, "run.mjs"),
        "import { wait } from " + quote + "./wrapper.mjs" + quote + "\nawait wait()\nconsole.log('expected')\n")
    }
  }
  const env = { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") }
  const result = spawnSync(process.execPath, [harness, "--jobs", "4", ...names],
    { env, encoding: "utf8", timeout: 30_000 })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  for (const style of ["single", "double"]) {
    assert.match(result.stdout, new RegExp("^FAIL\\s+quoted-helper-" + style + "-1:.*killed by SIGKILL", "m"))
    assert.match(result.stdout, new RegExp("^ok\\s+quoted-helper-" + style + "-5", "m"))
  }
})
