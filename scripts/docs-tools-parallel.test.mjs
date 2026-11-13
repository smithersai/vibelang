import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { declaredFileCommands } from "./declared-command.mjs"
import { rootTestGroups, rootTestShards } from "../root-test-shards.ts"
import { spawn } from "node:child_process"

// Execute the actual target command on real Bun files. Synchronous barriers
// distinguish file workers from serial execution or concurrency within one file.
function fixture(t, failing = false) {
  const root = mkdtempSync(join(tmpdir(), "docs-tools-workers-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const tools = join(root, "docs/tools")
  mkdirSync(tools, { recursive: true })
  writeFileSync(join(tools, "registry.ts"), "export const registry = { files: 0 }\n")
  const members = rootTestShards("docs-tools", rootTestGroups()["docs-tools"])
    .find(shard => shard.files.length >= 5).files.slice(0, 5)
  for (let i = 0; i < 4; i++) {
    writeFileSync(join(root, members[i]), `
import { test, expect } from "bun:test"
import { writeFileSync, readdirSync } from "node:fs"
import { registry } from "./registry"
let step = 0
test("worker ${i} starts alongside other files", () => {
  writeFileSync("started-${i}", String(process.pid))
  const deadline = Date.now() + 4000
  while (readdirSync(".").filter(p => p.startsWith("started-")).length < 3 && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  }
  expect(readdirSync(".").filter(p => p.startsWith("started-")).length).toBeGreaterThanOrEqual(3)
  expect(step++).toBe(0)
  writeFileSync("registry-${i}", String(++registry.files))
})
test("worker ${i} retains per-file ordering", () => {
  expect(step++).toBe(1)
  writeFileSync("finished-${i}", "done")
})
`)
  }
  for (const name of ["site-contrast.test.ts", "site-spec-links.test.ts"]) {
    writeFileSync(join(tools, name), 'throw new Error("excluded site target ran")\n')
  }
  if (failing) writeFileSync(join(root, members[4]),
    'import { test, expect } from "bun:test"; test("failure must reach the graph", () => { expect("witness").toBe("fixed") })\n')
  return { root, tools }
}

async function run(root) {
  const commands = await declaredFileCommands("docs-tools", root)
  const results = []
  let next = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < commands.length) {
      const command = commands[next++]
      results.push(await new Promise(resolve => {
        const child = spawn("sh", ["-c", command], { cwd: root, env: process.env })
        let stdout = "", stderr = ""
        child.stdout.on("data", chunk => stdout += chunk)
        child.stderr.on("data", chunk => stderr += chunk)
        child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }))
      }))
    }
  }))
  return { status: results.some(r => r.status !== 0) ? 1 : 0, signal: results.find(r => r.signal)?.signal ?? null,
    stdout: results.map(r => r.stdout).join(""), stderr: results.map(r => r.stderr).join("") }
}

test("docs-tools runs all discovered files on three workers and keeps site targets separate", async t => {
  const { root, tools } = fixture(t)
  const result = await run(root)
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr)
  const started = readdirSync(tools).filter(p => p.startsWith("started-"))
  assert.equal(started.length, 4, "a newly discovered file was omitted")
  const pids = new Set(started.map(p => readFileSync(join(tools, p), "utf8")))
  assert.equal(pids.size, 3, "the grouped command must admit exactly three Bun workers")
  const counters = readdirSync(tools).filter(p => /^registry-/.test(p))
    .map(p => Number(readFileSync(join(tools, p), "utf8"))).sort()
  assert.deepEqual(counters, [1, 1, 1, 2], "the group retains ordered worker-local module state")
  assert.equal(readdirSync(tools).filter(p => p.startsWith("finished-")).length, 4)
})

test("a worker failure fails the docs-tools target without dropping the other files", async t => {
  const { root, tools } = fixture(t, true)
  const result = await run(root)
  assert.equal(result.signal, null, result.error?.message)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /failure must reach the graph/)
  assert.equal(readdirSync(tools).filter(p => p.startsWith("finished-")).length, 4)
})
