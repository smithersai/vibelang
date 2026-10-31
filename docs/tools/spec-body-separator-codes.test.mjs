import assert from "node:assert/strict"
import test from "node:test"
import { lexer } from "marked"
import { chapter } from "./spec-witness.mjs"

test("a missing member separator in a VibeLang declaration body has the owning VIP's code", () => {
  const appendix = chapter("900-appendices")
  const rows = new Map(lexer(appendix).filter(t => t.type === "table").flatMap(t => t.rows).map(r => [r[0].text, r[1].text]))
  for (const [code, owner] of [
    ["`EK0908`", "two `service` members"],
    ["`EK1306`", "two `error` or `schema error` body members"],
    ["`EK1504`", "two `schema` fields"],
    ["`EK1605`", "two variants of a `data` declaration, or two fields of a variant"],
  ]) {
    const row = rows.get(code) ?? ""
    assert.ok(row.includes(owner) && row.includes("(quick fix: insert `;`)"), code)
  }
  assert.ok(appendix.includes("service S { a: number b: string } EK0908: no separator"))
  assert.ok(appendix.includes("error E { a: number b: string }   EK1306: no separator"))
  assert.ok(!appendix.includes("syntax error: no separator, as in an interface"))
  assert.ok(appendix.includes("These bodies never report TypeScript's `TS1005` or `TS1442` for it"))
  assert.ok(chapter("005-services").includes("on one line is a syntax error, `EK0908`."))
  const data = chapter("006-data")
  assert.ok(data.includes("`{ a: string b: number }` is a syntax error, `EK1504`."))
  assert.ok(data.includes("`data D { A B }` or `A { x: number y: string }`, is `EK1605`."))
  const tables = lexer(data).filter(t => t.type === "table").flatMap(t => t.rows.map(r => r.map(c => c.text).join(" | ")))
  assert.ok(tables.some(r => r.endsWith("`EK1504`")) && tables.some(r => r.endsWith("`EK1605`")))
})
