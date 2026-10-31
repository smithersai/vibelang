import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { sidecarChanges } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

const member = fc.record({
  name: fc.constantFrom("id", "name", "args", "f"),
  readonly: fc.boolean(),
  optional: fc.boolean(),
  type: fc.constantFrom("string", "number", "Name", "readonly string[]", "(element: Element) => void")
})
const declare = (members, quote, order) => [
  `import type { Element } from ${quote}dom${quote};`,
  "export interface Item<Name extends string> {",
  ...order(members).map((m) => `    ${m.readonly ? "readonly " : ""}${m.name}${m.optional ? "?" : ""}: ${m.type};`),
  "}",
  ""
].join("\n")

// foldkit-11's neighbourhood: a toolchain that changes a member's modifier in
// a migrated module's declaration is reported; one that only prints the same
// declaration differently (quotes, member order) is not.
test("foldkit-11: setup reports exactly the earlier declarations whose members a new toolchain changes", () => {
  const outDir = mkdtempSync(join(tmpdir(), "migrate-earlier-property-"))
  try {
    fc.assert(fc.property(
      fc.uniqueArray(member, { selector: (m) => m.name, minLength: 1, maxLength: 4 }),
      fc.option(fc.tuple(fc.nat(3), fc.constantFrom("readonly", "optional"))),
      fc.boolean(),
      (members, flip, reorder) => {
        const changed = flip && members.length > flip[0] % members.length
        const after = members.map((m, i) => changed && i === flip[0] % members.length ? { ...m, [flip[1]]: !m[flip[1]] } : m)
        writeFileSync(join(outDir, "item.d.ts"), declare(after, '"', (ms) => reorder ? [...ms].reverse() : ms))
        const result = sidecarChanges(ts, { "src/item.d.vibe.ts": declare(members, "'", (ms) => ms) }, outDir)
        assert.deepEqual(result.missing, [])
        assert.deepEqual(result.changed.map((c) => c.file), changed ? ["src/item.d.vibe.ts"] : [])
      }
    ), { seed: 11011, numRuns: 300 })
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
