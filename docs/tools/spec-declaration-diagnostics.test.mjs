import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("named schema/data rejections have distinct catalog codes and ordinary TypeScript repairs", () => {
  const data = chapter("006-data")
  const catalog = chapter("900-appendices")
  for (const code of ["EK1501", "EK1502", "EK1603"]) {
    assert.ok(data.includes(`${code}`), code)
    assert.equal([...catalog.matchAll(new RegExp("\\| `" + code + "` \\|", "g"))].length, 1, code)
  }
  assert.ok(data.includes("A `schema error` keeps the error-declaration diagnostic `EK1305`"))
  assert.ok(read("docs/design/vips/0015-schema-declarations.md").includes("existing named, nongeneric declaration grammar"))
  assert.ok(read("docs/design/vips/0016-data-declarations.md").includes("direct `export default data D"))
  const schema = run(block(data, "const namedSchemaExit") + `
import assert from "node:assert/strict"
assert.equal(namedSchemaExit._tag, "Success")
assert.equal(namedSchemaExit.value.value, 1)
assert.equal(genericSchemaExit._tag, "Success")
assert.equal(genericSchemaExit.value.value, 2)
`)
  assert.equal(schema.status, 0, schema.stderr || schema.stdout)
  const tagged = run(block(data, "const namedDataExit") + `
import assert from "node:assert/strict"
assert.equal(namedDataExit._tag, "Success")
assert.equal(namedDataExit.value._tag, "A")
`)
  assert.equal(tagged.status, 0, tagged.stderr || tagged.stdout)
})
