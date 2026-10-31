import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 3, OPUS-7 (decided detail 247): a VibeLang syntax rule without a
// more specific code uses its owning VIP's code.
const appendix = chapter("900-appendices")
const row = code => appendix.split("\n").find(l => l.startsWith("| `" + code + "` |")) ?? ""

test("Appendix B assigns the five codes to their owning VIPs, in code order", () => {
  for (const [code, vip] of [["EK0109", 1], ["EK0202", 2], ["EK0512", 5], ["EK1505", 15], ["EK1606", 16]]) {
    assert.ok(row(code).includes(` | ${vip} | `), code)
  }
  const codes = [...appendix.matchAll(/^\| `(EK\d{4})` \|/gm)].map(m => m[1])
  for (const [a, b] of [["EK0108", "EK0109"], ["EK0511", "EK0512"], ["EK1504", "EK1505"], ["EK1605", "EK1606"]]) {
    assert.equal(codes.indexOf(b), codes.indexOf(a) + 1, b)
  }
})

test("each rule names its code where the chapter states it", () => {
  const functions = chapter("001-functions")
  assert.ok(functions.includes("effect x: number!! => x // EK0109: parenthesize x"))
  assert.ok(functions.includes("effect <T> x => x       // EK0109: parenthesize parameters"))
  const running = chapter("002-running")
  assert.ok(running.includes("without them it is a syntax error (`EK0512`)"))
  assert.ok(running.includes("so `a catch function () { }.call(o)` is a syntax error (`EK0512`)."))
  assert.ok(appendix.includes("`yield` is `EK2104`, and a `break` or `continue` whose target is outside the block is `EK0202`."))
  const data = chapter("006-data")
  assert.ok(data.includes("`schema S { m(): string }`, `schema S { [k: string]: number }` | `EK1505` |"))
  assert.ok(data.includes("`data D { A(x: number) }`, `data D { A { m(): void } }`; write `A { x: number }` | `EK1606` |"))
})

test("each owning VIP publishes its code", () => {
  for (const [file, code] of [["0001-effect-and-async-functions", "EK0109"], ["0002-effect-blocks-and-do", "EK0202"], ["0005-try-runs-effects", "EK0512"], ["0015-schema-declarations", "EK1505"], ["0016-data-declarations", "EK1606"]]) {
    assert.ok(read(`docs/design/vips/${file}.md`).includes("`" + code + "`"), code)
  }
})
