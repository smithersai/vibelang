// A guide may defer "support for the new forms" to a later compiler only while
// one of its own examples still waits for that compiler, which its fence marks
// with a `// pending:` line. A page whose examples all compile, or that has
// none, describes the compiler, language server and formatter as they are.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"

const FENCE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm

// deferredSupport lists the paragraphs of a page, outside its fenced blocks,
// that promise support for new forms later.
function deferredSupport(markdown) {
  return markdown.replace(FENCE, "").split(/\n[ \t]*\n/)
    .map(paragraph => paragraph.replaceAll("`", "").replace(/\s+/g, " ").trim())
    .filter(paragraph => /\bsupport for [^.!?]*\bnew\b[^.!?]*\b(?:arrives|will arrive)\b/i.test(paragraph))
}

// waits reports whether one of the page's examples is marked as waiting for
// the compiler.
const waits = markdown => [...markdown.matchAll(FENCE)].some(fence => /^\s*\/\/ pending(?:-decision)?:/m.test(fence[0]))

// stale lists the deferrals of a page that has no waiting example.
const stale = markdown => waits(markdown) ? [] : deferredSupport(markdown)

// pages lists every Markdown file under a directory, as paths relative to it.
function pages(directory, prefix = "") {
  return readdirSync(new URL(directory + prefix, import.meta.url), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(directory, prefix + entry.name + "/") : entry.name.endsWith(".md") ? [prefix + entry.name] : [])
}

test("no guide defers support for forms that every one of its examples already compiles", () => {
  // A release note quotes the sentence a past change removed, so it is history.
  const found = pages("../user/src/").filter(page => page !== "setup/release-notes.md").flatMap(page =>
    stale(readFileSync(new URL("../user/src/" + page, import.meta.url), "utf8")).map(paragraph => page + ": " + paragraph))
  assert.deepEqual(found, [])
})

test("the former setup, editor and testing sentences are detected", () => {
  for (const sentence of [
    "Support for the new forms arrives with the compiler's VIP implementation.",
    "Support for the new forms and configuration files arrives with the compiler's VIP implementation.",
    "Hover over an Effect-returning function to see its inferred `Effect<A, E, R>`. Language-server, formatter, and diagnostic support for the new forms arrives with the compiler's VIP implementation.",
  ]) {
    assert.deepEqual(stale("# Guide\n\nThe server reports diagnostics.\n\n" + sentence + "\n\n## Next\n"), [sentence.replaceAll("`", "")])
    assert.deepEqual(stale("# Guide\n\n" + sentence + "\n"), [sentence.replaceAll("`", "")])
  }
})

test("present-tense descriptions and waiting pages are not reported", () => {
  for (const paragraph of [
    "The language server reports diagnostics, hovers and completions for every form.",
    "The formatter supports the new forms.",
    "The earlier compiler did not support the new forms.",
    "If nothing arrives, check the trace URL.",
    "A new request arrives while the batch is pending.",
  ]) assert.deepEqual(stale("# Guide\n\n" + paragraph + "\n"), [])
  const waiting = "# Guide\n\nSupport for the new forms arrives with the compiler's VIP implementation.\n\n```vibe\n// pending: VIP-99\nexport const later = 1\n```\n"
  assert.equal(deferredSupport(waiting).length, 1)
  assert.deepEqual(stale(waiting), [])
})

test("fast-check: a deferral is found in any prose layout, ignored in a fence, and allowed beside a waiting example", () => {
  fc.assert(fc.property(
    fc.constantFrom("forms", "forms and configuration files", "provider forms", "service declarations"),
    fc.constantFrom("the new ", "diagnostics on the new ", "every new "),
    fc.constantFrom("Support", "Language-server, formatter, and diagnostic support", "Editor support"),
    fc.constantFrom("arrives", "will arrive"),
    fc.constantFrom("", "- ", "> ", "1. "),
    fc.constantFrom(" ", "\n"),
    fc.constantFrom("```", "~~~", "````"),
    fc.boolean(),
    (form, qualifier, support, arrival, lead, space, fence, code) => {
      const subject = code ? "`" + form + "`" : form
      const sentence = support + " for " + qualifier + subject + " " + arrival + " with the compiler's VIP implementation."
      const paragraph = lead + sentence.replaceAll(" ", space)
      const page = "# Guide\n\nThe plugin compiles the project.\n\n" + paragraph + "\n\n## Next\n\nRun the tests.\n"
      assert.equal(stale(page).length, 1)
      assert.deepEqual(stale("# Guide\n\n" + fence + "text\n" + paragraph + "\n" + fence + "\n\nRun the tests.\n"), [])
      assert.deepEqual(stale(page + "\n" + fence + "vibe\n// pending: VIP-99\nexport const later = 1\n" + fence + "\n"), [])
      assert.equal(stale(page + "\n" + fence + "vibe\nexport const now = 1\n" + fence + "\n").length, 1)
    }
  ), { seed: 7069, numRuns: 400 })
})
