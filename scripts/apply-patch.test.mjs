import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { constants as zlibConstants, createGzip, gzipSync } from "node:zlib"

// scripts/apply-patch.sh applies a base64-encoded xz or gzip patch payload.
const repo = new URL("../", import.meta.url)
const applyStep = `printf '%s' "$PRE_PATCH" | sh scripts/apply-patch.sh`

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

test("the apply-patch helper script exists", () => {
  assert.ok(fs.existsSync(new URL("scripts/apply-patch.sh", repo)), "scripts/apply-patch.sh exists")
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

test("a truncated gzip payload fails and changes nothing", async (t) => {
  const dir = checkout(t)
  const firstFileDiff = diff.slice(0, diff.indexOf("diff --git a/new.txt"))
  const truncated = await new Promise((resolve, reject) => {
    const gz = createGzip()
    const chunks = []
    gz.on("data", (chunk) => chunks.push(chunk))
    gz.on("error", reject)
    gz.write(firstFileDiff)
    gz.flush(zlibConstants.Z_SYNC_FLUSH, () => resolve(Buffer.concat(chunks)))
  })
  const result = apply(dir, truncated)
  assert.notEqual(result.status, 0, "truncated gzip payload must exit non-zero")
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo\n")
  assert.ok(!fs.existsSync(path.join(dir, "new.txt")))
})

test("a gzip payload with a corrupted CRC trailer fails and changes nothing", (t) => {
  const dir = checkout(t)
  const corrupted = Buffer.from(gzipSync(Buffer.from(diff)))
  corrupted[corrupted.length - 8] ^= 0xff
  const result = apply(dir, corrupted)
  assert.notEqual(result.status, 0, "corrupted gzip CRC must exit non-zero")
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo\n")
  assert.ok(!fs.existsSync(path.join(dir, "new.txt")))
})
