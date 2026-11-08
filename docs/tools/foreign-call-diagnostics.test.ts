import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { checkForeignCallDiagnostics, foreignCallDiagnosticProblems } from "./check-diagnostic-docs"

// rule-evidence: docs/design/src/003-failures.md#plain-code-never-throws | in effect code the same call has thrown type `unknown` and needs its wrapper (`EK0403`).
test("foreign-call guidance uses the failures chapter's current diagnostic", () => {
  assert.deepEqual(checkForeignCallDiagnostics(), [])
})

test("foreign call advice catches the stale migration identity and preserves its location", () => {
  const text = "# Boundary\n\nEffect code that calls a plain function of a `.ts` file goes through `Effect.try` (EK4401)."
  assert.match(foreignCallDiagnosticProblems(text, "rules.md")[0], /^rules\.md:3:.*EK0403/)
})

test("plain calls, listed classes, explicit corrections and old fenced witnesses stay distinct", () => {
  for (const text of [
    "A plain function may call an unannotated .ts function.",
    "A foreign call in effect code reports EK0403.",
    "EK4401 names a listed exception class that no imported module exports.",
    "A foreign call in effect code no longer reports EK4401.",
    "EK4401 is not the foreign call diagnostic in effect code.",
    "A foreign call in effect code reports EK44010.",
    "~~~text\nA foreign call in effect code reports EK4401.\n~~~",
    "```text\nA foreign call in effect code reports EK4401.\n```"
  ]) assert.deepEqual(foreignCallDiagnosticProblems(text), [])
})

test("property: identity, prose order, wrapping and fences retain the foreign call rule", () => {
  fc.assert(fc.property(fc.constantFrom("foreign", "package", ".ts"),
    fc.constantFrom(" ", "\n", "  "), fc.boolean(), fc.boolean(), fc.boolean(),
    (origin, space, current, reversed, ticks) => {
      const code = (ticks ? "`" : "") + (current ? "EK0403" : "EK4401") + (ticks ? "`" : "")
      const subject = "an unwrapped " + origin + " call in effect code"
      const prose = (reversed ? code + " reports " + subject : subject + " reports " + code).replaceAll(" ", space)
      assert.equal(foreignCallDiagnosticProblems(prose).length, current ? 0 : 1)
      assert.deepEqual(foreignCallDiagnosticProblems("~~~text\n" + prose + "\n~~~"), [])
  }), { seed: 4034401, numRuns: 240 })
})


test("release history retains old identities while the current section is checked", () => {
  const old = "A foreign call in effect code reports EK4401."
  const current = "A foreign call in effect code reports EK0403."
  const notes = "# Release notes\n\n## 0.2.0\n\n" + current + "\n\n## 0.1.0\n\n" + old
  assert.deepEqual(foreignCallDiagnosticProblems(notes, "setup/release-notes.md"), [])
  assert.equal(foreignCallDiagnosticProblems(notes.replace(current, old), "release-notes.md").length, 1)
})

test("independent table rows and bullets cannot lend each other diagnostic identities", () => {
  for (const prefix of ["| ", "- "]) {
    const lines = [
      prefix + "Effect code may call a .ts function through a bridge.",
      prefix + "EK4401 names an unexported listed exception class."
    ]
    assert.deepEqual(foreignCallDiagnosticProblems(lines.join("\n")), [])
    const wrong = prefix + "A foreign call in effect code reports EK4401."
    assert.equal(foreignCallDiagnosticProblems(lines.concat(wrong).join("\n")).length, 1)
    assert.equal(foreignCallDiagnosticProblems(lines[0] + "\n" + wrong + "\n" + prefix + "EK0403 is current.").length, 1)
  }
})
