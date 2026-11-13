import test from "node:test"
import { copyTree, key, assertSelectedApiInputs, apiInputProbes } from "./api-inputs-fixture.mjs"

test("the actual root API key retains source input mutations", t => {
  const root = copyTree(t)
  assertSelectedApiInputs(root, key(root), apiInputProbes.slice(4, 8))
})
