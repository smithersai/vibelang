import assert from "node:assert/strict"
import { test } from "node:test"
import { formatSource } from "../format.mjs"

test("service constructor properties retain interface syntax when formatted", () => {
  for (const extension of ["vibe", "vibex"]) {
    for (const member of [
      "constructor:string",
      "readonly constructor:string",
      "constructor?:string",
      '"constructor":string',
      "constructor:()=>number",
      "constructor?():number",
      '"constructor"?():number',
    ]) {
      const source = 'service S{static readonly key="format/S";' + member + "}\n"
      const path = "service." + extension
      const formatted = formatSource(source, path)
      assert.equal(formatSource(formatted, path), formatted)
      assert.match(formatted, /constructor/)
    }
  }
})
