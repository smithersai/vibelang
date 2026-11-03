import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repo = process.env.HARNESS_RESULT_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const effect = [process.env.EFFECT_NODE_MODULES, path.join(repo, "experiments/node_modules"), path.join(repo, "packages/runtime/node_modules")]
  .filter(Boolean).map(dir => path.join(dir, "effect")).find(existsSync)
assert.ok(effect, "install the pinned Effect test dependency in experiments/")
function run(t, value, { fail = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "harness result "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file, text, options) => {
    const at = path.join(root, file)
    mkdirSync(path.dirname(at), { recursive: true })
    writeFileSync(at, text, options)
  }
  const dir = path.join(root, "typescript/vibelang")
  mkdirSync(dir, { recursive: true })
  for (const file of ["harness.mjs", "harness-command.mjs", "late-start-scheduler.mjs"]) {
    copyFileSync(file === "harness.mjs" && process.env.HARNESS_RESULT_MODULE
      ? process.env.HARNESS_RESULT_MODULE : path.join(repo, "typescript/vibelang", file), path.join(dir, file))
  }
  write("typescript/package.json", '{"type":"module"}')
  write("runtime/package.json", '{"name":"vibelang-runtime","files":[]}')
  write("runtime/dist/index.js", "")
  mkdirSync(path.join(root, "modules"), { recursive: true })
  symlinkSync(realpathSync(effect), path.join(root, "modules/effect"), "dir")
  write("typescript/built/local/tsc", `#!/usr/bin/env node
import fs from "node:fs"
fs.mkdirSync("out", { recursive: true })
fs.copyFileSync("program.mjs", "out/main.js")
`, { mode: 0o755 })
  write("typescript/vibelang/cases/result/tsconfig.json", "{}")
  write("typescript/vibelang/cases/result/main.ts", "// expect-result: " + JSON.stringify(fail ? 42 : value) + "\n")
  write("typescript/vibelang/cases/result/program.mjs", `
import { Effect } from "effect"
export function main() {
  // The harness must still terminate runners that leave background work.
  setInterval(() => {}, 1000)
  return Effect.${fail ? "die(new Error(" : "succeed("}${JSON.stringify(value)}${fail ? "))" : ")"}
}
`)
  const result = spawnSync(process.execPath, [path.join(dir, "harness.mjs"), "--status", "result"], {
    env: { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") },
    encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.status, fail ? 1 : 0, result.stdout + result.stderr)
  assert.match(result.stdout, fail ? /1 cases: 0 ok, 1 FAIL/ : /1 cases: 1 ok, 0 FAIL/)
  if (fail) {
    const log = JSON.parse(readFileSync(/log: ([^)]+)/.exec(result.stdout)[1], "utf8"))
    const ran = log.commands.find(command => command.phase === "run")
    assert.equal(ran.exitCode, 0)
    assert.equal(ran.timedOut, false)
    assert.ok(ran.stdoutTail.includes("END_CAUSE"), "result marker lost its tail")
    assert.ok(ran.stderrTail.includes("END_CAUSE"), "failure diagnostics lost their tail")
  }
}

for (const size of [0, 16, 16_384, 65_536, 400_000]) {
  test(`generated runner drains a ${size}-character result and exits with background work`, t => run(t, "x".repeat(size)))
}
test("generated runner drains JSON escapes", t => run(t, '"\\\n\t\r'.repeat(50_000)))
test("generated runner drains a structured result", t => run(t, Array.from({ length: 12_000 }, (_, id) => ({ id, value: "sample" }))))
test("generated runner drains both result and defect diagnostics", t => run(t, "D".repeat(400_000) + "END_CAUSE", { fail: true }))
test("generated ASCII result neighbours survive serialization and pipe backpressure", t => {
  let state = 0x733171
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0)
  const alphabet = ['a', ' ', '"', '\\', '\n', '\r', '\t', '0', '[', ']']
  for (let n = 0; n < 8; n++) {
    const pattern = Array.from({ length: 31 }, () => alphabet[next() % alphabet.length]).join("")
    run(t, pattern.repeat(3000 + next() % 9000))
  }
})
