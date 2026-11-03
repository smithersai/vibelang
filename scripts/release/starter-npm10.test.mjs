// npm 10, which Node 22 ships, crashes installing some vitest versions ("Cannot read properties
// of null (reading 'edgesOut')"), so every `npm create vibelang` on Node 22 failed. Needs the network:
//   VIBELANG_TEST_REGISTRY=1 node --test scripts/release/starter-npm10.test.mjs
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

test("the starter's published dependencies resolve under Node 22's npm", {
  skip: !process.env.VIBELANG_TEST_REGISTRY,
}, t => {
  const starter = JSON.parse(readFileSync(new URL("../../templates/app/package.json", import.meta.url), "utf8"))
  const published = pins => Object.fromEntries(Object.entries(pins).filter(([name]) => !name.startsWith("vibelang")))
  const project = mkdtempSync(join(tmpdir(), "vibelang-npm10-"))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  writeFileSync(join(project, "package.json"), JSON.stringify({
    name: "starter", version: "0.0.0", private: true, type: "module",
    dependencies: published(starter.dependencies), devDependencies: published(starter.devDependencies), overrides: starter.overrides,
  }))
  const result = spawnSync("npx", ["--yes", "npm@10.9.8", "install", "--package-lock-only", "--no-audit", "--no-fund", "--cache", join(project, ".npm")], {
    cwd: project, encoding: "utf8", timeout: 240_000,
  })
  assert.equal(result.status, 0, result.stderr)
})
