import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

test("the experimental namespace documents pure modules without a service requirement", () => {
  const source = readFileSync(new URL("../../packages/runtime/src/experimental/index.ts", import.meta.url), "utf8")
  const description = source.slice(0, source.indexOf("*/")).replace(/\s*\*\s*/g, " ")
  expect(description).toContain("service or pure capability")
  expect(description).toContain("Pure modules need no service key or layer.")
  expect(description).not.toContain("pure Encoding")
})
