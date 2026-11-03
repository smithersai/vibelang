import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo = fileURLToPath(new URL("../", import.meta.url))

test("no native executable imports the fuzz package excluded from its inputs", () => {
  const run = spawnSync("go", ["list", "-deps", "-f", "{{.Dir}}",
    "./cmd/tsc", "./cmd/vibelang-forms", "./cmd/vibelang-mapper"], {
    cwd: join(repo, "typescript/tsc"), encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024
  })
  assert.equal(run.status, 0, run.stdout + run.stderr + String(run.error ?? ""))
  const directories = run.stdout.trim().split("\n")
  assert.ok(directories.length > 20, "must inspect the actual transitive Go dependency graph")
  const excluded = join(repo, "typescript/tsc/internal/vibelangfuzz")
  assert.deepEqual(directories.filter(path => path === excluded || path.startsWith(excluded + "/")), [],
    "a new production import requires expanding native inputs before this exclusion is safe")
})
