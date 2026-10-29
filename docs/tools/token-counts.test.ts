import { expect, test } from "bun:test"
import { cheatSheetPairs, count, program } from "./token-counts"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const fence = (info: string, code: string) => ["```" + info, code, "```"].join("\n")

test("pairs each cheat-sheet entry's Effect blocks with its VibeLang blocks", () => {
  const markdown = [
    "# Cheat sheet",
    "",
    fence("vibe es", "error Shared"),
    "",
    "## Declarations",
    "",
    "**Errors** (D126).",
    "",
    fence("ts effect", "class Missing extends Data.TaggedError(\"Missing\") {}"),
    "",
    fence("vibe es", "error Missing"),
    "",
    "**Control operations** (D128). Effect has none.",
    "",
    fence("vibe long", "abstract class Review extends Control {}"),
    "",
    fence("vibe es", "control Review {}"),
    "",
    "**Plain TypeScript in hatches** (D148).",
    "",
    "**Built-in exceptions (D101).** More prose.",
    "",
    fence("ts effect", "const id = Effect.sync(() => 1)"),
    "",
    fence("vibe es", "// run: Console.log(hatch())\nfunction hatch() { return sync(() => 1) }\n// Output: 1"),
    "",
    fence("vibe", "// hatch.test.vibe\nit.live(\"runs\") { }")
  ].join("\n")
  expect(cheatSheetPairs(markdown)).toEqual([
    { label: "Errors", effect: ["class Missing extends Data.TaggedError(\"Missing\") {}"], vibe: ["error Missing"] },
    {
      label: "Plain TypeScript in hatches",
      effect: ["const id = Effect.sync(() => 1)"],
      vibe: ["// run: Console.log(hatch())\nfunction hatch() { return sync(() => 1) }\n// Output: 1", "// hatch.test.vibe\nit.live(\"runs\") { }"]
    }
  ])
})

test("a pair counts the program, not the docs checker's lines", () => {
  const code = "// run: Console.log(f())\nfunction f() { return 1 }\n// Output: 1\n// Output:"
  expect(program(code)).toBe("function f() { return 1 }")
  expect(count(program(code))).toBe(count("function f() { return 1 }"))
})

test("counts exact text with the o200k_base encoding", () => {
  expect(count("")).toBe(0)
  expect(count("hello world")).toBe(2)
  expect(count("<|endoftext|>")).toBeGreaterThan(1)
})

test("the homepage size claim matches the measured cheat-sheet pairs and links the method", () => {
  const root = resolve(import.meta.dir, "../..")
  const pairs = cheatSheetPairs(readFileSync(resolve(root, "docs/user/src/vibelang-features/115-cheat-sheet.md"), "utf8"))
  const effect = pairs.reduce((total, pair) => total + pair.effect.reduce((n, code) => n + count(program(code)), 0), 0)
  const vibe = pairs.reduce((total, pair) => total + pair.vibe.reduce((n, code) => n + count(program(code)), 0), 0)
  const saving = (100 * (1 - vibe / effect)).toFixed(1)
  const home = readFileSync(resolve(root, "site/src/pages/index.mdx"), "utf8")
  expect(home.includes(saving + "% fewer tokens")).toBe(true)
  expect(home).toContain(pairs.length + " cheat-sheet pairs")
  expect(home).toContain("](/vibelang-features/117-token-counts)")
  expect(home).not.toContain("about half the size")
})

test("corpus claims count longer pairs, weight combined tokens and ignore directives on both sides", async () => {
  const { measurePairs, measuredClaims } = await import("./token-counts")
  const markdown = [
    "**Shorter**", fence("ts effect", "const answer = 1"), fence("vibe", "1"),
    "**Longer**", fence("ts effect", "1"), fence("vibe", "const answer = 1")
  ].join("\n")
  const measured = measurePairs(markdown)
  expect(measured).toMatchObject({ longer: 1, saving: "0.0" })
  expect(measurePairs(markdown.replace("const answer = 1", "// fragment\nconst answer = 1"))).toEqual(measured)
  expect(measurePairs(markdown.replace(fence("vibe", "1"), fence("vibe", "// pending: VIP-1, VIP-5\n1")))).toEqual(measured)
  const claims = measuredClaims()
  expect(readFileSync(resolve(import.meta.dir, "../../README.md"), "utf8")).toContain(claims["README.md"])
})
