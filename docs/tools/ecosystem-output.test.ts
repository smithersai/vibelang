import { test, expect } from "bun:test"
import fc from "fast-check"
import { publicOutput, assertPublicOutput } from "../../site/scripts/record-ecosystem.mjs"

test("recording output replaces complete project roots without changing diagnostics", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 97, max: 122 }), { minLength: 1, maxLength: 20 }).map(xs => String.fromCharCode(...xs)), name => {
    for (const root of [String.fromCharCode(47) + "temporary/" + name + "/project", "C:" + String.fromCharCode(92) + "temporary" + String.fromCharCode(92) + name]) {
      const raw = root + "/lint.vibe\n  2:9 error 'unused' is assigned a value but never used no-unused-vars"
      const output = publicOutput(raw, root)
      expect(output).toBe("my-app/lint.vibe\n  2:9 error 'unused' is assigned a value but never used no-unused-vars")
      expect(() => assertPublicOutput(output)).not.toThrow()
    }
  }), { numRuns: 200 })
})
test("an unexpected absolute root is rejected before rendering", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 99999 }), id => {
    for (const text of [String.fromCharCode(47) + "unexpected/root/" + id + "/file.vibe", "D:" + String.fromCharCode(92) + "unexpected" + String.fromCharCode(92) + id]) {
      expect(() => assertPublicOutput(text)).toThrow("absolute machine path")
    }
  }), { numRuns: 200 })
})
test("ANSI controls and machine-clock rows are absent while relative output survives", () => {
  const project = String.fromCharCode(47) + "temporary/project"
  expect(publicOutput("\x1b[32mPASS\x1b[0m\n Start at 12:34:56\nmy-app/src/test.vibe", project)).toBe("PASS\nmy-app/src/test.vibe")
})
