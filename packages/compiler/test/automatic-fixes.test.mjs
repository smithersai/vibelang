import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const source = "export const value: number = 1\n"

// VibeLang owns no automatic source fixes before 1.0. Rejected flags must
// reach TypeScript's option parser before any source or output is written.
const options = [
  ["--fix"], ["--FIX"], ["--fix-vip-only"], ["--fix-migration-only"], ["--fix-only"],
  ["--fix", "--fix-vip-only"], ["--fix-vip-only", "--fix"],
  ["--fix", "--fix-migration-only"], ["--fix-migration-only", "--fix"],
]
for (const flags of options) {
  test(`automatic fix option ${flags.join(" ")} is rejected without writing files`, () => {
    const dir = mkdtempSync(join(tmpdir(), "compiler-options-"))
    try {
      writeFileSync(join(dir, "main.vibe"), source)
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext" }, files: ["main.vibe"] }))
      const before = readdirSync(dir)
      const result = spawnSync(native, [...flags, "-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8" })
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stdout + result.stderr, /TS5023: Unknown compiler option/)
      assert.deepEqual(readdirSync(dir), before)
      assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), source)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}
