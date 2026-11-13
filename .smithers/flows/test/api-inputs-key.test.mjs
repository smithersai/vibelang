import test from "node:test"
import { assert, copyTree, key, put, assertWholeTreeInput, assertSelectedApiInputs, apiInputProbes } from "./api-inputs-fixture.mjs"

test("the actual root API key ignores unrelated files and retains every input family", async t => {
  const root = copyTree(t)
  // Suites aggregate execution but are not cacheable. The comparator sync leaf
  // retains the complete original API input domain; per-file reads are audited separately.
  const before = key(root)
  const neighbours = []
  // Include additions at several depths: exclusion must not depend on one witness.
  for (let i = 0; i < 64; i++) {
    const dir = ["typescript/tsc/internal/vibelangfuzz", "typescript/vibelang/cases", "docs/user/src", "site/src/pages"][i % 4]
    neighbours.push(dir + "/api-input-neighbour-" + i + [".go", ".vibe", ".md", ".mdx"][i % 4])
    put(root, neighbours[i], "// unrelated fixture\n")
  }
  assert.equal(key(root), before, "Go, compiler cases, user prose and generated site output must not invalidate API identity")
  assertWholeTreeInput(root, neighbours)

  assertSelectedApiInputs(root, before, apiInputProbes.slice(0, 4))
  assert.equal(key(root), before, "restoring all selected bytes must restore the original API key")

})
