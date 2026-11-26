// Issue #613: Design history consistency, live Appendix B registry checks, and
// accurate VIP/legacy citations in compiler, runtime and prelude sources.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))
const read = (rel) => readFileSync(join(root, rel), "utf8")

test("history README does not claim compiler tests check the archived Chapter 28 registry", () => {
  const readme = read("docs/design/history/README.md")
  assert.doesNotMatch(readme, /which its tests check/i)
  assert.match(readme, /Appendix B/)

  const dir = join(root, "typescript/tsc/internal/vibelang")
  const readers = readdirSync(dir)
    .filter((name) => name.endsWith("_test.go"))
    .filter((name) => read(`typescript/tsc/internal/vibelang/${name}`).includes("428-part4-ch28-tooling.md"))
  assert.deepEqual(readers, [], "Go compiler tests must validate the live Appendix B registry, not archived Chapter 28")
})

test("archived design history carries non-normative banners and VIP reversal index", () => {
  const decisions = read("docs/design/history/DECISIONS.md")
  assert.match(decisions, /LATER-DECISIONS\.md/)
  assert.doesNotMatch(decisions, /A decision that a later one replaces says so in its first line/)

  const ch9 = read("docs/design/history/src/109-part1-ch09-handlers.md")
  assert.match(ch9, /Historical, not normative/)
})

test("compiler, runtime and prelude sources cite current VIPs or mark legacy history decisions", () => {
  const forbidden = [
    ["typescript/tsc/internal/vibelang/lsrules.go", /VIP-4, D282\)/],
    ["typescript/tsc/internal/vibelang/trust.go", /declared trust level \(design D5,/],
    ["typescript/tsc/internal/vibelang/neverstored.go", /A\n\/\/ call runs where it stands \(D147\)/],
    ["typescript/tsc/internal/vibelang/services.go", /Services and control operations \(design D1, D2/],
    ["typescript/tsc/internal/vibelang/effectroot.go", /pins \(D1\)/],
    ["typescript/tsc/internal/vibelang/effectsubpath.go", /pins \(D1\)/],
    ["typescript/tsc/internal/vibelang/schemas.go", /not a field \(D247\)/],
    ["typescript/tsc/internal/vibelang/service_key_calls.go", /EK9214 \(Chapter 4, D415\)/],
    ["typescript/tsc/internal/vibelang/entry.go", /no platform\n\/\/ \(D135\)/],
    ["typescript/tsc/internal/vibelang/handlers.go", /^\/\/ Handlers \(design chapter 9, D16-D18, D50\)\./m],
    ["typescript/tsc/internal/vibelang/handles.go", /^\/\/ Handle statements \(D132\),/m],
    ["typescript/tsc/internal/vibelang/layers_check.go", /^\/\/ Checks of layer declarations \(D129\)\./m],
    ["typescript/tsc/internal/vibelang/prelude.go", /Pattern matching \(D206-D225/],
    ["typescript/tsc/internal/vibelang/match.go", /Pattern matching \(D206-D225\)/],
    ["packages/runtime/README.md", /\| `wire` \| Compose layers.*\| D27 \|/],
    ["packages/runtime/src/main.ts", /\* D135: runs an entry/],
    ["packages/runtime/src/services.ts", /\/\*\* D2: control operations/],
    ["packages/runtime/src/fibers.ts", /\* D167: `await x`/],
    ["packages/runtime/src/fibers.ts", /\* D168: `select`/],
    ["packages/runtime/src/regions.ts", /\* `using x = e` \(D342, D401, D490\)/],
    ["packages/ts-mapper/prelude.d.ts", /"D251: data in a run position/],
    ["packages/compiler/prelude.d.ts", /"D251: data in a run position/],
  ]
  const failures = forbidden
    .filter(([file, pattern]) => pattern.test(read(file)))
    .map(([file, pattern]) => `${file} still matches stale citation ${pattern}`)
  assert.deepEqual(failures, [])
})
