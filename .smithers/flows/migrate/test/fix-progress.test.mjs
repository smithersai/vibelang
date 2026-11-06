import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibe-fix-progress-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const compiler = join(root, "compiler.mjs"), release = join(root, "release"), exited = join(root, "exited")
  writeFileSync(join(root, "main.vibe"), "export const value = 1\n")
  writeFileSync(join(root, "peer.vibe"), "export const retained = 2\n")
  writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
${fakeProjectFiles(root)}
fs.writeFileSync("peer.vibe", "export const retained = 999\\n")
process.stderr.write("opaque child text must not enter progress records\\n")
process.stderr.write("vibelang --fix: 5s: round 1: 0 fixes applied, 1 pending; 1 check, 1 this round (1 whole, 0 partial); checking 1 fix in 1 file for 1s; heap 64 MiB, goal 128 MiB, 2 GCs\\n")
const limit = setTimeout(() => { console.error("progress was not observed before exit"); process.exit(73) }, 10000)
const timer = setInterval(() => {
 if (!fs.existsSync(${JSON.stringify(release)})) return
 clearTimeout(limit); clearInterval(timer)
 fs.writeFileSync(${JSON.stringify(exited)}, "done")
 console.log("vibelang --fix: 0 fixes in 0 files.")
}, 10)
`)
  chmodSync(compiler, 0o755)
  const log = join(root, "fix")
  return { root, release, exited, log, run: onProgress => fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: root, root, only: ["main.vibe"], log, timeoutMs: 15000, onProgress }) }
}

test("alchemy: migration records compiler progress while the fix is still running", async t => {
  const f = fixture(t), seen = []
  const result = await f.run(event => {
    assert.equal(existsSync(f.exited), false, "the child is held until its progress is observed")
    seen.push(event)
    const persisted = readFileSync(`${f.log}.1.progress.jsonl`, "utf8")
    assert.equal(JSON.parse(persisted.trim()).checks, 1)
    assert.equal(persisted.includes("opaque child text"), false)
    writeFileSync(f.release, "continue")
  })
  assert.equal(result.settled, true)
  assert.equal(existsSync(f.exited), true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].event, "compiler-fix-progress")
  assert.equal(seen[0].phase, "round")
  assert.equal(seen[0].round, 1)
  assert.equal(seen[0].checks, 1)
  assert.equal(seen[0].heapMiB, 64)
  assert.equal(seen[0].invocation, 1)
  assert.ok(seen[0].pid > 0)
  assert.equal(JSON.stringify(seen).includes("opaque child text"), false)
  assert.equal(readFileSync(join(f.root, "peer.vibe"), "utf8"), "export const retained = 2\n")
  assert.match(readFileSync(`${f.log}.1.log`, "utf8"), /# exit 0/)
})

test("a failed progress observer stops its command and restores nonselected sources", async t => {
  const f = fixture(t), failure = new Error("progress observer unavailable")
  await assert.rejects(f.run(() => { throw failure }), error => error === failure)
  assert.equal(existsSync(f.exited), false)
  assert.equal(readFileSync(join(f.root, "peer.vibe"), "utf8"), "export const retained = 2\n")
  assert.equal(readFileSync(`${f.log}.1.progress.jsonl`, "utf8").trim().split("\n").length, 1)
})
