// Refresh the Go oracle from the pinned, independently installed TypeScript parser:
// node packages/compiler/test/eslint/jsx-golden.mjs
import { writeFileSync } from "node:fs"
import { parse } from "@typescript-eslint/typescript-estree"
import { jsxFixtures } from "./jsx-fixtures.mjs"
import { plain } from "./helpers.mjs"
export function jsxParts(ast) {
  const roots = []
  const walk = value => {
    if (!value || typeof value !== "object") return
    if (value.type === "JSXElement" || value.type === "JSXFragment") { roots.push(value); return }
    for (const [key, child] of Object.entries(value)) if (key !== "tokens" && key !== "comments") {
      if (Array.isArray(child)) child.forEach(walk)
      else walk(child)
    }
  }
  walk(ast)
  return plain({ roots, tokens: ast.tokens, comments: ast.comments })
}
export const reference = code => parse(code, { filePath: "/fixture.tsx", jsx: true, range: true, tokens: true, comment: true })
if (process.argv[1] === new URL(import.meta.url).pathname) {
  writeFileSync(new URL("../../../../typescript/tsc/internal/vibelangestree/testdata/jsx.json", import.meta.url),
    JSON.stringify(Object.entries(jsxFixtures).map(([name, code]) => ({ name, code, expected: JSON.parse(JSON.stringify(jsxParts(reference(code))),
      // Native JSON carries the regex metadata; eslint.mjs restores the
      // RegExp value before the live Node differential comparison.
      (key, value) => value?.type === "Literal" && value.regex ? { ...value, value: null } : value) })), null, 2) + "\n")
}
