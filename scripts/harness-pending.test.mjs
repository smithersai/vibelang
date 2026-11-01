import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
const repo = process.env.HARNESS_PENDING_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
function run(t, marker, { mismatch = true, status = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "harness pending "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file, text, options) => {
    const at = path.join(root, file)
    mkdirSync(path.dirname(at), { recursive: true })
    writeFileSync(at, text, options)
  }
  const dir = path.join(root, "typescript/vibelang")
  mkdirSync(dir, { recursive: true })
  for (const file of ["harness.mjs", "harness-command.mjs"]) {
    copyFileSync(file === "harness.mjs" && process.env.HARNESS_PENDING_MODULE
      ? process.env.HARNESS_PENDING_MODULE : path.join(repo, "typescript/vibelang", file), path.join(dir, file))
  }
  write("typescript/package.json", '{"type":"module"}')
  write("runtime/package.json", '{"name":"vibelang-runtime","files":[]}')
  write("typescript/built/local/tsc", `#!/usr/bin/env node
import fs from "node:fs"
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'console.log("42")')
`, { mode: 0o755 })
  const at = path.join(dir, "cases/pending-marker")
  write("typescript/vibelang/cases/pending-marker/tsconfig.json", "{}")
  write("typescript/vibelang/cases/pending-marker/expected/stdout.txt", mismatch ? "43\n" : "42\n")
  if (marker !== undefined) write("typescript/vibelang/cases/pending-marker/pending", marker)
  const result = spawnSync(process.execPath, [path.join(dir, "harness.mjs"), ...(status ? ["--status"] : []), "pending-marker"], {
    env: { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime") },
    encoding: "utf8", timeout: 60_000,
  })
  assert.ifError(result.error)
  return { ...result, at }
}
function invalid(t, marker, options) {
  const result = run(t, marker, options)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /1 cases: 0 ok, 1 FAIL, 0 pending, 0 XPASS/)
  const file = /log: +(.+?)(?:\)|$)/m.exec(result.stdout)?.[1]
  assert.ok(file, result.stdout)
  const log = JSON.parse(readFileSync(file, "utf8"))
  assert.match(log.detail, /pending file must name its owner/)
  assert.equal(log.case, "pending-marker")
  assert.deepEqual(log.commands, [], "invalid metadata must fail before launching a compiler")
  assert.equal(existsSync(path.join(result.at, "out")), false)
  assert.equal(existsSync(path.join(result.at, "node_modules")), false)
}
for (const [name, marker] of [["empty", ""], ["spaces", "   "], ["newlines", "\r\n\n"], ["tabs", "\t\t"], ["Unicode spaces", "\u00a0\u3000\ufeff"]]) {
  for (const mismatch of [false, true]) {
    test(`${name} marker rejects a ${mismatch ? "failing" : "passing"} case`, t => invalid(t, marker, { mismatch, status: mismatch }))
  }
}
for (const marker of ["lane", "lane explanation", "  lane explanation\n"]) {
  for (const mismatch of [false, true]) {
    test(`owned marker ${JSON.stringify(marker)} retains ${mismatch ? "pending" : "XPASS"}`, t => {
      const result = run(t, marker, { mismatch, status: mismatch })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, mismatch ? /1 cases: 0 ok, 0 FAIL, 1 pending, 0 XPASS/ : /1 cases: 0 ok, 0 FAIL, 0 pending, 1 XPASS/)
      assert.ok(existsSync(path.join(result.at, "out/main.js")))
    })
  }
}
for (const mismatch of [false, true]) {
  test(`absent marker retains ordinary ${mismatch ? "failure" : "success"}`, t => {
    const result = run(t, undefined, { mismatch })
    assert.equal(result.status, mismatch ? 1 : 0, result.stdout + result.stderr)
    assert.match(result.stdout, mismatch ? /1 cases: 0 ok, 1 FAIL, 0 pending, 0 XPASS/ : /1 cases: 1 ok, 0 FAIL, 0 pending, 0 XPASS/)
  })
}
test("generated whitespace-only metadata never becomes an owned pending case", t => {
  let state = 0x741171
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0)
  const spaces = [" ", "\t", "\n", "\r", "\v", "\f", "\u00a0", "\u2003", "\u2028", "\u2029", "\u3000", "\ufeff"]
  for (let n = 0; n < 24; n++) {
    const marker = Array.from({ length: 1 + next() % 30 }, () => spaces[next() % spaces.length]).join("")
    invalid(t, marker, { mismatch: n % 2 === 0, status: n % 3 === 0 })
  }
})
