import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree } from "../eslint.mjs"

// VIP-34: existing linters work on the source's tokens. Exercise the scanner's
// neighbourhood without requiring the optional ESLint dependency installation.
const forms = [
  (type) => `type X = F<${type}>;`,
  (type) => `const x = f<${type}>();`,
  (type) => `const x = new F<${type}>();`,
  (type) => `type X = F<${type} | F<${type}>>;`,
]
function check(body, extension, prefix) {
  const source = prefix + body
  const code = source + "\nconst shift = a << b; a <<= 1; const less = a < b; const le = a <= b; const text = '<<'; const re = /<</;"
  const ast = parseESTree(code, `/angle.${extension}`)
  const openings = ast.tokens.filter((t) => t.type === "Punctuator" && t.range[0] < source.length && t.value.includes("<"))
  const expected = [...source.matchAll(/</g)].map((m) => [m.index, m.index + 1])
  assert.deepEqual(openings.map((t) => t.range), expected, code)
  assert.ok(openings.every((t) => t.value === "<"), code)
  assert.deepEqual(ast.tokens.filter((t) => t.type === "Punctuator" && t.range[0] >= source.length && t.value.includes("<")).map((t) => t.value), ["<<", "<<=", "<", "<="])
  for (const token of ast.tokens) assert.equal(code.slice(...token.range), token.value)
}
for (const [index, form] of forms.entries()) {
  test(`type angle tokens preserve adjacent openings and shifts, form ${index + 1}`, () => {
    for (const extension of ["ts", "vibe"]) {
      for (const type of ["<T>(x: T) => T", "<T>(x: T) => F<<U>(y: U) => U>"]) check(form(type), extension, "// é😀\r\n")
    }
  })
}
test("type angle tokens: generated generic functions preserve each opening", () => {
  fc.assert(fc.property(
    fc.constantFrom(...forms),
    fc.constantFrom("ts", "vibe"),
    fc.constantFrom("", "// é😀\n", "/* offset */\r\n"),
    fc.constantFrom("", " ", "/* gap */", "\n"),
    fc.constantFrom("T", "U", "Item"),
    fc.boolean(),
    (form, extension, prefix, gap, name, constructor) => {
      const type = `${gap}${constructor ? "new " : ""}<${name}>(x: ${name}) => ${name}`
      check(form(type), extension, prefix)
    }
  ), { numRuns: 80, seed: 3496 })
})
