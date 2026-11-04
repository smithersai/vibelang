import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { checkFailureClaims, compileFailureWitness } from "./check-failure-contracts"

const text = readFileSync(new URL("../user/src/013-getting-started.md", import.meta.url), "utf8")

test("the first-program compile-error claim distinguishes contracts from inference", () => {
  expect(text).toContain("compile error")
  expect(checkFailureClaims(text)).toEqual([])
})

test("written error channels, not ignoring the return value, decide rejection", () => {
  fc.assert(fc.property(fc.boolean(), fc.integer({ min: 0, max: 999 }), (discard, value) => {
    const prelude = "error EmptyName\neffect function greeting() { throw new EmptyName() }\n"
    const body = discard ? '{ try greeting(); return "' + value + '" }' : "{ return try greeting() }"
    expect(compileFailureWitness(prelude + "effect function caller() " + body).exit).toBe(0)
    expect(compileFailureWitness(prelude + "effect function caller(): string!EmptyName " + body).exit).toBe(0)
    const rejected = compileFailureWitness(prelude + "effect function caller(): string!! " + body)
    expect(rejected.exit).not.toBe(0)
    expect(rejected.diagnostics).toContain("EmptyName")
  }), { numRuns: 8, seed: 261104 })
}, 60000)

test("the original unconditional claim has no rejecting contract witness", () => {
  expect(checkFailureClaims("A caller that forgets the failure gets a compile error.")).toEqual([
    "A caller compile-error claim needs a written no-failure contract witness"
  ])
})
