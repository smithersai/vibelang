import { expect, test } from "bun:test"
import { $isError } from "vibelang-runtime"

test("schema: an Error field's refinement accepts Error instances only (VIP-44)", () => {
  expect([new Error("x"), new TypeError("t"), new RangeError("r")].map($isError)).toEqual([true, true, true])
  expect([{ name: "Error", message: "x" }, "x", null, undefined, Object.create(null)].map($isError)).toEqual([false, false, false, false, false])
  expect($isError(Object.create(Error.prototype))).toBe(true)
})
