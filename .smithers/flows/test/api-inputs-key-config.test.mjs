import test from "node:test"
import { copyTree, key, assertSelectedApiInputs, apiInputProbes } from "./api-inputs-fixture.mjs"

test("the actual root API key retains config input mutations", t => {
  const root = copyTree(t)
  assertSelectedApiInputs(root, key(root), apiInputProbes.slice(12, 16))
})
