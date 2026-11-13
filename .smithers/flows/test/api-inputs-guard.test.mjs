import test from "node:test"
import { assert, readFileSync, writeFileSync, join, assertWholeTreeInput, copyTree } from "./api-inputs-fixture.mjs"

test("whole-tree input guard rejects a narrowed release declaration", t => {
  const root = copyTree(t)
  const probe = ["docs/user/src/api-input-neighbour.md"]
  assertWholeTreeInput(root, probe)
  const packageFile = join(root, "root-test-shards.ts")
  const declaration = readFileSync(packageFile, "utf8")
  const wholeTree = '    trees[""],'
  assert.equal(declaration.split(wholeTree).length, 2)
  writeFileSync(packageFile, declaration.replace(wholeTree,
    '    S.Filegroup({ srcs: [S.glob("scripts/**")] }),'))
  assert.throws(() => assertWholeTreeInput(root, probe), /release must retain the whole-tree input/)
})
