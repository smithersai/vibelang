import assert from "node:assert/strict"
import { test } from "node:test"
import { formatSource } from "../format.mjs"

test("service constructor method signatures retain their interface spelling", () => {
  for (const extension of ["vibe", "vibex"]) {
    for (const member of ["constructor():number", "constructor<T>(x:T):T", '"constructor"():number', "constructor()"]) {
      const path = "service." + extension
      const formatted = formatSource('service S{static readonly key="format/S";' + member + "}\n", path)
      assert.equal(formatSource(formatted, path), formatted)
      assert.match(formatted, /constructor/)
    }
  }
})
