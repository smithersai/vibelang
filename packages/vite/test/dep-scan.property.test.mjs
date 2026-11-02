// Run through test/run.sh, which links effect into test/.fixtures/node_modules.
import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { features, fixtureRoot, scanProject } from "./dep-scan.mjs"

const rule = "docs/user/src/setup/vite.md: Dependency pre-bundling (the scan reads each .vibe module's JavaScript)"
const regressions = new URL("./property-regressions/", import.meta.url)

// Every bare import a reached .vibe module's JavaScript adds (effect/Schema for
// a schema, effect/Option for Option, effect/Effect for effect { }) is found by
// a cold scan, whichever entry, barrel chain and specifier form reaches it, so
// no request discovers a dependency late.
const arbitrary = fc.record({
  entry: fc.constantFrom("html", "ts", "default"),
  barrels: fc.array(fc.constantFrom("vibe", "ts"), { maxLength: 2 }),
  explicit: fc.boolean(),
  features: fc.uniqueArray(fc.constantFrom(...Object.keys(features)), { minLength: 1, maxLength: 3 })
})

test("vite-dep-scan", async () => {
  await checkProperty(fc, { name: "vite-dep-scan", rule, arbitrary, numRuns: 8, regressions,
    command: "node --test test/dep-scan.property.test.mjs",
    async check(input) {
      const root = fixtureRoot()
      try {
        const { scanned, late, emitted } = await scanProject(root, input)
        // The fixtures' vibelang-runtime links a directory outside node_modules,
        // which Vite serves as source rather than pre-bundling.
        const reached = [...new Set(Object.values(emitted).flat())].filter((dep) => dep.startsWith("effect"))
        assert.ok(reached.length > 0, JSON.stringify(emitted))
        for (const dep of reached) assert.ok(scanned.includes(dep), `scan missed ${dep}: ${JSON.stringify(scanned)}`)
        assert.deepEqual(late, [], `found on request: ${JSON.stringify(late)}`)
      } finally { rmSync(root, { recursive: true, force: true }) }
    } })
})
