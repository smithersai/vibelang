import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity as compareDeclarations } from "../lib/api-identity.mjs"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")

function compare({ changed = false, optional = false, readonly = false, nested = false, alias = "closed" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ambient-structural-alias-"))
  try {
    const shape = value => "{ " + (readonly ? "readonly " : "") + "status" + (optional ? "?" : "") + ': "' + value + '" }'
    for (const side of ["before", "after"]) {
      const dir = join(root, side)
      mkdirSync(dir)
      const state = shape(side === "after" && changed ? "changed" : "ready")
      writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module", exports: { ".": { types: "./router.d.ts" } } }))
      writeFileSync(join(dir, "registry.d.ts"), "export interface Register {}")
      writeFileSync(join(dir, "auth.d.ts"), alias === "class"
        ? 'export declare class State { private brand; status: "ready" }'
        : alias === "reference" ? "type Inner = " + state + "; export type State = Inner;"
        : alias === "generic" ? "export type State<T = unknown> = " + state + ";"
        : "export type State = " + state + ";")
      const type = side === "after" ? 'import("./auth.js").State' : state
      const value = nested ? "{ child: " + type + " }" : type
      writeFileSync(join(dir, "router.d.ts"), 'import type {} from "./registry.js"; export declare const router: { state: ' + value + ' }; declare module "./registry.js" { interface Register { router: typeof router } }')
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("ambient registration keeps an inline structural type when it becomes a named import", () => {
  const result = compare()
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
})

test("property: structural alias expansion preserves optional and readonly fields and rejects changed literals", () => {
  fc.assert(fc.property(fc.record({ changed: fc.boolean(), optional: fc.boolean(), readonly: fc.boolean(), nested: fc.boolean() }), input => {
    const result = compare(input)
    assert.equal(result.identical, !input.changed, JSON.stringify(result))
    if (!input.changed) assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  }), { numRuns: 16 })
})

test("an imported nominal class cannot prove an ambient structural contract identical", () => {
  assert.equal(compare({ alias: "class" }).identical, false)
})

test("aliases with references or type parameters keep the ordinary dependency proof", () => {
  for (const alias of ["reference", "generic"]) {
    const result = compare({ alias })
    assert.equal(result.identical, false)
    assert.equal(result.comparisonComplete, false)
  }
})
