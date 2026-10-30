import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

test("the reuse inventory covers each historical core rule assigned a different normative meaning", () => {
  const rows = text => new Map([...text.matchAll(/^\| `?(EK\d+)`? \| ([^|]+)\|/gm)].map(m => [m[1], m[2]]))
  const history = rows(read("docs/design/history/src/428-part4-ch28-tooling.md"))
  const appendix = chapter("900-appendices")
  const current = rows(appendix)
  const list = appendix.split("Reused numbers:")[1].split("previously named")[0]
  const reused = new Set([...list.matchAll(/`(EK\d+)`/g)].map(m => m[1]))
  for (const [, from, to] of list.matchAll(/`EK(\d+)` to `EK(\d+)`/g)) {
    for (let n = +from; n <= +to; n++) reused.add("EK" + n)
  }
  const changes = [
    ["EK2001", /expected failure/i, /for try.*outside/i],
    ["EK2002", /requirement.*escapes/i, /return.*for try/i],
    ["EK2003", /plain annotation/i, /labeled.*break.*continue/i],
    ["EK2004", /catch.*try block/i, /operand.*Stream/i],
    ["EK2005", /resumeWith/, /var.*assignment.*for try/i],
    ["EK2102", /recursive Effect function/i, /producer.*return type.*Stream/i],
    ["EK2103", /member.*service.*control/i, /yield\*/],
    ["EK2104", /setup statement.*layer/i, /yield/],
    ["EK3006", /static member/i, /severit/i],
    ["EK3007", /service key called with arguments/i, /unknown.*vibe.*key/i],
    ["EK3201", /No provider.*required service/i, /effect.*version/i]
  ]
  for (const [code, oldRule, newRule] of changes) {
    assert.match(history.get(code), oldRule, code + ": historical meaning")
    assert.match(current.get(code), newRule, code + ": normative meaning")
    assert.ok(reused.has(code), code + ": meaning changed, so it belongs in the reuse list")
  }
})

test("current compiler registry status stays separate from normative code allocation", () => {
  const appendix = chapter("900-appendices")
  const intro = appendix.split("## Appendix B. Diagnostics")[1].split("| Code |")[0]
  assert.doesNotMatch(intro, /current compiler prints/i)
  const compatibility = appendix.split("### Transitional compiler diagnostics\n")[1]?.split(/\n###? /)[0]
  assert.ok(compatibility, "compiler compatibility has its own section")
  assert.match(compatibility, /compatibility diagnostics from the old language/)
  assert.match(compatibility, /registry/)
  assert.match(compatibility, /separately from the normative rules above/)
  assert.match(compatibility, /an interim code does not establish a language rule or reserve a new VIP block/)
})

test("the historical producer-number candidate stays retired in both public accounts", () => {
  const appendix = chapter("900-appendices")
  const retirement = appendix.split("\n").find(line => line.includes("old `EK2101`") && line.includes("retired"))
  assert.ok(retirement, "retirement is published without a current diagnostic row")
  assert.match(retirement, /never be reassigned/)
  assert.match(retirement, /bodyless declaration whose return type was not an Effect/)
  assert.match(retirement, /VIP-9/)
  const normative = appendix.split("### Transitional compiler diagnostics")[0]
  assert.doesNotMatch(normative, /^\| `EK2101` \|/m)
  const producer = read("docs/design/vips/0021-producers.md")
  assert.match(producer, /old `EK2101` is retired and will never be reassigned/)
})
