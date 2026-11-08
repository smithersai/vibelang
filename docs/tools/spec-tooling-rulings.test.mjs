import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// A missing vibelang-runtime is one error naming the package, as chapter 7
// and VIP-34 state.
test("chapter 7 states the missing-runtime error", () => {
  const tooling = chapter("007-tooling")
  const diagnostics = tooling.split("\n").find((line) => line.startsWith("When emitted JavaScript needs"))
  assert.match(diagnostics, /needs `vibelang-runtime` and the package cannot resolve, report one `TS2307` naming that package/)
  assert.match(diagnostics, /never unresolved names for its generated helpers/)
  const vip = read("docs/design/vips/0034-compiler-and-tooling.md")
  assert.match(vip, /\*\*Amended 2026-10-31: a missing runtime is one error\.\*\*/)
})
