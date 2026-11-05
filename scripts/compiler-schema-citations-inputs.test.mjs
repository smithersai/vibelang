import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = process.env.VIBELANG_BUILD_GRAPH_ROOT ?? fileURLToPath(new URL("../", import.meta.url))
const fixtures = [
  "typescript/vibelang/cases/tsforms-schemas/main.vibe",
  "typescript/vibelang/cases/tsforms-schemas-fixed/main.vibe",
]

test("every compiler test shard keys both schema coverage fixtures", () => {
  const result = spawnSync(process.execPath, [join(root, ".smithers/node_modules/@smthrs/cli/bin/smithers.mjs"),
    "index", "//packages/...", "--workspace", root, "--format", "json", "--silent",
  ], { cwd: root, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const shards = JSON.parse(result.stdout).targets.filter((target) => /^\/\/packages:compiler-test-\d+$/.test(target.label))
  assert.ok(shards.length > 0, "the index must select compiler test shards")
  for (const shard of shards) {
    const files = new Set(shard.inputs.filter((input) => input.kind === "file").map((input) => input.path))
    for (const fixture of fixtures) {
      assert.ok(files.has(fixture), `${shard.label} must invalidate when ${fixture} changes`)
    }
  }
})
