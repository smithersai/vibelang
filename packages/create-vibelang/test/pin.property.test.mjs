import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { fixture, managers, scaffold } from "./options-build.mjs"

test("scaffolds retain exact platform helper pins for every package manager", async () => {
  const f = fixture()
  try {
    await checkProperty(fc, {
      name: "scaffold-platform-helper-pins",
      rule: "docs/user/src/setup/new-project.md: 1. Create the project; the platform helper stays on the pinned Effect version",
      command: "node --test packages/create-vibelang/test/pin.property.test.mjs",
      regressions: new URL("./property-regressions/", import.meta.url),
      arbitrary: fc.record({
        manager: fc.constantFrom(...managers),
        source: fc.constantFrom("checkout", "packed"),
        name: fc.array(fc.constantFrom("a", "Z", "0", " ", "雪", "'", "$", "#"), { maxLength: 12 })
          .map(parts => "app" + parts.join(""))
      }),
      numRuns: 50,
      check: input => {
        const directory = mkdtempSync(join(f.directory, "pin-"))
        try {
          const created = scaffold(f, { ...input, noInstall: true, noGit: true }, directory, f.env)
          assert.equal(created.status, 0, created.output)
          const manifest = JSON.parse(readFileSync(join(directory, input.name, "package.json")))
          const effect = manifest.dependencies.effect
          assert.equal(manifest.dependencies["@effect/platform-node"], effect)
          assert.equal(manifest.devDependencies["@effect/vitest"], effect)
          assert.equal(manifest.overrides["@effect/platform-node-shared"], effect)
          assert.equal(manifest.resolutions?.["@effect/platform-node-shared"], effect)
        } finally {
          rmSync(directory, { recursive: true, force: true })
        }
      }
    })
  } finally {
    f.cleanup()
  }
})
