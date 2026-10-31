import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 3, OPUS-4: head binding initialization runs in the item
// generator, so every rule about a for concurrent item names it.
test("every for concurrent item rule names head binding initialization", () => {
  const appendix = chapter("900-appendices").split("\n")
  for (const code of ["EK1903", "EK1904", "EK2002", "EK2003", "EK2202"]) {
    const row = appendix.find(line => line.startsWith("| `" + code + "` |")) ?? ""
    assert.ok(row.includes("head binding initialization"), code)
  }
  assert.ok(chapter("002-running").includes("inside any `for concurrent` head binding initialization or body: the nested Effect"))
  const vip = read("docs/design/vips/0022-interruption-blocks.md")
  assert.ok(vip.includes("`restore` inside any `for concurrent` head binding initialization or body is a compile error (`EK2202`)"))
  assert.ok(vip.includes("The limit and the iterable run outside the item region"))
})
