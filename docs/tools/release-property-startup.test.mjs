import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../../", import.meta.url))
for (const [file, pattern, count] of [
  ["release-coverage-publication.test.mjs", "contrast bookkeeping guard|restored product fixes remain", 2],
  ["release-contrast-publication.test.mjs", "contrast publication guard covers", 1]
]) test("publication properties do not require a Node subprocess: " + file, () => {
  const sandbox = mkdtempSync(join(tmpdir(), "release-property-startup-"))
  try {
    const bin = join(sandbox, "bin")
    mkdirSync(bin)
    const node = join(bin, "node")
    writeFileSync(node, "#!/bin/sh\necho unexpected-publication-node-child >&2\nexit 86\n")
    chmodSync(node, 0o755)
    const env = { ...process.env, PATH: bin + ":" + process.env.PATH }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync("bun", ["test", "--timeout", "60000", "docs/tools/" + file, "-t", pattern], {
      cwd: root, env, encoding: "utf8", timeout: 30000
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, new RegExp("\\b" + count + " pass\\b"))
    assert.doesNotMatch(result.stdout + result.stderr, /unexpected-publication-node-child/)
  } finally { rmSync(sandbox, { recursive: true, force: true }) }
})
