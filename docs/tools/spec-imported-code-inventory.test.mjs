// Executable evidence for Chapter 7's imported code inventory rules.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { assignCodes, compare, generateLintCodes, lintOutputs, root } from "./lint-codes.mjs"

const read = path => readFileSync(resolve(root, path), "utf8")
const assignments = JSON.parse(read("docs/tools/lint-code-assignments.json"))
const artifact = JSON.parse(read("docs/design/inventory/lint-codes.json"))
const compilerCodes = new Map([...read("typescript/tsc/internal/core/vibe_lint_codes.go").matchAll(/"(EK38[0-9]+)":\s*"([^"]+)"/g)].map(m => [m[2], m[1]]))
const ordinal = code => Number(code.slice(4))
const tableCodes = page => {
  const table = read(page).match(/<!-- lint-codes:start[^\n]*-->([\s\S]*?)<!-- lint-codes:end -->/)[1]
  return new Map([...table.matchAll(/^\| `(EK38[0-9]+)` \| `effecttsgo\/(\w+)` \|/gm)].map(m => [m[2], m[1]]))
}

// rule-evidence: docs/design/src/007-tooling.md#imported-code-inventory | The generated table below and [`lint-codes.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/lint-codes.json) assign one stable code per rule, even for a rule with several upstream messages.
test("the table, lint-codes.json and the compiler give each rule one code, even a rule with several messages", () => {
  const fromArtifact = new Map(artifact.rules.map(r => [r.rule, r.code]))
  assert.equal(fromArtifact.size, artifact.rules.length, "one entry per rule")
  assert.equal(new Set(fromArtifact.values()).size, fromArtifact.size, "no code names two rules")
  for (const page of ["docs/design/src/007-tooling.md", "docs/design/src/900-appendices.md"])
    assert.deepEqual(tableCodes(page), fromArtifact, page + " table and lint-codes.json disagree")
  for (const [rule, code] of fromArtifact) {
    assert.equal(assignments[rule], code, rule + " assignment")
    assert.equal(compilerCodes.get(rule), code, rule + " compiler code")
  }
  // Each upstream rule declares its message codes; several messages still map to one EK38 code.
  const rulesDir = "typescript/tsc/internal/effecttsgo/internal/rules"
  const several = []
  for (const file of readdirSync(resolve(root, rulesDir)).filter(f => f.endsWith(".go") && !f.endsWith("_test.go"))) {
    for (const m of read(rulesDir + "/" + file).matchAll(/Name:\s*"(\w+)"[\s\S]*?Codes:\s*\[\]int32\{([\s\S]*?)\}/g)) {
      if ((m[2].match(/\.Code\(\)/g) ?? []).length > 1 && fromArtifact.has(m[1])) several.push(m[1])
    }
  }
  assert.ok(several.includes("runEffectInsideEffect") && several.length >= 3, "rules with several messages: " + several)
  for (const rule of several) assert.match(fromArtifact.get(rule), /^EK38[0-9]{2,}$/, rule)
})

// rule-evidence: docs/design/src/007-tooling.md#imported-code-inventory | Keep `EK3801` for `floatingEffect`; the initial allocation sorts all remaining rule names from ordinal 2.
test("floatingEffect keeps EK3801 and the other pinned rules take ordinals from 2 in sorted order", () => {
  assert.equal(assignments.floatingEffect, "EK3801")
  const others = Object.keys(assignments).filter(rule => rule !== "floatingEffect")
  const sorted = [...others].sort(compare)
  assert.deepEqual(sorted.map(rule => ordinal(assignments[rule])), sorted.map((_, i) => i + 2))
  // Reallocating the pinned names from nothing gives the same codes.
  assert.deepEqual(assignCodes(artifact.rules.map(r => r.rule)), assignments)
  assert.deepEqual(assignCodes(["zeta", "alpha", "floatingEffect"]), { floatingEffect: "EK3801", alpha: "EK3802", zeta: "EK3803" })
})

// rule-evidence: docs/design/src/007-tooling.md#imported-code-inventory | Codes have the prefix `EK38` and a decimal ordinal of at least two digits: `EK3899` is followed by `EK38100`.
test("codes are EK38 with a decimal ordinal of at least two digits, so EK3899 is followed by EK38100", () => {
  for (const code of Object.values(assignments)) assert.match(code, /^EK38(0[1-9]|[1-9][0-9]+)$/, code)
  const byOrdinal = new Map(Object.entries(assignments).map(([rule, code]) => [ordinal(code), code]))
  assert.equal(byOrdinal.get(99), "EK3899")
  assert.equal(byOrdinal.get(100), "EK38100")
  const names = Array.from({ length: 101 }, (_, i) => "rule" + String(i).padStart(3, "0"))
  const fresh = assignCodes(names)
  assert.equal(fresh.rule000, "EK3802")
  assert.equal(fresh.rule008, "EK3810")
  assert.equal(fresh.rule097, "EK3899")
  assert.equal(fresh.rule098, "EK38100")
  assert.equal(fresh.rule100, "EK38102")
})

// rule-evidence: docs/design/src/007-tooling.md#imported-code-inventory | Assignments live in `docs/tools/lint-code-assignments.json`.
test("lint-code-assignments.json is the allocation the generator reads and the compiler matches", () => {
  const outputs = lintOutputs()
  assert.equal(outputs.get("docs/tools/lint-code-assignments.json"), read("docs/tools/lint-code-assignments.json"))
  const { assignments: generated } = generateLintCodes()
  assert.deepEqual(generated, assignments)
  assert.deepEqual(new Map(Object.entries(assignments)), compilerCodes)
})

// rule-evidence: docs/design/src/007-tooling.md#imported-code-inventory | A VIP-32 upstream bump runs `sh tsc/internal/effecttsgo/sync.sh <tag>` from `typescript/`, then `node docs/tools/lint-codes.mjs --write` regenerates the inventory and tables.
test("sync.sh takes the release tag from typescript/, and lint-codes.mjs --write regenerates the inventory and both tables", () => {
  const usage = spawnSync("sh", ["tsc/internal/effecttsgo/sync.sh"], { cwd: resolve(root, "typescript"), encoding: "utf8" })
  assert.notEqual(usage.status, 0)
  assert.match(usage.stderr, /usage: sync\.sh <Effect-TS\/tsgo release tag/)
  const copy = mkdtempSync(join(tmpdir(), "lint-codes-write-"))
  try {
    const rulesDir = "typescript/tsc/internal/effecttsgo/internal/rules"
    const files = ["docs/tools/lint-codes.mjs", "docs/tools/lint-code-assignments.json", "typescript/tsc/internal/effecttsgo/UPSTREAM",
      "docs/design/src/007-tooling.md", "docs/design/src/900-appendices.md",
      ...readdirSync(resolve(root, rulesDir)).filter(f => f.endsWith(".go")).map(f => rulesDir + "/" + f)]
    for (const file of files) {
      mkdirSync(dirname(join(copy, file)), { recursive: true })
      cpSync(resolve(root, file), join(copy, file))
    }
    const empty = "<!-- lint-codes:start: generated by docs/tools/lint-codes.mjs; do not edit -->\n<!-- lint-codes:end -->"
    for (const page of ["docs/design/src/007-tooling.md", "docs/design/src/900-appendices.md"]) {
      const path = join(copy, page)
      writeFileSync(path, readFileSync(path, "utf8").replace(/<!-- lint-codes:start[^\n]*-->[\s\S]*?<!-- lint-codes:end -->/, empty))
    }
    const node = args => spawnSync(process.execPath, ["docs/tools/lint-codes.mjs", ...args], { cwd: copy, encoding: "utf8" })
    assert.equal(node([]).status, 1, "the check reports the stale copy")
    const write = node(["--write"])
    assert.equal(write.status, 0, write.stderr)
    for (const file of ["docs/design/inventory/lint-codes.json", "docs/design/src/007-tooling.md", "docs/design/src/900-appendices.md"])
      assert.equal(readFileSync(join(copy, file), "utf8"), read(file), file + " regenerated")
    assert.equal(node([]).status, 0, "the regenerated copy is current")
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
})
