import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

test("the real build graph loads the documentation table checks", () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const cli = fileURLToPath(new URL("../.smithers/node_modules/.bin/smthrs", import.meta.url))
  const run = spawnSync(cli, ["graph", "//:docs-table-rows", "--workspace", root, "--format", "json"], {
    cwd: root, encoding: "utf8", timeout: 60000
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const graph = JSON.parse(run.stdout)
  assert.deepEqual(graph.roots, ["//:docs-table-rows"])
  const target = graph.targets.find(target => target.label === "//:docs-table-rows")
  assert.equal(target?.target, "Shell.Test")
  assert.deepEqual(target.kinds, ["test"])
  assert.ok(graph.edges.some(edge =>
    edge.from === "//:docs-table-rows" && edge.to === "//:tree" && edge.kind === "data"))
})
