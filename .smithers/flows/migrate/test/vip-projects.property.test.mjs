// Generated repository layouts for upgrade-effect's VIP migration step: every
// project that holds a .vibe file is fixed once, by the vibelang installed
// nearest it, and no project without one is touched.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { test } from "node:test"
import { earlierVipProjects } from "../lib/steps.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

const dirs = [".", "packages", "packages/ai", "packages/ai/src", "packages/ai/src/protocols", "packages/core", "packages/core/src", "apps/web", "apps/web/src"]
const layout = fc.record({
  projects: fc.subarray(dirs, { minLength: 1 }),
  installs: fc.subarray(dirs),
  vibe: fc.uniqueArray(fc.tuple(fc.constantFrom(...dirs), fc.constantFrom("a", "b", "fal-queue")), { maxLength: 8, selector: ([d, n]) => d + n })
})

// The nearest of names at or above dir, as the step reads the tree.
const nearest = (dir, names) => {
  for (let d = dir; ; d = posix.dirname(d)) {
    if (names.includes(d)) return d
    if (d === ".") return undefined
  }
}

test("vip-fix-projects: each project with a .vibe file once, with its nearest installed compiler", () => {
  fc.assert(fc.property(layout, ({ projects, installs, vibe }) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-vip-projects-"))
    try {
      for (const d of projects) { mkdirSync(join(root, d), { recursive: true }); writeFileSync(join(root, d, "tsconfig.json"), "{}\n") }
      for (const d of installs) { mkdirSync(join(root, d, "node_modules/.bin"), { recursive: true }); writeFileSync(join(root, d, "node_modules/.bin/vibelang"), "") }
      const files = vibe.map(([d, n]) => posix.join(d, `${n}.vibe`))
      for (const f of files) { mkdirSync(join(root, posix.dirname(f)), { recursive: true }); writeFileSync(join(root, f), "export const v = 1\n") }
      const expected = [...new Set(files.map((f) => nearest(posix.dirname(f), projects)).filter((d) => d !== undefined))].sort()
        .map((d) => posix.join(d, "tsconfig.json")).sort()
        .map((project) => {
          const at = nearest(posix.dirname(project), installs)
          return { project, compiler: at === undefined ? undefined : posix.join(at, "node_modules/.bin/vibelang") }
        })
      assert.deepEqual(earlierVipProjects(root, files), expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 33033, numRuns: 200 })
})
