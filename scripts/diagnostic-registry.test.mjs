import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

test("compiler diagnostic category registry matches current Appendix B", () => {
  const generator = fileURLToPath(new URL("./generate-diagnostic-registry.mjs", import.meta.url))
  const result = spawnSync(process.execPath, [generator, "--check"], {encoding: "utf8"})
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
