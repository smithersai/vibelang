import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { assertBaselineSafe } from "../lib/baseline.mjs"
import { paths } from "../lib/steps.mjs"
import { writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

// The flow's baseline rule: failed or unfinished toolchain work cannot become
// the baseline, even when later ordinary checks and tests would all pass.
test("Alchemy VIP finishing receipts reject incomplete work and every recorded failure", () => {
  fc.assert(fc.property(
    fc.constantFrom("checking", "fixing", "failed", "complete"),
    fc.boolean(), fc.boolean(),
    fc.constantFrom("tsconfig.json", "packages/domain/tsconfig.json", "pkg with space/tsconfig.json"),
    (state, failed, includeSetup, project) => {
      const root = mkdtempSync(join(tmpdir(), "migrate-vip-finish-admission-"))
      try {
        const p = paths(root)
        writeJson(join(p.baseline, "logs/vip-finish.json"), { state, project, changed: [], projects: [], failed: failed ? [{ project, code: 2 }] : [] })
        if (state !== "complete" || failed) assert.throws(() => assertBaselineSafe(p, { includeSetup }), /toolchain baseline regression/)
        else assert.equal(assertBaselineSafe(p, { includeSetup }).state, "accepted")
      } finally { rmSync(root, { recursive: true, force: true }) }
    },
  ), { seed: 560204, numRuns: 120 })
})

test("a legacy upgrade's failed VIP finish is rejected when its command logs are absent", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-finish-legacy-"))
  try {
    const p = paths(root)
    writeJson(p.upgrade, { vipFinish: { changed: [], projects: ["tsconfig.json"], failed: [{ project: "tsconfig.json", code: 127 }] } })
    assert.throws(() => assertBaselineSafe(p), /toolchain baseline regression/)
    assert.equal(JSON.parse(readFileSync(join(p.baseline, "admission.json"), "utf8")).state, "rejected")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a later green finish receipt cannot erase a legacy failed upgrade", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-finish-replaced-"))
  try {
    const p = paths(root)
    writeJson(p.upgrade, { vipFinish: { failed: [{ project: "tsconfig.json", code: 2 }] } })
    writeJson(join(p.baseline, "logs/vip-finish.json"), { state: "complete", failed: [] })
    assert.throws(() => assertBaselineSafe(p), /toolchain baseline regression/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
