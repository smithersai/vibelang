import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { markdownPages } from "./check-snippets"

// The first release ships no VibeLang quick fixes or codemods (docs/design/src/007-tooling.md,
// "Explicit source changes"); TypeScript's built-in code fixes and ESLint's --fix are other
// tools. The user docs therefore describe a VibeLang source change as a step the reader takes,
// never as a repair the CLI or editor writes or offers. The release notes record past releases.
const root = new URL("../user/src/", import.meta.url).pathname
const toolRepair = [
  /\b(?:EK\d{4}`?(?:'s)?|class|producer|modifier|foreign type-predicate|preserving) repairs?\b/i,
  /\bthe repair (?:writes|keeps|adds|preserves|captures|remains)\b|\bby the repair\b/i,
  /\bis offered\b|\boffers? no (?:modifier )?edit\b|\bclass action\b/i,
  /\bmanual change (?:writes|keeps)\b/i,
  /\bthe fix keeps\b/i,
]

export function automaticRepairClaims(text: string): string[] {
  return text.split("\n").flatMap((line, i) => toolRepair.some(pattern => pattern.test(line)) ? [`${i + 1}: ${line.trim().slice(0, 120)}`] : [])
}

test("no user page describes a VibeLang repair the CLI or editor applies", () => {
  const problems = markdownPages(root).filter(page => !page.endsWith("setup/release-notes.md"))
    .flatMap(page => automaticRepairClaims(readFileSync(page, "utf8")).map(problem => page.slice(root.length) + ":" + problem))
  expect(problems).toEqual([])
})

test("the check names tool repairs and leaves manual steps and other tools alone", () => {
  for (const claim of [
    "Modifier repairs keep comments after `async`.",
    "Qualified references remain eligible for a preserving repair.",
    "removing `async` is offered only when the handler uses no `await`.",
    "the `EK4802` repair writes `expect(try awaited())`.",
    "EK2104's manual change writes `try e` for `yield* e`.",
    "The repair preserves argument evaluation order.",
    "a binding left unread by the repair is removed.",
  ]) expect(automaticRepairClaims(claim).length, claim).toBe(1)
  for (const manual of [
    "Remove `async` yourself when the handler uses no `await`.",
    "Run `eslint --fix` to apply ESLint's own fixes.",
    "TypeScript's built-in code fixes remain available.",
    "Write `try e` for `yield* e`.",
    "Each entry gives the condition and the repair.",
    "It draws `EK4835` with a manual change for catch-and-match recovery.",
  ]) expect(automaticRepairClaims(manual), manual).toEqual([])
})
