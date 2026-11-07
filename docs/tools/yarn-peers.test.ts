import { test, expect } from "bun:test"
import fc from "fast-check"
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
test("formatting and quoting install commands retain the peer requirement", () => {
  fc.assert(fc.property(fc.constantFrom(" ", "  ", "\t"), fc.constantFrom("", "'", '"'), (space, quote) => {
    const rewritten = page.replace(/^yarn add .+$/gm, line => line.split(/\s+/).map(token => token.includes("@") && !token.startsWith("-") ? quote + token + quote : token).join(space))
    expect(complete(rewritten)).toBe(true)
  }), { numRuns: 200 })
})
test("prose and unrelated package managers cannot hide an omitted Yarn peer", () => {
  fc.assert(fc.property(fc.constantFrom("npm", "bun", "pnpm"), fc.integer({ min: 1, max: 9999 }), (manager, id) => {
    const broken = page.replace(/^yarn add .+$/gm, line => line.split(/\s+/).filter(token => !/^['"]?vite@/.test(token)).join(" "))
    expect(complete(broken + "\nVite is installed: " + id + "\n\n```sh\n" + manager + " add --dev vite@8\n```\n")).toBe(false)
  }), { numRuns: 200 })
})
