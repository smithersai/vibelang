import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { extract, classify } from "./check-snippets"

test("the spec introduction distinguishes incomplete fragments from complete checked counterparts", () => {
  const intro = readFileSync(new URL("../design/src/000-intro.md", import.meta.url), "utf8")
  expect(intro).toContain("An Effect TypeScript comparison that needs undeclared helpers is marked `// fragment`")
  expect(intro).toContain("Complete comparisons omit that marker")
  expect(intro).not.toContain("The Effect TypeScript beside it is marked `// fragment`")
  const [fragment, complete] = extract([
    "```ts effect", "// fragment", "const value = missing()", "```",
    "```ts effect", "const value = 7", "```"
  ].join("\n"))
  expect(classify(fragment, []).status).toBe("fragment")
  expect(classify(complete, []).status).toBe("ok")
})
