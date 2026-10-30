import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { root, lintOutputs, assignCodes, generateLintCodes } from "./lint-codes.mjs"

test("the pinned imported lint inventory and both rendered tables are current", () => {
  for (const [path, expected] of lintOutputs()) {
    assert.equal(readFileSync(resolve(root, path), "utf8"), expected, path + " is stale; run node docs/tools/lint-codes.mjs --write")
    if (path.endsWith(".md")) assert.doesNotMatch(expected, /The generated table is not yet published|table goes here with that pin|how ordinals past 99 are spelled/, path + " still has an obsolete lint-table placeholder")
  }
})
test("new alphabetical predecessors append, and removed codes remain reserved", () => {
  const first = assignCodes(["zebra", "middle"])
  assert.deepEqual(first, { floatingEffect: "EK3801", middle: "EK3802", zebra: "EK3803" })
  const next = assignCodes(["aardvark", "zebra"], first)
  assert.deepEqual(next, { floatingEffect: "EK3801", middle: "EK3802", zebra: "EK3803", aardvark: "EK3804" })
  assert.equal(assignCodes(["middle"], next).middle, first.middle)
  assert.throws(() => assignCodes([], { a: "EK3801", b: "EK3801" }), /duplicate/)
})
test("the EK38 namespace accommodates the complete upstream registry", () => {
  const codes = assignCodes(Array.from({ length: 130 }, (_, i) => String(i).padStart(3, "0")))
  assert.equal(codes["098"], "EK38100")
  assert.throws(() => assignCodes([], { floatingEffect: "EK3841" }), /retain EK3801/)
  const { inventory } = generateLintCodes()
  assert.ok(inventory.rules.length >= 130)
  assert.equal(inventory.upstream.tag, "@effect/tsgo@0.57.0")
  assert.equal(inventory.rules.find(r => r.rule === "floatingEffect").defaultSeverity, "error")
  assert.equal(inventory.rules.find(r => r.rule === "floatingEffect").code, "EK3801")
  assert.equal(inventory.rules.find(r => r.rule === "abortControllerInEffect").code, "EK3802")
  assert.equal(inventory.rules.find(r => r.rule === "acquireReleaseDisposable").code, "EK3803")
  assert.equal(new Set(inventory.rules.map(r => r.code)).size, inventory.rules.length)
})

test("both tables expose every inventory code as an Appendix B diagnostic row", () => {
  const { inventory } = generateLintCodes()
  for (const [path, output] of lintOutputs()) {
    if (!path.endsWith(".md")) continue
    const table = output.match(/<!-- lint-codes:start[^\n]*-->[\s\S]*?<!-- lint-codes:end -->/)[0]
    const rows = [...table.matchAll(/^\| `(EK38[0-9]{2,})` \| `effecttsgo\/([^`]+)` \| 38 \| \[Tooling\]\(007-tooling\.md\) \| `(error|warning|suggestion|off)` \|$/gm)]
      .map(([, code, rule, defaultSeverity]) => ({ code, rule, defaultSeverity }))
    assert.deepEqual(rows, inventory.rules.map(({ code, rule, defaultSeverity }) => ({ code, rule, defaultSeverity })), path)
    assert.match(table, /\| Code \| Rule \| VIP \| Chapter \| Default severity \|/)
  }
})

test("documentation generation and checking include the lint inventory and tables", () => {
  const scripts = JSON.parse(readFileSync(resolve(root, ".smithers/package.json"), "utf8")).scripts
  assert.ok(scripts["docs:generate"].includes("lint-codes.mjs --write"))
  assert.ok(scripts["docs:check"].includes("lint-codes.mjs --check"))
})
