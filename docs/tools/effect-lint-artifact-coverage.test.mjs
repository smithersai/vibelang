// docs/design/vips/0038-effect-lint-built-in.md#0aa89a9acfc1154f
// VIP-38: UPSTREAM tag and commit pin determine the complete imported lint mapping.
// docs/design/vips/0038-effect-lint-built-in.md#6344145532d88db9
// VIP-38: generated floatingEffect mapping retains EK3801.
import "./lint-codes.test.mjs"

import assert from "node:assert/strict"
import test from "node:test"
import {generateLintCodes} from "./lint-codes.mjs"
test("the accepted VIP-38 pin and floating ordinal are retained",()=>{
 const {inventory}=generateLintCodes()
 assert.equal(inventory.upstream.tag,"@effect/tsgo@0.57.0")
 assert.ok(inventory.upstream.commit.startsWith("999942fa4146"))
 const floating=inventory.rules.find(r=>r.rule==="floatingEffect")
 assert.equal(floating.code,"EK3801")
 assert.equal(floating.defaultSeverity,"error")
})
