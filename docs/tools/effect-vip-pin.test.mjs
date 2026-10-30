import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const vip = (name) => readFileSync(new URL(`../design/vips/${name}`, import.meta.url), "utf8")

test("VIP module and resource references use the accepted Effect pin", () => {
  const decision = vip("0032-effect-version.md")
  const pin = /the pin is effect ([\d.]+)/.exec(decision)[1]
  assert.ok(vip("0014-effect-modules-in-scope.md").includes(`149 in effect ${pin}`))
  assert.ok(vip("0008-using-denied.md").includes(`## Effect's scope functions (effect ${pin})`))
})
