import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { defaultStyle, formatSource } from "../format.mjs"

for (const ext of ["ts", "mts", "cts", "tsx"]) {
  test(`formatSource reads the directive in an unsaved .${ext} buffer`, () => {
    const source = "// @vibe\nexport   effect function f( ) { return 1 }\n"
    const expected = "// @vibe\nexport effect function f() {\n  return 1\n}\n"
    assert.equal(formatSource(source, "unsaved." + ext, defaultStyle), expected)
    assert.equal(formatSource(expected, "unsaved." + ext, defaultStyle), expected)
  })
}
test("marked TSX buffers preserve JSX", () => {
  const source = "// @vibe\nexport   effect function view( ) { return <div title='ok'/> }\n"
  const result = formatSource(source, "unsaved.tsx", defaultStyle)
  assert.equal(result, '// @vibe\nexport effect function view() {\n  return <div title="ok" />\n}\n')
})
test("directive buffers format like their native-extension twins", () => {
  fc.assert(fc.property(
    fc.constantFrom("ts", "mts", "cts", "tsx"),
    fc.constantFrom("// @vibe\n", "\uFEFF// @vibe\r\n", "#!/usr/bin/env node\n// @vibe\n"),
    fc.integer({ min: -100, max: 100 }),
    fc.constantFrom("effect function f( ) {return VALUE}", "error Empty\nexport effect function f( ) { throw new Empty() }", "export const value = effect { return VALUE }"),
    (ext, header, value, body) => {
      const source = header + body.replaceAll("VALUE", String(value)) + "\n"
      const path = "unsaved." + ext
      const twin = ext === "tsx" ? "unsaved.vibex" : "unsaved.vibe"
      const expected = formatSource(source, twin, defaultStyle)
      assert.equal(formatSource(source, path, defaultStyle), expected)
      assert.equal(formatSource(expected, path, defaultStyle), expected)
    }
  ), { numRuns: 20, seed: 42 })
})
test("unmarked buffers still use the stock TypeScript parser", () => {
  assert.throws(() => formatSource("export effect function f() {}\n", "plain.ts", defaultStyle), /effect|Expected/)
  assert.equal(formatSource("export   const n: number = 1\n", "plain.ts", defaultStyle), "export const n: number = 1\n")
})
