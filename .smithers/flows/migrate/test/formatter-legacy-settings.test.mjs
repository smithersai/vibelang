import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

// Wiring a formatter into a project keeps its own dprint semicolon settings,
// local or inherited. Moved from packages/compiler/test/format-lambda-pipeline.
const compiler = fileURLToPath(new URL("../../../../packages/compiler/", import.meta.url))

test("a supplied formatter backend preserves local legacy semicolon preferences", t => {
  const root = mkdtempSync(join(tmpdir(), "vibe-formatter-options-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { fmt: "dprint check" } }))
  writeFileSync(join(root, "dprint.json"), JSON.stringify({
    plugins: [],
    typescript: { semiColons: "always", "forStatement.spaceAfterSemiColons": false },
  }))
  wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) })
  const config = JSON.parse(readFileSync(join(root, "dprint.json"), "utf8"))
  assert.equal(config.typescript.semicolons ?? config.typescript.semiColons, "always")
  assert.equal(config.typescript["forStatement.spaceAfterSemicolons"] ?? config.typescript["forStatement.spaceAfterSemiColons"], false)
  const result = spawnSync(join(compiler, "node_modules", ".bin", "dprint"),
    ["fmt", "--config", join(root, "dprint.json"), "--stdin", "file.ts"], {
      cwd: root, input: "export const marker=1;for(let i=0;i<1;i++){break}", encoding: "utf8",
    })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /export const marker = 1;/)
  assert.match(result.stdout, /for \(let i = 0;i < 1;i\+\+\)/)
  assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) }).changed, [])
})

test("supplying a formatter preserves inherited legacy settings and their configuration file", t => {
  for (const inherited of ["./style.json", ["./style.json"]]) {
    const root = mkdtempSync(join(tmpdir(), "vibe-formatter-inherited-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const shared = JSON.stringify({ typescript: { semiColons: "always", "forStatement.spaceAfterSemiColons": false } })
    writeFileSync(join(root, "style.json"), shared)
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { fmt: "dprint check" } }))
    writeFileSync(join(root, "dprint.json"), JSON.stringify({ extends: inherited, plugins: [] }))
    wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) })
    const config = JSON.parse(readFileSync(join(root, "dprint.json"), "utf8"))
    assert.deepEqual(config.extends, inherited)
    assert.equal(readFileSync(join(root, "style.json"), "utf8"), shared)
    const result = spawnSync(join(compiler, "node_modules", ".bin", "dprint"),
      ["fmt", "--config", join(root, "dprint.json"), "--stdin", "file.ts"], {
        cwd: root, input: "export const marker=1;for(let i=0;i<1;i++){break}", encoding: "utf8",
      })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /export const marker = 1;/)
    assert.match(result.stdout, /for \(let i = 0;i < 1;i\+\+\)/)
    assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) }).changed, [])
  }
})
