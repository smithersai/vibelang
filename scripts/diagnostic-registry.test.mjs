import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import {readFileSync} from "node:fs"
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
