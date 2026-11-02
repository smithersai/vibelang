import { describe, expect, it } from "@effect/vitest"
import * as V from "../src/recursion.vibe"
import * as T from "../src/recursion.effect.ts"

for (const [name, m] of [["vibe", V], ["ts", T]] as const) {
  describe(name, () => {
    it("collects the keys and strings of nested data", () => {
      expect(m.collect({ a: "x", b: [1, { c: "y" }] })).toEqual(["a", "x", "b", "0", "1", "c", "y"])
      expect(m.collect("s")).toEqual(["s"])
    })
  })
}
