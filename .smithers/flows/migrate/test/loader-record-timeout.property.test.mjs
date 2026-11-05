import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { writeLoaderRecords } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-loader-record-stall.json", import.meta.url), "utf8"))

function fixture(t, modes) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "loader-record-bound-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), value)
  }
  write("package.json", "{}")
  for (const [name, mode] of Object.entries(modes)) {
    write(name + "/tsconfig.json", JSON.stringify({ mode }))
    write(name + "/source.vibe", "export const value = 1\n")
  }
  write("node_modules/vibelang/package.json", JSON.stringify({ type: "module", exports: { "./project": "./project.mjs" } }))
  write("node_modules/vibelang/project.mjs", `
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
export const nearestProject = file => join(dirname(file), "tsconfig.json")
export const formatDiagnostic = error => error.message
export function writeLoaderRecord({project}) {
  const mode = JSON.parse(readFileSync(project, "utf8")).mode
  if (mode === "slow") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500)
  if (mode === "child") {
    const child = "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 2500)"
    spawnSync(process.execPath, ["-e", child, join(dirname(project), "late")])
  }
  if (mode === "errors") return { errors: [{message:"fixture type error"}] }
  if (mode === "throw") throw new Error("fixture loader failure")
  return {file:join(dirname(project), "record.json"), modules:1}
}
`)
  return root
}

test("an optional loader record has a deadline and retains the next project's record", async t => {
  const root = fixture(t, corpus.projects)
  const records = await writeLoaderRecords({ compiler: "unused", packageDir: root, root, timeoutMs: 1000 })
  const stalled = records.find(r => r.project === "a/tsconfig.json")
  assert.equal(stalled.timedOut, true)
  assert.equal(stalled.stage, "loader-record")
  assert.equal(stalled.timeoutMs, 1000)
  assert.ok(stalled.ms >= 900 && stalled.ms < 5000, String(stalled.ms))
  assert.match(stalled.error, /timed out/)
  assert.equal(stalled.file, undefined)
  assert.deepEqual(records.find(r => r.project === "b/tsconfig.json"), {project:"b/tsconfig.json", file:"b/record.json", modules:1})
})

test("a timed out record terminates its compiler descendant before continuing", async t => {
  const root = fixture(t, {a:"child", b:"success"})
  const records = await writeLoaderRecords({ compiler:"unused", packageDir:root, root, timeoutMs:1000 })
  assert.equal(records[0].timedOut, true)
  assert.equal(records[1].modules, 1)
  await new Promise(done => setTimeout(done, 2600))
  assert.equal(existsSync(join(root, "a/late")), false)
})

test("loader record deadlines preserve success, diagnostics and thrown errors", async t => {
  const root = fixture(t, {a:"success", b:"errors", c:"throw"})
  const records = await writeLoaderRecords({compiler:"unused", packageDir:root, root, timeoutMs:10000})
  assert.deepEqual(records, [
    {project:"a/tsconfig.json", file:"a/record.json", modules:1},
    {project:"b/tsconfig.json", errors:1, first:"fixture type error"},
    {project:"c/tsconfig.json", error:"fixture loader failure"},
  ])
})

test("loader record progress survives a stalled project at any position", async t => {
  await fc.assert(fc.asyncProperty(
    fc.integer({min:1,max:4}), fc.nat({max:3}),
    async (count, index) => {
      const modes = Object.fromEntries(Array.from({length:count}, (_, i) => ["p"+i, i===index%count ? "slow" : "success"]))
      const root = fixture(t, modes)
      const records = await writeLoaderRecords({compiler:"unused", packageDir:root, root, timeoutMs:1000})
      assert.equal(records.length, count)
      assert.equal(records.filter(r=>r.timedOut).length, 1)
      assert.equal(records.filter(r=>r.file).length, count-1)
      assert.equal(records[index%count].file, undefined)
    }
  ), {numRuns:12, seed:1066})
})
