import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { lexer } from "marked"

test("the Alchemy guide configures its test command before invoking it", () => {
  const page = readFileSync(new URL("../user/src/platform/alchemy.md", import.meta.url), "utf8")
  const example = JSON.parse(readFileSync(new URL("../../examples/alchemy-stack/package.json", import.meta.url), "utf8"))
  let configured: string | undefined
  let invoked = false
  for (const token of lexer(page)) {
    if (token.type !== "code") continue
    if (token.lang === "json") {
      const config = JSON.parse(token.text)
      if (config.scripts?.test) configured = config.scripts.test
    }
    if (token.lang === "sh" && /^bun run test$/m.test(token.text)) {
      invoked = true
      expect(configured).toBe(example.scripts.test)
    }
  }
  expect(invoked).toBe(true)
})
