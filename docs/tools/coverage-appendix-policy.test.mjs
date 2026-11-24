import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
const appendix = readFileSync(new URL("../design/src/900-appendices.md", import.meta.url), "utf8")
// docs/design/src/900-appendices.md#2df063c529d54663 — Chapter 900: Appendix B kept pre-scheme codes.
test("the catalog records kept-code and migration exceptions beside the growing EK38 namespace", () => {
  const intro = appendix.split("## Appendix B. Diagnostics")[1].split("| Code |")[0]
  assert.match(intro, /code assigned before that scheme is kept/)
  assert.match(intro, /EK38/)
  assert.match(appendix, /EK4853[\s\S]*EK4854[\s\S]*EK4855/)
})
test("Option.match promotion has a user-visible release note", () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  assert.match(notes, /Option\.match[\s\S]{0,900}(?:error|CI|non.zero)/i)
})
// The policy is scoped to Foldkit's recorded identities, which are not shipped
// with this repository. These TODOs retain the required witnesses and oracle;
// they must not turn an arbitrary failure in a triggerClick file into a pass.
test.todo("Chapter 900: a complete Foldkit run with only the three identified same-task opening assertions is a qualified PASS")
test.todo("Chapter 900: another assertion in the same triggerClick file stays red; mixed allowed and unapproved failures stay red")
test.todo("Chapter 900: Vite prerender timeout, ENOTEMPTY cleanup and unrelated Menu failures stay red")
test.todo("Chapter 900: generate exact identities, near names, mixed failures and missing reports; retain raw status without retrying")
