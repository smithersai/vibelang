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

test("the Alchemy guide uses the exact dependency pins and sources tested in the example", () => {
  const page = readFileSync(new URL("../user/src/platform/alchemy.md", import.meta.url), "utf8")
  const example = new URL("../../examples/alchemy-stack/", import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL("package.json", example), "utf8"))
  expect(page).toContain(`vitest@${manifest.devDependencies.vitest}`)
  const snippets = lexer(page).filter(token => token.type === "code" && token.lang === "vibe")
  for (const file of ["api.vibe", "stack.vibe"]) {
    const header = `// fragment\n// ${file}\n`
    const snippet = snippets.find(token => token.text.startsWith(header))
    expect(snippet?.text.slice(header.length).trim()).toBe(readFileSync(new URL("src/" + file, example), "utf8").trim())
  }
})
