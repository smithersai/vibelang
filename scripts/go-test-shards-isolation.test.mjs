import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// Reproduce post-merge's host-local slice next to the real launcher without
// writing into the checkout. Run the original fixture assertions unchanged.
const host = spawnSync("uname", ["-n"], { encoding: "utf8" }).stdout.trim()
const suites = [
  ["go-test-shards-selector.test.mjs", "healthy selector control"],
  ["go-test-shards-positional.test.mjs", "equals-form options still shard"],
  ["go-test-shards.test.mjs", "SIG(TERM|INT|HUP) while running"],
]
for (const [file, pattern] of suites) {
  for (const [slice, ambient] of [["3/3", ""], ["2/7", "2/3"], ["1/2", "invalid"]]) {
    test(file + " keeps fixture coverage with host slice " + slice + " and ambient " + JSON.stringify(ambient), t => {
      const root = mkdtempSync(join(tmpdir(), "go-shard-host-slice-"))
      t.after(() => rmSync(root, { recursive: true, force: true }))
      for (const name of [file, "go-test-shards.sh"]) {
        cpSync(new URL("./" + name, import.meta.url), join(root, name))
      }
      writeFileSync(join(root, "go-test-slice"), slice + " " + host + "\n")
      const env = { ...process.env, GO_TEST_SLICE: ambient }
      delete env.NODE_TEST_CONTEXT // launch an independent test runner, not a nested worker
      const result = spawnSync(process.execPath, [
        "--test", "--test-name-pattern=" + pattern, join(root, file),
      ], {
        cwd: root, encoding: "utf8", timeout: 30_000,
        env,
      })
      assert.equal(result.error, undefined, result.stdout + result.stderr)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /(?:#|ℹ) pass [1-9]/, "the selected assertions must execute")
    })
  }
}
