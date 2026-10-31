import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { workspaceGlobs, workspaceManifests } from "../lib/upgrade.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const quote = "the root and each workspace member, leaving a vendored tree that no workspace names as it is"
const name = fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/)

test("alchemy and t3code: workspace selection leaves cross-version fixtures and vendored manifests untouched", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote), "update the quoted workspace contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-workspace-boundary.json", import.meta.url), "utf8"))
  assert.deepEqual(workspaceManifests(corpus.paths, corpus.globs), corpus.expected)
  fc.assert(fc.property(
    fc.constantFrom("packages", "apps", "modules"),
    fc.uniqueArray(name, { minLength: 2, maxLength: 12 }),
    fc.integer({ min: 0, max: 2 }),
    (root, names, configKind) => {
      const excluded = names[0]
      const globs = [root + "/*", "!" + root + "/" + excluded]
      const paths = ["package.json", "pnpm-workspace.yaml"]
      const expected = [...paths]
      for (const member of names) {
        paths.push(root + "/" + member + "/package.json")
        if (member !== excluded) expected.push(root + "/" + member + "/package.json")
        paths.push(
          ".repos/" + member + "/" + root + "/core/package.json",
          "test/cross-version-test/test/" + member + "/package.json",
          root + "/" + member + "/template/package.json",
          root + "/" + member + "/test/fixture/package.json"
        )
      }
      const manifest = configKind === 0 ? { workspaces: globs } : configKind === 1 ? { workspaces: { packages: globs } } : {}
      const yaml = configKind === 2 ? "packages:\n" + globs.map((g) => "  - " + JSON.stringify(g)).join("\n") + "\n" : ""
      const declared = workspaceGlobs(JSON.stringify(manifest), yaml)
      assert.deepEqual([...workspaceManifests(paths, declared)].sort(), expected.sort())
    }
  ), { seed: 501298, numRuns: 300 })
})
