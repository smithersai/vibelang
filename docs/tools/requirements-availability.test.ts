import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { lexer } from "marked"

// These guides' runnable examples exercise service declarations, defaultValue
// references and provide blocks. Their prose must not defer those same forms.
function deferredSupport(markdown: string): string[] {
  return lexer(markdown).flatMap(token => {
    if (token.type !== "paragraph") return []
    const prose = token.text.replaceAll("`", "").replace(/\s+/g, " ")
    return /\bsupport for [^.!?]*\bnew\b[^.!?]*\b(?:arrives|will arrive)\b/i.test(prose) ? [prose] : []
  })
}

for (const page of ["025-services", "027-layers"]) {
  test(page + " describes its runnable forms as available", () => {
    const text = readFileSync(new URL("../user/src/requirements-management/" + page + ".md", import.meta.url), "utf8")
    assert.deepEqual(deferredSupport(text), [])
  })
}

test("availability checks distinguish current explanations from deferred support", () => {
  for (const prose of [
    "A service compiles to a Context.Service class.",
    "A defaultValue factory supplies the implementation.",
    "A provide block supplies its dependencies.",
    "The earlier compiler did not support the new forms."
  ]) assert.deepEqual(deferredSupport(prose), [])
})

test("future support claims remain detectable across forms and Markdown layouts", () => {
  fc.assert(fc.property(
    fc.constantFrom("forms", "defaultValue form", "provider forms", "service declarations"),
    fc.constantFrom("the new ", "diagnostics on the new "),
    fc.constantFrom("Support", "support"),
    fc.constantFrom("arrives", "will arrive"),
    fc.constantFrom(" ", "\n"),
    fc.boolean(),
    (form, qualifier, support, arrival, space, inlineCode) => {
      const subject = inlineCode ? "`" + form + "`" : form
      const sentence = support + " for " + qualifier + subject + " " + arrival + " with the compiler's VIP implementation."
      const wrapped = sentence.replaceAll(" ", space)
      assert.equal(deferredSupport(wrapped).length, 1)
      for (const fence of ["```", "~~~"]) {
        assert.deepEqual(deferredSupport(fence + "text\n" + wrapped + "\n" + fence), [])
      }
    }
  ), { seed: 703025, numRuns: 200 })
})
