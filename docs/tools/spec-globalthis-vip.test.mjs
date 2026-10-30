import assert from "node:assert/strict"
import test from "node:test"
import { read } from "./spec-witness.mjs"
test("VIP33 preserves platform code ownership and VIP1 Function exemptions", () => {
  const source = read("docs/design/vips/0033-platform-stdlib.md")
  assert.ok(source.includes("A banned platform member is `EK4402`"))
  assert.match(source, /Function` follow \[VIP-1\]/)
  assert.ok(source.includes("right operand of `instanceof`"))
  assert.ok(source.includes("statically named `prototype` access"))
  assert.ok(!source.includes("whose member is not `eval`, `Function` or a banned global"))
  assert.match(read("docs/design/src/005-services.md"), /globalThis\.fetch\(url\)\s+\/\/ EK4402/)
  assert.ok(read("docs/design/src/001-functions.md").includes("x instanceof globalThis.Function"))
})
