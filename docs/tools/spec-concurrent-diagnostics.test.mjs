import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

const vip = () => read("docs/design/vips/0018-concurrent.md")
const operations = () => [...vip().split("\n")[0].matchAll(/`(try\.[A-Za-z]+)`/g)].map(m => m[1])
const row = (text, code) => text.split("\n").find(line => line.startsWith("| `" + code + "` |"))
const chapterRows = (code) => chapter("002-running").split("\n").filter(line => line.endsWith("| `" + code + "` |"))

function includesFamily(text) {
  assert.ok(text)
  const names = operations()
  assert.equal(names.length, 4)
  for (const name of names) assert.ok(text.includes("`" + name + "`"), "missing operation " + name + " in " + text)
}

test("every concurrent try operation has the same existing outside-effect diagnostic", () => {
  const outside = row(chapter("900-appendices"), "EK0501")
  includesFamily(outside)
  assert.match(outside, /outside effect code.*top level/)
  const rows = chapterRows("EK0501")
  assert.equal(rows.length, 2, "both the common try rules and concurrent-operation rules expose the context check")
  for (const text of rows) includesFamily(text)
})

test("the common operand code covers every accepted concurrent operation", () => {
  includesFamily(row(chapter("900-appendices"), "EK1801"))
  const rows = chapterRows("EK1801")
  assert.equal(rows.length, 1)
  includesFamily(rows[0])
  assert.match(rows[0], /not an array of Effects/)
  assert.match(chapter("002-running"), /array, readonly array or tuple of Effects/)
})

test("the public owning VIP states the existing shared diagnostic rules", () => {
  const amendment = vip().split("\n").find(line => line.includes("EK0501") && line.includes("EK1801"))
  assert.ok(amendment)
  includesFamily(amendment)
  assert.match(amendment, /outside effect code/)
  assert.match(amendment, /array of Effects/)
})

test("the shared placement and operand rules stay directly quotable for the complete family", () => {
  const common = chapterRows("EK0501").find(text => text.includes("`try`"))
  assert.ok(common.includes("`try` outside effect code"))
  assert.ok(row(chapter("900-appendices"), "EK0501").includes("`try` outside effect code"))
  includesFamily(common)
  for (const text of [...chapterRows("EK1801"), row(chapter("900-appendices"), "EK1801")]) {
    assert.ok(text.includes("an operand that is not an array of Effects"))
    includesFamily(text)
  }
})
