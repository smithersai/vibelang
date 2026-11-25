import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"

const page = readFileSync(new URL("../user/src/setup/existing-project.md", import.meta.url), "utf8")
function yarnDevelopmentPackages(markdown: string) {
  const packages = new Set<string>()
  for (const [, , body] of markdown.matchAll(/^`{3}(sh|bash)\s*\n([\s\S]*?)^`{3}\s*$/gm)) {
    for (const line of body.split("\n")) {
      const tokens = line.trim().split(/\s+/).map(token => token.replace(/^['"]|['"]$/g, ""))
      if (tokens[0] !== "yarn" || tokens[1] !== "add" || !tokens.some(token => token === "--dev" || token === "-D")) continue
      for (const token of tokens.slice(2)) {
        if (token.startsWith("-")) continue
        packages.add(token.replace(/@[^@]+$/, ""))
      }
    }
  }
  return packages
}
function complete(markdown: string) {
  const packages = yarnDevelopmentPackages(markdown)
  return packages.has("vibelang-vite") && packages.has("vitest") && packages.has("vite")
}
test("the documented Yarn recipe supplies the Vite peer required by its test tools", () => {
  expect(complete(page)).toBe(true)
})
