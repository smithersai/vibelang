import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const source = "// @vibe\nexport   effect function view( ) { return <div title='ok'/> }\n"
const expected = '// @vibe\nexport effect function view() {\n  return <div title="ok" />\n}\n'
for (const explicit of [false, true]) {
  for (const mode of ["--check", "--write"]) {
    test(`format ${mode} includes marked TSX through ${explicit ? "an explicit path" : "default discovery"}`, t => {
      const dir = mkdtempSync(join(tmpdir(), "vibe-cli-tsx-"))
      t.after(() => rmSync(dir, { recursive: true, force: true }))
      writeFileSync(join(dir, "marked.tsx"), source)
      const plain = "export   const view = <div/>\n"
      writeFileSync(join(dir, "plain.tsx"), plain)
      const run = flag => spawnSync(process.execPath, [cli, "format", flag, ...(explicit ? ["marked.tsx", "plain.tsx"] : [])],
        { cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" } })
      const result = run(mode)
      assert.equal(result.status, mode === "--check" ? 1 : 0, result.stdout + result.stderr)
      assert.equal(readFileSync(join(dir, "marked.tsx"), "utf8"), mode === "--check" ? source : expected)
      assert.equal(readFileSync(join(dir, "plain.tsx"), "utf8"), plain)
      if (mode === "--write") assert.equal(run("--check").status, 0)
    })
  }
}
