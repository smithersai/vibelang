import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

test("the content checker removes its snippet report after valid, malformed and missing reports", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-content-cleanup-"))
  try {
    const bin = join(scratch, "bin")
    const temp = join(scratch, "tmp")
    mkdirSync(bin)
    mkdirSync(temp)
    const runner = join(bin, "bun")
    writeFileSync(runner, `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
const output = process.argv[process.argv.indexOf("--json") + 1]
if (process.env.SNIPPET_REPORT === "valid") writeFileSync(output, JSON.stringify({ pages: [{ blocks: [{ status: "ok" }] }] }))
else if (process.env.SNIPPET_REPORT === "malformed") writeFileSync(output, "{")
else { console.error("fixture: missing report"); process.exitCode = 1 }
`)
    chmodSync(runner, 0o755)
    for (const report of ["valid", "malformed", "missing"]) {
      const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "check-smithers-content.ts")], {
        env: { ...process.env, PATH: bin + delimiter + process.env.PATH, TMPDIR: temp, SNIPPET_REPORT: report },
        stdout: "pipe", stderr: "pipe"
      })
      const stderr = result.stderr.toString()
      if (report === "valid") expect(stderr).not.toContain("check-snippets.ts did not report")
      else {
        expect(result.exitCode).toBe(1)
        expect(stderr).toContain("check-snippets.ts did not report on app.md")
      }
      expect(readdirSync(temp).filter(name => name.startsWith("vibelang-content-"))).toEqual([])
    }
  } finally { rmSync(scratch, { recursive: true, force: true }) }
})
