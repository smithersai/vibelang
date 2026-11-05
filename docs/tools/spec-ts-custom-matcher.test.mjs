import assert from "node:assert/strict"
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTypeScript } from "../../scripts/api-identity.mjs"
import { assertReferenceTypes } from "../../typescript/vibelang/test/cov-ch004-twin.mjs"
import { chapter } from "./spec-witness.mjs"

// Stock TypeScript libraries lack Symbol.customMatcher. Complete counterparts
// use a Symbol.for constant unless they explicitly declare the runtime types.
test("complete ts blocks key custom matchers by a Symbol.for constant", () => {
  const problems = []
  for (const file of readdirSync(new URL("../design/src/", import.meta.url)).filter((f) => f.endsWith(".md"))) {
    for (const m of chapter(file.replace(/\.md$/, "")).matchAll(/```(ts(?: effect)?)\n([\s\S]*?)```/g)) {
      const body = m[2]
      if (/^\/\/ (fragment|types:|compiler-gap)/m.test(body)) continue
      if (/\bSymbol\.customMatcher\b/.test(body.replace(/^\s*\/\/.*$/gm, "").replace(/"[^"\n]*"/g, "\"\""))) {
        problems.push(`${file}: ${body.split("\n").find((l) => l.includes("Symbol.customMatcher")).trim()}`)
      }
    }
  }
  assert.deepEqual(problems, [])
})


// VIP-27 keeps generated matcher implementations out of published types.
test("CLI guide follows the published matcher declaration boundary", () => {
  const vip = readFileSync(new URL("../design/vips/0027-declaration-output.md", import.meta.url), "utf8")
  assert.ok(vip.includes("published declarations add neither"))
  assert.ok(vip.includes("Generated matchers remain in JavaScript."))
  const guide = readFileSync(new URL("../user/src/setup/vibelang-cli.md", import.meta.url), "utf8")
  assert.ok(guide.includes("generated matcher members and runtime reference directives are not added"), "the user guide must retain the TypeScript declaration surface")
  assert.ok(guide.includes("Generated matchers remain in JavaScript"))
})


// The published class must match stock TypeScript, including symbol members.
test("generated class matcher metadata cannot change the native class API", () => {
  const ts = loadTypeScript()
  fc.assert(fc.property(
    fc.constantFrom("NotFound", "InvalidInput", "Timeout"),
    fc.constantFrom("string", "number", "boolean"),
    (name, payload) => {
      const root = mkdtempSync(join(tmpdir(), "published-matcher-"))
      try {
        const native = "declare const customMatcher: unique symbol;\nexport declare class " + name +
          " { readonly _tag: " + JSON.stringify(name) + "; readonly value: " + payload + "; }\n"
        for (const dir of ["typescript/out", "out"]) mkdirSync(join(root, dir), { recursive: true })
        writeFileSync(join(root, "typescript/out/main.d.ts"), native)
        const compare = text => {
          writeFileSync(join(root, "out/main.d.ts"), text)
          return assertReferenceTypes(ts, root)
        }
        compare(native)
        assert.throws(() => compare(native.replace("; }", "; static [customMatcher](value: unknown): boolean; }")), /differences/)
        assert.throws(() => compare(native.replace(JSON.stringify(name), '"Changed"')), /differences/)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { seed: 270027, numRuns: 12 })
})
