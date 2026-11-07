// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Only a marked module is migration input.
// vibelang --fix on a project whose exported mains carry no marker applies no
// fix, reports no diagnostic, exits 0 and leaves every source byte for byte.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const here = fileURLToPath(new URL(".", import.meta.url))
const sources = ["effect.vibe", "plain.vibe", "say.ts"]
const root = mkdtempSync(join(tmpdir(), "entry-fix-unmarked-"))
try {
  symlinkSync(join(here, "node_modules"), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  for (const name of sources) writeFileSync(join(root, name), readFileSync(join(here, name)))
  writeFileSync(join(root, "tsconfig.json"), readFileSync(join(here, "tsconfig.json")))
  const fixed = spawnSync(binary, ["--fix", "-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
  assert.doesNotMatch(fixed.stdout, /\w+\.(vibe|ts)\(\d+,\d+\): /, `an unmarked main gets no diagnostic\n${fixed.stdout}`)
  assert.doesNotMatch(fixed.stdout, /not fixed/, fixed.stdout)
  for (const name of sources) assert.equal(readFileSync(join(root, name), "utf8"), readFileSync(join(here, name), "utf8"), `--fix rewrote ${name}, which has no marker`)
  console.log("an unmarked main is not migration input")
} finally {
  rmSync(root, { recursive: true, force: true })
}
