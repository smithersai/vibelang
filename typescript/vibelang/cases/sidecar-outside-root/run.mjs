import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
// run-seconds: 240
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", repo + "packages/compiler/test/sidecar-outside-root.test.mjs"], {
 encoding: "utf8", timeout: 200000,
 env: { ...process.env, VIBELANG_BINARY: repo + "typescript/built/local/tsc" }
})
assert.ifError(result.error)
assert.equal(result.status, 0, result.stdout + result.stderr)
assert.match(result.stdout, /# pass 5\b/)
assert.match(result.stdout, /# skipped 0\b/)
console.log("sidecar outside root parity")
