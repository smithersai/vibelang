// Coverage census: VIP-34 imported ordinal capacity; VIP-38 pin, allocation, stability and defaults.
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#23cadda0a179b6c2
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#b26c0ab72b154aca
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#d565e67a60b0f782
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#d6faf3c867f789ef
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#0daf676a07d3c935
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#8b0c1c5a3667a2a3
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#b29c56d7be52230c
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#b4cc87fd14a8294f
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#8525176f19672471
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#fc43143e0c4b5c40
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#68ea86c2cc2000d3
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#a4ea1312c1e4778a
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#dca02d668ed687b3
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#de4022c33b6d6263
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#d08f8b73b37e7b6d
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#898b69313b3613a3
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#e7727055c78c3d31
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#2224eca2d5e56fc9
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#d5b598b121eeacc0
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#a2f7dc2b815ae5b5
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#b2b3e9d66ecc22a8
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#c97c428178b550e5
import assert from "node:assert/strict"
import fc from "fast-check"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { root, artifactPath, lintOutputs, assignCodes, generateLintCodes } from "./lint-codes.mjs"

// docs/design/src/900-appendices.md#c444ca31e28b7089 — Chapter 900: Appendix B lint-codes.json and the table are generated from the UPSTREAM pin.
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
// docs/design/src/900-appendices.md#84411e328a1abab6 — Chapter 900: Appendix B imported lint rules use the growing EK38 suffix.
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
  const inventory = JSON.parse(readFileSync(resolve(root, artifactPath), "utf8"))
  for (const [path] of lintOutputs()) {
    if (!path.endsWith(".md")) continue
    const output = readFileSync(resolve(root, path), "utf8")
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


// VIP-38 initial allocation and stable future additions: mutate names, order,
// duplicates and removals independently of the compiler's registry.
// docs/design/src/900-appendices.md#3d96c66cac7d6eea — Chapter 900: Appendix B EK38xx code never changes once assigned.
test("property: imported lint codes are ASCII ordered initially and never reused", () => {
  const name = fc.array(fc.constantFrom(..."aAzZ09_"), { minLength: 1, maxLength: 10 }).map(chars => chars.join(""))
  fc.assert(fc.property(fc.uniqueArray(name, { minLength: 1, maxLength: 145 }), names => {
    const initial = assignCodes([...names].reverse())
    assert.equal(initial.floatingEffect, "EK3801")
    for (const [index, name] of [...names].sort().entries()) {
      assert.equal(initial[name], "EK38" + String(index + 2).padStart(2, "0"))
    }
    const next = assignCodes(["!new", ...names.filter((_, index) => index % 2 === 0)], initial)
    for (const name of names) assert.equal(next[name], initial[name])
    assert.equal(next["!new"], "EK38" + String(names.length + 2).padStart(2, "0"))
    assert.equal(new Set(Object.values(next)).size, Object.keys(next).length)
  }), { seed: 380034, numRuns: 60 })
})

test("VIP-38 normative pin and three error defaults match the published inventory", () => {
  const { inventory } = generateLintCodes()
  assert.deepEqual(inventory.upstream, {
    repository: "https://github.com/Effect-TS/tsgo",
    tag: "@effect/tsgo@0.57.0",
    commit: "999942fa41462eb46dfcb2d718e7671db8e14156"
  })
  for (const [code, rule] of [["EK3801", "floatingEffect"], ["EK3865", "missingEffectContext"], ["EK3870", "missingReturnYieldStar"]]) {
    const row = inventory.rules.find(row => row.code === code)
    assert.equal(row.rule, rule)
    assert.equal(row.defaultSeverity, "error")
  }
  const update = readFileSync(resolve(root, "typescript/tsc/internal/effecttsgo/sync.sh"), "utf8")
  assert.ok(update.includes("UPSTREAM"), "the upstream sync driver must update its pin")
})

// Appendix B: generated lint tables — spec-rule: docs/design/src/900-appendices.md#9fecd6b034330448
// Appendix B: growing EK38 ordinals — spec-rule: docs/design/src/900-appendices.md#84411e328a1abab6
