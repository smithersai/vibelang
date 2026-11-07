import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { cheatSheetPairs, count, measurePairs } from "./token-counts"

const page = new URL("../user/src/vibelang-features/117-token-counts.md", import.meta.url)
const cheat = new URL("../user/src/vibelang-features/115-cheat-sheet.md", import.meta.url)

test("the token method describes imports and shared declarations in the measured corpus", () => {
  const pairs = cheatSheetPairs(readFileSync(cheat, "utf8"))
  expect(pairs.some(pair => pair.effect.some(code => /from "effect"/.test(code)))).toBe(true)
  const method = readFileSync(page, "utf8").split("<!-- token-counts: generated")[0]
  expect(method).not.toContain("none imports `effect`")
  expect(method).not.toContain("each VibeLang snippet is a complete, runnable function")
  expect(method).toMatch(/shared declarations/i)
})

test("pair measurements include written imports on either side", () => {
  const imports = 'import { Effect } from "effect"'
  const statement = "const answer = Effect.succeed(42)"
  const fence = (info: string, code: string) => ["```" + info, code, "```"].join("\n")
  for (const side of ["effect", "vibe"]) {
    const effect = (side === "effect" ? imports + "\n" : "") + statement
    const vibe = (side === "vibe" ? imports + "\n" : "") + statement
    const measured = measurePairs(["**Value**", fence("ts effect", effect), fence("vibe", vibe)].join("\n"))
    expect(measured.effect).toBe(count(effect))
    expect(measured.vibe).toBe(count(vibe))
  }
})
