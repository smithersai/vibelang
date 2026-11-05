import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import { chapter, read } from "./spec-witness.mjs"

// The decision log is not part of the repository, so a public chapter cites the
// accepted VIP amendment that records a rule, not a decided-detail number.
const citations = text => [...text.matchAll(/decided details? [0-9][^)]*/g)].map(m => m[0])
const vip = n => read(`docs/design/vips/${String(n).padStart(4, "0")}-${{ 1: "effect-and-async-functions", 3: "effect-type-shorthand", 4: "throw", 5: "try-runs-effects", 7: "match", 12: "provide", 27: "declaration-output", 28: "generic-data", 33: "platform-stdlib", 34: "compiler-and-tooling", 38: "effect-lint-built-in" }[n]}.md`)
function checkPairs(text, pairs, readVip = vip) {
  for (const [cited, n, authority] of pairs) {
    assert.match(text, cited)
    const accepted = readVip(n)
    assert.match(accepted, /\*\*Status:\*\* accepted/, "VIP-" + n + ": accepted public authority")
    if (typeof authority === "string") assert.ok(accepted.includes(authority), "VIP-" + n + ": " + authority)
    else assert.match(accepted, authority, "VIP-" + n)
  }
}

test("the introduction, Functions and the appendices cite no decided detail", () => {
  for (const name of ["000-intro", "001-functions", "900-appendices"]) assert.deepEqual(citations(chapter(name)), [], name)
})

test("each rule the introduction cites is in the amendment it names", () => {
  const intro = chapter("000-intro")
  assert.match(intro, /including static call and construct signatures \(VIP-7, amended\)/)
  assert.match(vip(7), /\*\*Amended 2026-10-29: a class pattern naming a non-class callable dispatches on its static signatures\.\*\*/)
  assert.match(intro, /`HttpClientError\.isHttpClientError`; VIP-7, amended\)/)
  assert.match(vip(7), /\*\*Amended 2026-10-29: subpath tagged errors\.\*\* The retained tagged-error checks cover every public `effect\/…` module/)
  assert.match(intro, /prints a stable `EK38xx` code \(VIP-38, amended\)/)
  assert.match(vip(38), /\*\*Amended 2026-10-29: codes for the imported rules\.\*\* Each imported `effecttsgo\/\*` rule gets one stable `EK38xx` code/)
})

const functionPairs = [
    [/Result test\]\(002-running\.md#result-tests\) \(VIP-5, amended: not `never`/, 5, "one test for an unrun Effect or Promise"],
    [/with no VibeLang check \(VIP-1, amended\)/, 1, "`new f()` on a `.vibe` function"],
    [/the right operand of `instanceof` \(VIP-1, amended\)/, 1, "every reference to the global `Function`"],
    [/`Function\["prototype"\]` \(VIP-1, amended\)/, 1, "the `Function` member-access exemption covers `.prototype` only"],
    [/close the other ways to reach these globals \(VIP-33 and VIP-1, amended\)/, 33, "`globalThis` and `import()`"],
    [/close the other ways to reach these globals \(VIP-33 and VIP-1, amended\)/, 1, "`Function` through `.constructor`"],
    [/a quick fix that parenthesizes \(VIP-3, amended; `EK0301`\)/, 3, "`!` beside other type operators"],
    [/needs no parentheses \(VIP-3, amended\)/, 3, "function-type returns"],
    [/the same on every build \(VIP-28, amended\)/, 28, "the helper's name"],
    [/Generated matcher declarations follow \[VIP-27's published matcher boundary\]\(\.\.\/vips\/0027-declaration-output\.md#decision\)/, 27, "published declarations add neither"],
    [/the output states the same on every call signature it emits other than an effectful one/, 4, "contracts sit on call signatures"],
    [/A foreign reader treats a declaration without a tag as throwing `unknown`/, 4, /no `@throws` means it throws `unknown`/],
  ]
test("each rule Functions cites is in the amendment it names", () => {
  checkPairs(chapter("001-functions"), functionPairs)
})

const appendixPairs = [
    [/it wins in any code \(VIP-12, amended\)/, 12, "when `provide` is a keyword"],
    [/no AsyncArrowFunction: VIP-5, amended\)/, 5, "the handler is always a function literal"],
    [/\(no generator, async or async generator expression: VIP-5, amended\)/, 5, "the handler is always a function literal"],
    [/syntax error: remove async \(VIP-5, amended\)/, 5, "the handler is always a function literal"],
    [/`\(\) => \(A \| B\)` \(VIP-3, amended\)/, 3, "function-type returns"],
    [/without parentheses \(VIP-3, amended\)/, 3, "`!` beside other type operators"],
    [/so VIP-19's rules are `EK19xx` \(VIP-34, amended\)/, 34, "code numbering"],
    [/the growing `EK38` decimal suffix below \(VIP-34, amended\)/, 34, "imported-lint capacity"],
    [/`"off"` included \(VIP-38, amended\)/, 38, "codes for the imported rules"],
    [/write `when C:` or `when C and \{ x: let x \}:` \(VIP-7, amended\)/, 7, "an extractor on an ordinary class without its own matcher is `EK0704`"],
    [/An npm signature follows the single external-callable rule/, 4, "an npm signature needs its own annotation"],
  ]
test("each rule the appendices cite is in the amendment it names", () => {
  checkPairs(chapter("900-appendices"), appendixPairs)
})

test("mutations cannot sever a published claim from its accepted VIP authority", () => {
  const groups = [["001-functions", functionPairs], ["900-appendices", appendixPairs]]
  fc.assert(fc.property(fc.integer({ min: 0, max: 1 }), fc.nat(), fc.boolean(), (group, index, changeAuthority) => {
    const [chapterName, pairs] = groups[group]
    const pair = pairs[index % pairs.length], [cited, n, authority] = pair
    const text = chapter(chapterName)
    checkPairs(text, [pair])
    if (changeAuthority) {
      const original = vip(n)
      const changed = typeof authority === "string"
        ? original.replaceAll(authority, "[removed]")
        : original.replace(new RegExp(authority.source, "g"), "[removed]")
      assert.throws(() => checkPairs(text, [pair], () => changed))
    } else {
      const changed = text.replace(new RegExp(cited.source, "g"), "[removed]")
      assert.throws(() => checkPairs(changed, [pair]))
    }
  }), { seed: 1104113, numRuns: 240 })
})
