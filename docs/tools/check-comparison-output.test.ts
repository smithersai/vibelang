import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { checkComparisonOutput, checkSourceOutput, comparisonClaims } from "./check-comparison-output"

test("complete comparisons print the output their prose promises", () => {
  const text = readFileSync(new URL("../user/src/001-onboarding.md", import.meta.url), "utf8")
  expect(comparisonClaims(text)).toHaveLength(1)
  expect(checkComparisonOutput(text)).toEqual([])
})

test("constructing cold programs cannot satisfy an output assertion", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 9999 }), fc.boolean(), (value, named) => {
    const program = 'import { Console, Effect } from "effect"\n' +
      (named ? 'const main = () => Effect.gen(function* () { yield* Console.log("' + value + '") })\nconst ready = main()' :
        'const ready = Console.log("' + value + '")')
    expect(checkSourceOutput(program, String(value))).toContain("stdout mismatch")
    expect(checkSourceOutput(program + "\nawait Effect.runPromise(ready)", String(value))).toBeUndefined()
  }), { numRuns: 8, seed: 2601104 })
}, 60000)

test("fragments do not substantiate complete output claims", () => {
  const fence = String.fromCharCode(96).repeat(3)
  const text = fence + "ts effect\n// fragment\nconst main = external\n" + fence + "\nBoth programs print `ok`."
  expect(() => comparisonClaims(text)).toThrow("complete ts effect")
})
