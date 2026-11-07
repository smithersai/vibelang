import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vibelang-build-path-"))
  writeFileSync(join(root, "main.ts"), "export const value: number = 42\n")
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", noEmit: true, types: [], skipLibCheck: true }, files: ["main.ts"] }))
  return root
}
function check(root, build, option, path) {
  const result = spawnSync(native, [build, "--" + option, path, "--dry"], { cwd: root, encoding: "utf8", timeout: 20000 })
  assert.equal(result.status, 0, JSON.stringify({ build, option, path }) + "\n" + result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout + result.stderr, /panic:|goroutine \d/)
}
for (const option of ["generateCpuProfile", "generateTrace", "pprofDir"]) {
  test("build resolves a relative " + option + " path before creating compiler options", () => {
    const root = fixture()
    try { check(root, "-b", option, "nested/profiles") }
    finally { rmSync(root, { recursive: true, force: true }) }
  })
}
test("build path options accept aliases, nested paths, spaces and Unicode", () => {
  const root = fixture()
  try {
    fc.assert(fc.property(
      fc.constantFrom("-b", "--build", "--BUILD"),
      fc.constantFrom("generateCpuProfile", "generateTrace", "pprofDir"),
      fc.constantFrom("./profiles", "nested/../profiles", "with space/profiles", "深い/分析"),
      (build, option, path) => check(root, build, option, path)
    ), { numRuns: 12 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

