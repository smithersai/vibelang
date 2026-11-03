import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { checkClosedCatchDiagnostics, closedForms, loadClosedCatchSources, paths } from "./spec-catch-diagnostics.mjs"

const root = process.env.SPEC_CATCH_ROOT ?? fileURLToPath(new URL("../../", import.meta.url))
const sources = loadClosedCatchSources(root)
const rule = "member access or call after any closed handler (" + closedForms.join(", ") +
  "); parenthesize the whole catch expression"
const good = new Map(paths.map(path => [path, path.includes("/vips/")
  ? "**remaining `catch` grammar code** " + rule + " `EK0512`."
  : "| `EK0512` | " + rule + " |"]))

test("r26 ASTRA-1: the grammar has all three closed-handler families", () => {
  const grammar = sources.get(paths[2])
  assert.match(grammar, /ClosedCatchExpression = CatchHead "catch" NonArrowHandler\s*\| CatchHead "catch" BlockArrowHandler/)
  assert.match(grammar, /NonArrowHandler = FunctionExpression \| EffectFunction[^\n]*\n\s*\| "\(" CatchHandler "\)"/)
  assert.match(grammar, /BlockArrowHandler = ArrowFunction \| EffectArrow/)
})
test("r26 ASTRA-1: current diagnostic publications cover all closed handlers", () => {
  assert.deepEqual(checkClosedCatchDiagnostics(sources), [])
})
test("historical function-only row loses two forms and repair scope", () => {
  const broken = new Map(good)
  broken.set(paths[2], "| `EK0512` | a member access or call after a function-expression handler; parenthesize |")
  assert.deepEqual(checkClosedCatchDiagnostics(broken).map(f => f.message), [
    "EK0512 omits parenthesized handler",
    "EK0512 omits block-bodied arrow handler",
    "EK0512 must repair the whole catch expression",
  ])
})
test("an example outside the diagnostic rule cannot hide a missing trigger", () => {
  const broken = new Map(good)
  broken.set(paths[1], "| `EK0512` | function-expression handler |\n" + rule)
  assert.equal(checkClosedCatchDiagnostics(broken).length, 3)
})
test("missing rules and non-EK0512 rows are rejected with source locations", () => {
  const broken = new Map(good)
  broken.set(paths[2], good.get(paths[2]).replace("EK0512", "EK0509"))
  assert.deepEqual(checkClosedCatchDiagnostics(broken), [
    { path: paths[2], line: 1, message: "missing EK0512 diagnostic rule" },
  ])
})
test("fast-check: dropping any handler family or whole-expression repair is detected at each surface", () => {
  fc.assert(fc.property(
    fc.constantFrom(...paths),
    fc.subarray([...closedForms, "parenthesize the whole catch expression"], { minLength: 1 }),
    fc.constantFrom(" ", "  ", "\t"),
    (path, removed, whitespace) => {
      const mutated = new Map(good)
      let text = good.get(path)
      for (const phrase of removed) text = text.replace(phrase, "omitted")
      mutated.set(path, text.replaceAll(" ", whitespace))
      const findings = checkClosedCatchDiagnostics(mutated)
      assert.equal(findings.length, removed.length)
      assert.ok(findings.every(f => f.path === path && f.line === 1))
    },
  ), { seed: 2601, numRuns: 180 })
})
test("fast-check: equivalent spacing and hyphenation preserve the diagnostic contract", () => {
  fc.assert(fc.property(fc.constantFrom(" ", "  ", "\t"), fc.boolean(), (space, hyphens) => {
    const variant = new Map([...good].map(([path, text]) =>
      [path, (hyphens ? text : text.replaceAll("-", " ")).replaceAll(" ", space)]))
    assert.deepEqual(checkClosedCatchDiagnostics(variant), [])
  }), { seed: 2602, numRuns: 60 })
})
