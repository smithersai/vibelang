import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import fc from "fast-check"

const vip = (name) => readFileSync(new URL("../design/vips/" + name, import.meta.url), "utf8")

const effectPin = (decision) => {
  const pin = /the pin is (?:effect|`effect`) (\d+\.\d+\.\d+)(?![\d.])/.exec(decision)?.[1]
  assert.ok(pin, "VIP-32 names no pin")
  return pin
}

test("VIP module and resource references use the accepted Effect pin", () => {
  const decision = vip("0032-effect-version.md")
  assert.ok(decision.includes("During alpha, VibeLang pins exactly one Effect version."))
  const pin = effectPin(decision)
  assert.ok(vip("0014-effect-modules-in-scope.md").includes("149 in effect " + pin))
  assert.ok(vip("0008-using-denied.md").includes("## Effect's scope functions (effect " + pin + ")"))
})

const versionParts = fc.tuple(
  fc.integer({ min: 0, max: 99 }),
  fc.integer({ min: 0, max: 999 }),
  fc.integer({ min: 0, max: 999 }),
)

test("fast-check: code formatting preserves an explicit Effect pin", () => {
  fc.assert(fc.property(versionParts, fc.boolean(), (parts, code) => {
    const version = parts.join(".")
    const spelling = code ? "`effect`" : "effect"
    const decision = "- **Amended 2026-11-03: the pin is " + spelling + " " + version
      + ", and 4.1 is the earliest supported version**"
    assert.equal(effectPin(decision), version)
  }), {
    seed: 32021,
    numRuns: 512,
    examples: [[[4, 1, 1], true], [[4, 1, 1], false], [[10, 20, 30], true]],
  })
})

test("fast-check: absent or malformed pins report the missing decision", () => {
  fc.assert(fc.property(versionParts, fc.constantFrom(
    "missing", "partial", "range", "extra", "open", "close",
  ), (parts, kind) => {
    const version = parts.join(".")
    const text = {
      missing: "No pin is named here.",
      partial: "the pin is `effect` " + parts.slice(0, 2).join("."),
      range: "the pin is effect ^" + version,
      extra: "the pin is effect " + version + ".0",
      open: "the pin is `effect " + version,
      close: "the pin is effect` " + version,
    }[kind]
    assert.throws(() => effectPin(text), {
      name: "AssertionError",
      message: "VIP-32 names no pin",
    })
  }), { seed: 32022, numRuns: 384 })
})
