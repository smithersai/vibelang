import assert from "node:assert/strict"
import { test } from "node:test"
import { parse } from "@typescript-eslint/typescript-estree"
import { parseForESLint } from "../../eslint.mjs"
import { firstDifference, plain } from "./helpers.mjs"

const bodies = [
  "type X = F<<T>(x: T) => T>;",
  "const x = f<<T>(x: T) => T>();",
  "const x = new F<<T>(x: T) => T>();",
  "type X = F<<T>(x: T) => F<<U>(y: U) => U>>;",
]
for (const [index, body] of bodies.entries()) {
  test(`pinned reference keeps every nested type opening, form ${index + 1}`, () => {
    const code = "// é😀\r\n" + body + "\nconst shift = 1 << 2;"
    const reference = parse(code, { filePath: "/angle.ts", tokens: true, range: true, loc: true, comment: true })
    const starts = reference.tokens.filter((t) => t.value === "<").map((t) => t.range[0])
    assert.deepEqual(starts, [...body.matchAll(/</g)].map((m) => m.index + "// é😀\r\n".length))
    for (const token of reference.tokens) assert.equal(code.slice(...token.range), token.value)
    const { ast } = parseForESLint(code, { filePath: "/angle.ts" })
    assert.equal(firstDifference(plain({ ...ast, sourceType: undefined }), plain({ ...reference, sourceType: undefined })), undefined)
  })
}
