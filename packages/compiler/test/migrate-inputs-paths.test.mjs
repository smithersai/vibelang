import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

// packages/PACKAGE.ts takes the whole migrate and convert flows through //:migration-sources (migration-inputs.ts).
// A target that also names one of their files by path adds nothing to its cache key, and every lane that adds a
// migrate test edited the same lines: 12 merge-queue rejections on packages/PACKAGE.ts, and duplicate entries
// where two lanes' copies of one line both landed.
const flowPath = /S\.(?:file|glob)\("\/\/\.smithers\/flows\/(?:migrate|convert)\//g

test("packages/PACKAGE.ts names no migrate or convert flow file by path", () => {
  const source = readFileSync(new URL("../../PACKAGE.ts", import.meta.url), "utf8")
  const named = source.split("\n").flatMap((line, i) => line.match(flowPath) ? [`${i + 1}: ${line.trim()}`] : [])
  assert.deepEqual(named, [], "list //:migration-sources (migrationSources) instead")
})

test("the pattern finds a flow file named by path", () => {
  assert.equal('S.file("//.smithers/flows/migrate/test/a.test.mjs"), S.glob("//.smithers/flows/convert/**")'.match(flowPath).length, 2)
  assert.equal('S.file("//scripts/testing/property.mjs"), migrationSources'.match(flowPath), null)
})
