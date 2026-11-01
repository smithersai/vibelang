import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { gzipSync } from "node:zlib"

// The hosted pre-gate applies a queued change from the dispatch payload, which GitHub caps at 65,535 characters. 69
// entries in two days (2026-10-30/31) were over it with gzip and waited for one of four nyc workers; xz brings about a
// quarter of them under it. This runs the workflow's own apply step on xz and gzip payloads.
const repo = new URL("../", import.meta.url)
const workflow = fs.readFileSync(new URL(".github/workflows/mq-pregate.yml", repo), "utf8")
const applyStep = workflow.match(/- name: Apply the change\n\s+run: (.+)\n/)?.[1]

const diff = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,2 @@
 one
-two
+two, changed
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+added
`

function checkout(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-test-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, "scripts"))
  const script = new URL("scripts/apply-patch.sh", repo)
  if (fs.existsSync(script)) fs.copyFileSync(script, path.join(dir, "scripts/apply-patch.sh"))
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n")
  return dir
}

const xz = (bytes) => {
  const run = spawnSync("xz", ["-9e", "-c"], { input: bytes })
  assert.equal(run.status, 0, String(run.stderr))
  return run.stdout
}

const apply = (dir, packed) =>
  spawnSync("bash", ["-eo", "pipefail", "-c", applyStep], { cwd: dir, encoding: "utf8", env: { ...process.env, PRE_PATCH: packed.toString("base64") } })

test("the workflow's apply step finds its run line", () => {
  assert.ok(applyStep, "mq-pregate.yml has a one-line `Apply the change` step")
})

for (const [name, pack] of [["xz", xz], ["gzip", gzipSync]]) {
  test(`the hosted pre-gate applies a ${name} patch`, (t) => {
    const dir = checkout(t)
    const result = apply(dir, pack(Buffer.from(diff)))
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo, changed\n")
    assert.equal(fs.readFileSync(path.join(dir, "new.txt"), "utf8"), "added\n")
  })
}

test("a payload that is neither xz nor gzip fails and changes nothing", (t) => {
  const dir = checkout(t)
  const result = apply(dir, Buffer.from(diff))
  assert.notEqual(result.status, 0)
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo\n")
  assert.ok(!fs.existsSync(path.join(dir, "new.txt")))
})
