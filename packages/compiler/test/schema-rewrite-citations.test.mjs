import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const cases = new URL("../../../typescript/vibelang/cases/", import.meta.url)
const trailingTrivia = (name) => {
  const lines = readFileSync(new URL(`${name}/main.vibe`, cases), "utf8").split("\n")
  const lastCode = lines.findLastIndex((line) => line.trim() && !line.trimStart().startsWith("//"))
  return lines.slice(lastCode + 1).join("\n")
}

test("schema rewrite fixtures preserve trailing coverage metadata byte for byte", () => {
  assert.equal(trailingTrivia("tsforms-schemas"), trailingTrivia("tsforms-schemas-fixed"))
})

for (const name of ["tsforms-schemas", "tsforms-schemas-fixed"]) {
  test(`${name} retains both diagnostic coverage citations once`, () => {
    const lines = trailingTrivia(name).split("\n")
    for (const code of ["EK2113", "EK4821"]) {
      assert.equal(lines.filter((line) => line.startsWith("// Chapter 900:") && line.includes(`${code} diagnostic`)).length, 1)
    }
  })
}
