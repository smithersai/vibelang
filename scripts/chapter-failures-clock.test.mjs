import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repo = fileURLToPath(new URL("../", import.meta.url))
const source = path.join(repo, "typescript/vibelang/cases/ch15-failures")
const compiler = path.join(repo, "packages/compiler/native", process.platform === "win32" ? "vibelang.exe" : "vibelang")
const effect = path.join(process.env.EFFECT_NODE_MODULES ?? path.join(repo, "experiments/node_modules"), "effect")

// This case tests failure/cleanup ordering, not the host's timer dispatch order.
// A host pause while registering the debit's 20 ms timer used to let it beat
// the later-registered 5 ms timeout. Post-merge observed moved="none" twice.
test("Chapter 15 failure and cleanup results survive overdue host timers", { timeout: 240_000 }, async (t) => {
  assert.ok(fs.existsSync(compiler), "build the compiler with sh scripts/build-vibelang.sh")
  assert.ok(fs.existsSync(effect), "install the pinned Effect in experiments/node_modules")
  const cache = path.join(repo, ".cache")
  fs.mkdirSync(cache, { recursive: true })
  const dir = fs.mkdtempSync(path.join(cache, "chapter-clock-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const name of ["ch15-failures.vibe", "tsconfig.json", "package.json"]) {
    fs.copyFileSync(path.join(source, name), path.join(dir, name))
  }
  const modules = path.join(dir, "node_modules")
  fs.mkdirSync(modules)
  fs.symlinkSync(fs.realpathSync(effect), path.join(modules, "effect"), process.platform === "win32" ? "junction" : "dir")
  const runtime = path.join(repo, "packages/runtime")
  const published = JSON.parse(fs.readFileSync(path.join(runtime, "package.json"), "utf8"))
  const destination = path.join(modules, "vibelang-runtime")
  fs.mkdirSync(destination)
  // Keep the runtime on the fixture's peers, as the acceptance harness does.
  for (const file of ["package.json", ...published.files]) {
    const from = path.join(runtime, file)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(destination, file), { recursive: true, dereference: true })
  }
  const compile = spawnSync(compiler, ["-p", dir, "--pretty", "false"], { encoding: "utf8", timeout: 120_000 })
  assert.equal(compile.status, 0, compile.stdout + compile.stderr)
  const text = fs.readFileSync(path.join(source, "ch15-failures.vibe"), "utf8")
  const expected = JSON.parse(text.match(/^\/\/ expect-result: (.+)$/m)[1])
  fs.writeFileSync(path.join(dir, "out/clock-runner.mjs"), `
import { Effect } from "effect"
import { main } from "./ch15-failures.js"
const realTimeout = globalThis.setTimeout
const timerMs = Number(process.argv[2])
const pauseMs = Number(process.argv[3])
globalThis.setTimeout = (callback, ms, ...args) => {
  const timer = realTimeout(callback, ms, ...args)
  if (ms === timerMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs)
  return timer
}
const result = await Effect.runPromise(main())
console.log("@@result " + JSON.stringify(result))
`)
  // Different pauses cover the neighbourhood of the observed scheduler race.
  const schedules = [[0, 0], ...[40, 80, 120].flatMap(pause => [[20, pause], [5, pause]])]
  for (const [timer, pause] of schedules) {
    await t.test(`pause ${pause} ms after registering a ${timer} ms timer`, () => {
      const run = spawnSync(process.execPath, [path.join(dir, "out/clock-runner.mjs"), String(timer), String(pause)], {
        encoding: "utf8", timeout: 15_000,
      })
      assert.equal(run.status, 0, `signal=${run.signal}\n${run.stdout}\n${run.stderr}`)
      const line = run.stdout.split("\n").find(line => line.startsWith("@@result "))
      assert.ok(line, run.stdout + run.stderr)
      assert.deepEqual(JSON.parse(line.slice("@@result ".length)), expected)
    })
  }
})
