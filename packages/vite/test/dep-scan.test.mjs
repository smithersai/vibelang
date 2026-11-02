// Run through test/run.sh, which links effect into test/.fixtures/node_modules.
import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import test from "node:test"
import { fixtureRoot, scanProject } from "./dep-scan.mjs"

// drive2-opencode's reduction of opencode's app stories (Vite 7.3.6): a cold
// scan found [] and the first request found effect/Schema, which only the
// emitted JavaScript of value.vibe imports.
test("a cold dependency scan finds the bare imports a .vibe module's JavaScript adds", async (t) => {
  const root = fixtureRoot()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { scanned, late, emitted } = await scanProject(root, { entry: "html", barrels: [], explicit: true, features: ["schema"] })
  assert.ok(emitted["value.vibe"].includes("effect/Schema"), JSON.stringify(emitted))
  assert.ok(scanned.includes("effect/Schema"), `scan found ${JSON.stringify(scanned)}`)
  assert.deepEqual(late, [])
})
