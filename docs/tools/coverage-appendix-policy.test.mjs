import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { test } from "node:test"
const appendix = readFileSync(new URL("../design/src/900-appendices.md", import.meta.url), "utf8")
// docs/design/src/900-appendices.md#49fddf4aa0c3db7a — Chapter 900: kept-code catalog exceptions.
test("the catalog records kept-code and migration exceptions beside the growing EK38 namespace", () => {
  const intro = appendix.split("## Appendix B. Diagnostics")[1].split("| Code |")[0]
  assert.match(intro, /code assigned before that scheme is kept/)
  assert.match(intro, /EK38/)
  assert.match(appendix, /EK4853[\s\S]*EK4854[\s\S]*EK4855/)
})
// docs/design/src/900-appendices.md#3483f4251f03c3a2 — Chapter 900: Option.match CI consequences.
test("Option.match promotion has a user-visible release note", () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  assert.match(notes, /Option\.match[\s\S]{0,900}(?:error|CI|non.zero)/i)
})
// The policy is scoped to Foldkit's recorded identities, which are not shipped
// with this repository. These TODOs retain the required witnesses and oracle;
// they must not turn an arbitrary failure in a triggerClick file into a pass.
// docs/design/src/900-appendices.md#8e896811df0c5ef7 — Chapter 900: Foldkit recorded-identity policy witness.
test.todo("Chapter 900: a complete Foldkit run with only the three identified same-task opening assertions is a qualified PASS")
// docs/design/src/900-appendices.md#3946236bc75e411a — Chapter 900: Foldkit recorded-identity policy witness.
test.todo("Chapter 900: another assertion in the same triggerClick file stays red; mixed allowed and unapproved failures stay red")
// docs/design/src/900-appendices.md#beb0e88c50ced80d — Chapter 900: Foldkit recorded-identity policy witness.
test.todo("Chapter 900: Vite prerender timeout, ENOTEMPTY cleanup and unrelated Menu failures stay red")
// docs/design/src/900-appendices.md#291cd4265243c337 — Chapter 900: Foldkit recorded-identity policy witness.
test.todo("Chapter 900: generate exact identities, near names, mixed failures and missing reports; retain raw status without retrying")

// Chapter 900: Appendix D's blanket marker claim is an authoring contract.
// docs/design/src/900-appendices.md#53946a6ef522dadf — Chapter 900: Appendix D marker claim.
test.todo("Chapter 900: every VibeLang spec example retains the required compiler-gap header", () => {
  const root = new URL("../design/src/", import.meta.url)
  const missing = []
  for (const file of readdirSync(root).filter(name => name.endsWith(".md"))) {
    const source = readFileSync(new URL(file, root), "utf8")
    for (const block of source.matchAll(/^ *[`]{3}vibe(?: es)?\s*\n([\s\S]*?)^ *[`]{3}/gm))
      if (!block[1].trimStart().startsWith("// compiler-gap: pending VIP-")) missing.push(file + ": " + block[1].split("\n")[0])
  }
  assert.deepEqual(missing, [], "Appendix D says every VibeLang example starts with a compiler-gap marker")
})
