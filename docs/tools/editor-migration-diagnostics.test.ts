import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { checkEditorMigrationDiagnostics, editorMigrationDiagnosticProblems } from "./check-diagnostic-docs"

test("current editor guides use the service chapter's retired declaration diagnostic", () => {
  assert.deepEqual(checkEditorMigrationDiagnostics(), [])
})

test("direct and reversed service claims reject the old migration warning", () => {
  for (const text of [
    "EK2120 is a migration warning for a class-only service.",
    "A service class declaration reports EK2120.",
    "A service class declaration\nreports EK2120."
  ]) assert.equal(editorMigrationDiagnosticProblems(text, "guide").length, 1)
})

test("correct service, native class and control advice remain distinct", () => {
  for (const text of [
    "Retired service class declarations report EK0909 as an error.",
    "Service class uses EK0909, while control class retains the editor warning EK2120.",
    "A native abstract class is ordinary TypeScript. EK2120 belongs to control class.",
    "Service class no longer reports EK2120.",
    "EK2120 is not the service class diagnostic.",
    "A service class declaration reports EK21200."
  ]) assert.deepEqual(editorMigrationDiagnosticProblems(text), [])
})

test("fenced old witnesses do not become current prose claims", () => {
  assert.deepEqual(editorMigrationDiagnosticProblems("Example:\n\n~~~text\nservice class reports EK2120\n~~~\n"), [])
})

test("generated service wording, wrapping and printed identities retain the current assignment", () => {
  fc.assert(fc.property(fc.constantFrom("a class-only service", "a service class declaration"),
    fc.constantFrom(" ", "\n", "  "), fc.boolean(), fc.boolean(), (subject, space, current, reversed) => {
      const code = current ? "EK0909" : "EK2120"
      const text = reversed ? code + " is a migration diagnostic for " + subject :
        subject + " reports " + code
      const wrapped = text.replaceAll(" ", space)
      assert.equal(editorMigrationDiagnosticProblems(wrapped).length, current ? 0 : 1)
      assert.deepEqual(editorMigrationDiagnosticProblems("~~~text\n" + wrapped + "\n~~~"), [])
  }), { seed: 9092120, numRuns: 200 })
})
