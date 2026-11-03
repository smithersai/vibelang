import { expect, test } from "bun:test"
import { extract, classify } from "./check-snippets"

// Chapter 900: trailing code comments never become expected diagnostics.
// docs/design/src/900-appendices.md#d39863e3f1a87660 — Chapter 900: pending-example directive extraction.
test("a trailing EK example needs an explicit expect-error header", () => {
  const fence = String.fromCharCode(96).repeat(3)
  const trailing = extract([fence + "vibe", "// compiler-gap: pending VIP-1", "effect function n(): number { return 1 } // EK0106", fence].join("\n"))[0]
  expect(trailing.expected).toEqual([])
  expect(classify(trailing, []).status).toBe("fail")
  const header = extract([fence + "vibe", "// compiler-gap: pending VIP-1", "// expect-error: EK0106", "effect function n(): number { return 1 } // EK0106", fence].join("\n"))[0]
  expect(header.expected).toEqual(["EK0106"])
  expect(classify(header, []).status).toBe("compiler-gap")
  expect(classify(header, [{ code: "EK0106", message: "return type must be an Effect" }]).status).toBe("fail")
})
// Chapter 900: a complete ts effect comparison is checked after fragment opt-out removal.
// docs/design/src/900-appendices.md#56090ea98d10c6d6 — Chapter 900: pending-example directive extraction.
test("a declared Effect comparison loses only its explicit fragment opt-out", () => {
  const fence = String.fromCharCode(96).repeat(3)
  const source = ['import { Effect } from "effect"', "const program = Effect.succeed(1)"]
  const complete = extract([fence + "ts effect", ...source, fence].join("\n"))[0]
  const fragment = extract([fence + "ts effect", "// fragment", ...source, fence].join("\n"))[0]
  expect(complete.comparison).toBe(true)
  expect(complete.fragment).toBe(false)
  expect(classify(complete, []).status).toBe("ok")
  expect(fragment.comparison).toBe(true)
  expect(fragment.fragment).toBe(true)
})
