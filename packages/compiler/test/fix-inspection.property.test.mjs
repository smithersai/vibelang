import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))

test("informational flags remain read-only across repair aliases, order and response files", async () => {
  await checkProperty(fc, {
    name: "fix-informational-flags",
    rule: "--help prints help and --version prints the version; --fix does not change an informational command into a source repair.",
    command: "node --test packages/compiler/test/fix-inspection.property.test.mjs",
    numRuns: 32,
    arbitrary: fc.record({
      flag: fc.constantFrom("--help", "-h", "-?", "--all", "--version", "-v"),
      fix: fc.constantFrom("--fix", "--FIX"),
      fixFirst: fc.boolean(), response: fc.boolean(), invalidConfig: fc.boolean()
    }),
    check(input) {
      const root = mkdtempSync(join(tmpdir(), "vibelang-fix-info-property-"))
      try {
        if (input.invalidConfig) writeFileSync(join(root, "tsconfig.json"), "{invalid")
        let flag = input.flag
        if (input.response) { writeFileSync(join(root, "args.txt"), flag); flag = "@args.txt" }
        const before = Object.fromEntries(readdirSync(root).map(name => [name, readFileSync(join(root, name), "utf8")]))
        const args = input.fixFirst ? [input.fix, flag] : [flag, input.fix]
        const result = spawnSync(native, args, { cwd: root, encoding: "utf8", timeout: 20000 })
        assert.equal(result.status, 0, JSON.stringify(input) + "\n" + result.stdout + result.stderr)
        assert.equal(result.stderr, "")
        assert.match(result.stdout, /VibeLang|vibelang/)
        assert.deepEqual(Object.fromEntries(readdirSync(root).map(name => [name, readFileSync(join(root, name), "utf8")])), before)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  })
})

