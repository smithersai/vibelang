import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// The decision log is not part of the repository, so a public chapter cites the
// accepted VIP amendment that records a rule, not a decided-detail number.
const citations = text => [...text.matchAll(/decided details? [0-9][^)]*/g)].map(m => m[0])
const vip = n => read(`docs/design/vips/${String(n).padStart(4, "0")}-${{ 1: "effect-and-async-functions", 3: "effect-type-shorthand", 4: "throw", 5: "try-runs-effects", 7: "match", 27: "declaration-output", 28: "generic-data", 33: "platform-stdlib", 38: "effect-lint-built-in" }[n]}.md`)

test("the introduction and Functions cite no decided detail", () => {
  for (const name of ["000-intro", "001-functions"]) assert.deepEqual(citations(chapter(name)), [], name)
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

test("each rule Functions cites is in the amendment it names", () => {
  const functions = chapter("001-functions")
  const pairs = [
    [/Result test\]\(002-running\.md#result-tests\) \(VIP-5, amended: not `never`/, 5, "one test for an unrun Effect or Promise"],
    [/with no VibeLang check \(VIP-1, amended\)/, 1, "`new f()` on a `.vibe` function"],
    [/the right operand of `instanceof` \(VIP-1, amended\)/, 1, "every reference to the global `Function`"],
    [/`Function\["prototype"\]` \(VIP-1, amended\)/, 1, "the `Function` member-access exemption covers `.prototype` only"],
    [/close the other ways to reach these globals \(VIP-33 and VIP-1, amended\)/, 33, "`globalThis` and `import()`"],
    [/close the other ways to reach these globals \(VIP-33 and VIP-1, amended\)/, 1, "`Function` through `.constructor`"],
    [/a quick fix that parenthesizes \(VIP-3, amended; `EK0301`\)/, 3, "`!` beside other type operators"],
    [/needs no parentheses \(VIP-3, amended\)/, 3, "function-type returns"],
    [/the same on every build \(VIP-28, amended\)/, 28, "the helper's name"],
    [/works at run time \(VIP-27, amended\)/, 27, "the generated matcher"],
    [/\[Thrown types\]\(003-failures\.md#thrown-types\), VIP-4, amended\)/, 4, "contracts sit on call signatures"],
    [/even with a written function type \(VIP-4, amended\)/, 4, "foreign callables"],
    [/parameter \(VIP-4, amended\)/, 4, "compose thrown-type contracts"],
  ]
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  for (const [cited, n, heading] of pairs) {
    assert.match(functions, cited)
    assert.match(vip(n), new RegExp(`\\*\\*Amended 2026-10-\\d\\d: ${escape(heading)}`), `VIP-${n}: ${heading}`)
  }
})
