import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

// Loop round 1, OPUS-8: a complete `ts effect` block in chapter 4 keyed a
// method by `Symbol.customMatcher`, which TypeScript 5.9's lib lacks (TS2339)
// and which is undefined on Node and Bun, so the method was keyed "undefined".
// A complete TypeScript counterpart names the key with the chapter's
// `Symbol.for("Symbol.customMatcher")` constant unless it declares the
// runtime's types.
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
