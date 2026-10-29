import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo = process.env.VIBELANG_HYGIENE_ROOT ?? fileURLToPath(new URL("../", import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-contributor-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test("the starter test command discovers individual test files on Node 22.22.3", t => {
  const root = fixture(t)
  mkdirSync(join(root, "test"))
  for (const name of ["one", "two"]) {
    writeFileSync(join(root, "test", name + ".test.mjs"), 'import { test } from "node:test"; test("' + name + '", () => {})')
  }
  const command = JSON.parse(readFileSync(join(repo, "packages/create-vibelang/package.json"), "utf8")).scripts.test
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8", env })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /tests 2/)
})

test("smoke gives the Go suite an explicit timeout with headroom", t => {
  const root = fixture(t)
  for (const dir of ["typescript/vibelang", "typescript/tsc", "packages/runtime", "bin", "modules/effect"]) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  const smoke = join(root, "typescript/vibelang/smoke.sh")
  copyFileSync(join(repo, "typescript/vibelang/smoke.sh"), smoke)
  const log = join(root, "commands")
  for (const name of ["go", "node"]) {
    const path = join(root, "bin", name)
    writeFileSync(path, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_COMMAND_LOG"\n')
    chmodSync(path, 0o755)
  }
  const result = spawnSync("sh", [smoke], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH,
      EFFECT_NODE_MODULES: join(root, "modules"), VIBELANG_RUNTIME: join(root, "packages/runtime"),
      TEST_COMMAND_LOG: log },
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const calls = readFileSync(log, "utf8").split("\n")
  const suite = calls.find(line => line.startsWith("test "))
  assert.ok(suite, calls.join("\n"))
  const timeout = /-timeout(?:=|\s+)(\d+)m\b/.exec(suite)
  assert.ok(timeout && Number(timeout[1]) >= 20, "expected at least 20 minutes: " + suite)
})
