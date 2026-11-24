import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
const appendix = readFileSync(new URL("../design/src/900-appendices.md", import.meta.url), "utf8")
// One sentence states the exception; three codes in order anywhere in the file do not.
const migrationException = /(?:^|\. )Transitional, migration and removal codes keep the assignments their sources give them, outside their VIPs' blocks[^\n]*`EK4853` to `EK4857` \(VIP-3 and VIP-9, amended\)/m
// One release note states that a direct Option.match call draws EK4839; another
// mention of Option.match near the word "error" does not.
const optionMatchNote = /^- A direct `Option\.match` call reported `EK4839`[^\n]*the tables include direct calls/m
// docs/design/src/900-appendices.md#2df063c529d54663 — Chapter 900: Appendix B kept pre-scheme codes.
test("the catalog records kept-code and migration exceptions beside the growing EK38 namespace", () => {
  const intro = appendix.split("## Appendix B. Diagnostics")[1].split("| Code |")[0]
  assert.match(intro, /code assigned before that scheme is kept/)
  assert.match(intro, /EK38/)
  assert.match(appendix, migrationException)
  for (const code of ["EK4853", "EK4854", "EK4855"]) {
    assert.match(appendix, new RegExp(`^\\| \`${code}\` \\| warning: [^|\\n]*migration`, "m"))
  }
})
test("direct Option.match reporting has a user-visible release note", () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  assert.match(notes, optionMatchNote)
})
test("the policy oracles reject unrelated mentions", () => {
  assert.doesNotMatch("- Fixed a crash on `Option.match` calls.\n- A CI error is reported.", optionMatchNote)
  assert.doesNotMatch("| `EK4853` | a |\n| `EK4854` | b |\n| `EK4855` | c |", migrationException)
})
// The policy is scoped to Foldkit's recorded identities, which are not shipped
// with this repository. These TODOs retain the required witnesses and oracle;
// they must not turn an arbitrary failure in a triggerClick file into a pass.
test.todo("Chapter 900: a complete Foldkit run with only the three identified same-task opening assertions is a qualified PASS")
test.todo("Chapter 900: another assertion in the same triggerClick file stays red; mixed allowed and unapproved failures stay red")
test.todo("Chapter 900: Vite prerender timeout, ENOTEMPTY cleanup and unrelated Menu failures stay red")
test.todo("Chapter 900: generate exact identities, near names, mixed failures and missing reports; retain raw status without retrying")
