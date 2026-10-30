import assert from "node:assert/strict"
import test from "node:test"
import { block, read, run } from "./spec-witness.mjs"
test("public match result and default rules follow async adoption and actual ordered flow", () => {
  const source=read("docs/design/vips/0007-match.md")
  for (const text of ["Promise<Awaited<U>>","native async-return adoption",
    "failed guard does not establish that its positive predicate failed",
    "Do not subtract a coverage set instead of analyzing those tests"])
    assert.ok(source.includes(text),text)
  const result=run(block(source,"const resultFlowExit")+
    '\nif (!Exit.isSuccess(resultFlowExit) || JSON.stringify(resultFlowExit.value) !== JSON.stringify([4,"7",4,7,7])) throw new Error("wrong result flow")\n')
  assert.equal(result.status,0,result.stdout+result.stderr)
})
