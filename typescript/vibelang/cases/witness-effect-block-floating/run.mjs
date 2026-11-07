// rule-evidence: docs/design/src/007-tooling.md#vibelang-warnings | An `effect { … }` expression statement builds and discards an unrun Effect; imported `floatingEffect` reports it as `EK3801`, as in TypeScript.
// project/twin.ts is project/main.vibe in Effect TypeScript: both report EK3801
// at the same discarded statements and nothing else.
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the compiler")
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "effect-block-floating-"))
try {
  fs.cpSync(path.join(here, "project"), dir, { recursive: true })
  fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir")
  const r = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
  const out = r.stdout + r.stderr
  assert.notEqual(r.status, 0, out)
  const found = [...out.matchAll(/^(\S+\(\d+,\d+\)): (\w+) (EK\d+):/gm)].map(m => m.slice(1).join(" "))
  assert.deepEqual(found, ["main.vibe(5,3) error EK3801", "main.vibe(9,1) error EK3801", "twin.ts(4,3) error EK3801", "twin.ts(8,1) error EK3801"], out)
  console.log("discarded effect blocks report EK3801 as their Effect TypeScript twins do")
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
