import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = process.env.VIBELANG_BUILD_GRAPH_ROOT ?? fileURLToPath(new URL("../", import.meta.url))

test("the compiler gate selects the VibeLang formatter's Go regressions", () => {
  const compiler = "//packages:compiler-test"
  const formatter = "//typescript/tsc:go-vibelangfmt"
  const result = spawnSync(process.execPath, [join(root, ".smithers/node_modules/@smthrs/cli/bin/smithers.mjs"),
    "graph", compiler, "--workspace", root, "--format", "json", "--silent"
  ], { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const graph = JSON.parse(result.stdout)
  assert.ok(graph.roots.includes(compiler), "the graph must select the compiler gate")
  assert.ok(graph.edges.some(edge => edge.from === compiler && edge.to === formatter),
    "the compiler gate must select //typescript/tsc:go-vibelangfmt so formatter regressions cannot be omitted")
})
