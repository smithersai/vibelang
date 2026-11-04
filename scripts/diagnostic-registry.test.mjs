import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

test("compiler diagnostic category registry matches current Appendix B", () => {
  const generator = fileURLToPath(new URL("./generate-diagnostic-registry.mjs", import.meta.url))
  const result = spawnSync(process.execPath, [generator, "--check"], {encoding: "utf8"})
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test("imported rule defaults stay in their pinned registry instead of becoming own errors",()=>{
 const own=readFileSync(new URL("../typescript/tsc/internal/core/vibe_diagnostic_registry.go",import.meta.url),"utf8")
 const imported=readFileSync(new URL("../typescript/tsc/internal/core/vibe_lint_codes.go",import.meta.url),"utf8")
 assert.doesNotMatch(own,/"EK38[0-9]+"/)
 assert.match(imported,/"EK38100"/)
})


test("contextual error variants stay locked regardless of the row's prefix category", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-diagnostic-registry-"))
  try {
    for (const path of ["scripts", "docs/design/src", "typescript/tsc/internal/core"]) {
      mkdirSync(join(dir, path), { recursive: true })
    }
    copyFileSync(new URL("./generate-diagnostic-registry.mjs", import.meta.url), join(dir, "scripts/generate-diagnostic-registry.mjs"))
    const tick = String.fromCharCode(96)
    const rows = [
      ["EK1101", "warning; Category variants: " + tick + "error" + tick + ", " + tick + "warning" + tick + "."],
      ["EK1102", "error; Category variants: " + tick + "error" + tick + ", " + tick + "warning" + tick + "."],
      ["EK1103", "warning: ordinary configurable warning"],
      ["EK1104", "error: ordinary error"]
    ]
    writeFileSync(join(dir, "docs/design/src/900-appendices.md"), "## Appendix B. Diagnostics\n\n| Code | Rule | VIP | Chapter |\n| --- | --- | --- | --- |\n" + rows.map(([code, rule]) => "| " + code + " | " + rule + " | 11 | Test |").join("\n") + "\n")
    const result = spawnSync(process.execPath, [join(dir, "scripts/generate-diagnostic-registry.mjs")], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const output = readFileSync(join(dir, "typescript/tsc/internal/core/vibe_diagnostic_registry.go"), "utf8")
    const variants = output.match(/var VibeDiagnosticErrorVariants = map\[string\]bool\{([^}]+)\}/)
    assert.ok(variants, "generated registry must retain error-variant eligibility")
    assert.match(variants[1], /"EK1101":\s*true/)
    assert.match(variants[1], /"EK1102":\s*true/)
    assert.doesNotMatch(variants[1], /EK110[34]/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
