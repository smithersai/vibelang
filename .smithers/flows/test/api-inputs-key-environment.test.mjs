import test from "node:test"
import { copyTree, key, assertSelectedApiInputs, apiInputProbes } from "./api-inputs-fixture.mjs"

test("the actual root API key retains environment input mutations", t => {
  const root = copyTree(t)
  assertSelectedApiInputs(root, key(root), apiInputProbes.slice(8, 12))
})
