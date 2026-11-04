import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { test } from "node:test"
import { apiProjection } from "../lib/api-projection.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-sibling-declaration-projection.json", import.meta.url), "utf8"))
const rule = "Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin"
const command = "node --test .smithers/flows/migrate/test/api-projection-siblings.test.mjs"

function fixture(check, depth = 2) {
  const root = mkdtempSync(join(resolve(tmpdir()), "api-projection-siblings-"))
  const snapshot = join(root, "snapshot")
  const packageDir = join(root, "repo", ...Array.from({ length: depth }, (_, i) => "pkg-" + i))
  mkdirSync(snapshot)
  writeFileSync(join(snapshot, "x.d.ts"), corpus.before["x.d.ts"])
  const surface = { apiMetadata: { packageDir, manifest: { name: "app", private: true }, aliases: {}, layouts: [],
    logicalPaths: { "x.d.ts": "src/x.d.ts" } } }
  try { return check({ root, snapshot, surface }) }
  finally { rmSync(root, { recursive: true, force: true }) }
}

for (const logical of corpus.logicalPaths) {
  test("t3code sibling projection: " + logical, () => fixture(({ snapshot, surface }) => {
    surface.apiMetadata.logicalPaths["x.d.ts"] = logical
    const projection = apiProjection({}, snapshot, surface, ["x.d.ts"], { published: false })
    try {
      assert.equal(readFileSync(resolve(projection.directory, logical), "utf8"), corpus.before["x.d.ts"])
      assert.equal(projection.destinations.get("x.d.ts"), logical)
      assert.equal(projection.originals.get(logical), "x.d.ts")
    } finally { projection.cleanup() }
    assert.equal(existsSync(projection.directory), false)
  }))
}

function ancestorCount(directory) {
  let count = 1
  for (let cursor = resolve(directory); dirname(cursor) !== cursor; cursor = dirname(cursor)) count++
  return count
}

test("negative: declaration paths cannot leave the isolated projection", () => fixture(({ root, snapshot, surface }) => {
  const count = ancestorCount(surface.apiMetadata.packageDir)
  for (const logical of ["../".repeat(count + 1) + "outside.d.ts", join(root, "outside.d.ts")]) {
    surface.apiMetadata.logicalPaths["x.d.ts"] = logical
    assert.throws(() => apiProjection({}, snapshot, surface, ["x.d.ts"]), /escapes its comparison projection/)
    assert.equal(existsSync(join(root, "outside.d.ts")), false)
  }
}))

test("negative: mirrored dependency links remain read-only", () => fixture(({ root, snapshot, surface }) => {
  const dependency = join(root, "repo/node_modules/dependency")
  mkdirSync(dependency, { recursive: true })
  const original = "export type Original = string;\n"
  writeFileSync(join(dependency, "x.d.ts"), original)
  surface.apiMetadata.logicalPaths["x.d.ts"] = "../../node_modules/dependency/x.d.ts"
  assert.throws(() => apiProjection({}, snapshot, surface, ["x.d.ts"]), /escapes its comparison projection/)
  assert.equal(readFileSync(join(dependency, "x.d.ts"), "utf8"), original)
}))

test("property: every mirrored parent depth is accepted and the next parent escapes", async () => {
  const fc = require("fast-check")
  await checkProperty(fc, {
    name: "api-projection-siblings", rule, command, numRuns: 128,
    regressions: new URL("./corpus/", import.meta.url),
    arbitrary: fc.record({
      depth: fc.integer({ min: 0, max: 8 }),
      parents: fc.integer({ min: 0, max: 24 }),
      suffix: fc.constantFrom("scripts/lib/x.d.ts", "packages/shared/x.d.ts", "types with spaces/x.d.ts"),
    }),
    check: ({ depth, parents, suffix }) => fixture(({ snapshot, surface }) => {
      const count = ancestorCount(surface.apiMetadata.packageDir)
      const up = parents % (count + 2)
      const logical = "../".repeat(up) + suffix
      surface.apiMetadata.logicalPaths["x.d.ts"] = logical
      if (up > count) {
        assert.throws(() => apiProjection({}, snapshot, surface, ["x.d.ts"]), /escapes its comparison projection/)
        return
      }
      const projection = apiProjection({}, snapshot, surface, ["x.d.ts"])
      try {
        const output = resolve(projection.directory, logical)
        assert.ok(relative(projection.directory, output).split(sep).filter(part => part === "..").length <= count)
        assert.equal(readFileSync(output, "utf8"), corpus.before["x.d.ts"])
      } finally { projection.cleanup() }
    }, depth),
  })
})

test("sibling imports compare equally and real type and documentation changes still fail", async () => {
  const ts = require("typescript")
  const { compareDeclarations } = await import("../lib/declarations.mjs")
  fixture(({ root, snapshot, surface }) => {
    const after = join(root, "after")
    mkdirSync(after)
    const files = Object.keys(corpus.before)
    const metadata = { ...surface.apiMetadata, manifest: { name: "app", private: true, type: "module", types: "./index.d.ts" },
      logicalPaths: { "index.d.ts": "index.d.ts", "x.d.ts": "../../scripts/lib/x.d.ts" } }
    for (const dir of [snapshot, after]) {
      for (const [file, text] of Object.entries(corpus.before)) writeFileSync(join(dir, file), text)
      writeFileSync(join(dir, "public-surface.json"), JSON.stringify({
        snapshotVersion: 3, roots: ["index.d.ts"], reachable: files, unresolved: [], apiMetadata: metadata,
      }))
    }
    const same = compareDeclarations(ts, snapshot, after)
    assert.equal(same.comparisonComplete, true, JSON.stringify(same))
    assert.equal(same.identical, true, JSON.stringify(same))
    for (const [label, text] of Object.entries(corpus.after)) {
      writeFileSync(join(after, "x.d.ts"), text)
      const changed = compareDeclarations(ts, snapshot, after)
      assert.equal(changed.comparisonComplete, true, label + ": " + JSON.stringify(changed))
      assert.equal(changed.identical, false, label + ": " + JSON.stringify(changed))
      assert.ok(label === "type" ? changed.typeDifferences.length : changed.docDifferences.length, JSON.stringify(changed))
    }
  })
})
