import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
const cli = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
function check(root, path) {
  const result = spawnSync(process.execPath, [cli, "agents", "init", path], { cwd: root, encoding: "utf8", timeout: 10000 })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /^vibelang agents init:/)
  assert.match(result.stderr, /existing project directory/)
  assert.doesNotMatch(result.stderr, /\n\s+at |node:fs:|Node\.js v/)
}
test("agents init reports an absent target without an uncaught exception", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-agents-absent-"))
  try {
    check(root, "absent/project")
    assert.deepEqual(readdirSync(root), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("agents init reports inaccessible target paths across filename mutations", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-agents-target-property-"))
  try {
    writeFileSync(join(root, "ordinary-file"), "keep")
    fc.assert(fc.property(
      fc.array(fc.constantFrom("a", "z", " ", "é", "-"), { minLength: 1, maxLength: 12 }),
      fc.boolean(),
      (letters, fileParent) => check(root, (fileParent ? "ordinary-file/" : "absent/") + letters.join(""))
    ), { numRuns: 32 })
    assert.deepEqual(readdirSync(root), ["ordinary-file"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

