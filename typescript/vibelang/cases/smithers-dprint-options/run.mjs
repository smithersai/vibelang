// run-seconds: 120
// rule-evidence: docs/design/src/007-tooling.md#formatting-and-existing-tools
// A repository's dprint.json supplies the same layout options to .vibe as .ts.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("../../../../packages/compiler/bin/vibelang-format", import.meta.url))
const dir = mkdtempSync(join(tmpdir(), "dprint-options-case-"))
try {
  mkdirSync(join(dir, ".jj"))
  for (const name of ["main.vibe", "dprint.json"]) writeFileSync(join(dir, name), readFileSync(new URL(name, import.meta.url)))
  const invoke = mode => {
    const result = spawnSync(process.execPath, [cli, mode, "main.vibe"], {
      cwd: dir, encoding: "utf8", timeout: 20_000,
      env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" }
    })
    assert.ifError(result.error)
    return result
  }
  const check = invoke("--check")
  assert.equal(check.status, 1, check.stdout + check.stderr)
  const written = invoke("--write")
  assert.equal(written.status, 0, written.stdout + written.stderr)
  const expected = "export const values = [\n    111111,\n    222222,\n    333333,\n    444444,\n    555555,\n    666666\n];\n"
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), expected)
  const clean = invoke("--check")
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), expected)
  console.log("dprint options preserved; formatted output is stable")
} finally { rmSync(dir, { recursive: true, force: true }) }
