import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"
import { declarationFixture } from "./testing/package-declaration.mjs"
import { builtMapper, locateMapper, packagedMapper } from "./testing/mapper-binary.mjs"

const root = "/repo"
const present = (...paths) => (candidate) => paths.includes(candidate)

test("parity tests take the mapper the graph already built before building their own", () => {
  const built = join(root, builtMapper)
  assert.equal(locateMapper({ root, env: {}, exists: present(built) }), built)
})

test("a packaged mapper wins over the graph build", () => {
  const packaged = join(root, packagedMapper), built = join(root, builtMapper)
  assert.equal(locateMapper({ root, env: {}, exists: present(packaged, built) }), packaged)
})

test("PARITY_TEST_MAPPER wins when it exists and falls through when it does not", () => {
  const local = "/elsewhere/vibelang-mapper", built = join(root, builtMapper)
  const env = { PARITY_TEST_MAPPER: local }
  assert.equal(locateMapper({ root, env, exists: present(local, built) }), local)
  assert.equal(locateMapper({ root, env, exists: present(built) }), built)
})

test("no mapper anywhere asks the caller to build one", () => {
  assert.equal(locateMapper({ root, env: {}, exists: () => false }), undefined)
  assert.equal(locateMapper({ root, env: { PARITY_TEST_MAPPER: "" }, exists: () => true }), join(root, packagedMapper))
})

test("the mapper-scripts target depends on the graph-built mapper", () => {
  const target = declarationFixture("PACKAGE.ts").targets["mapper-scripts"]
  assert.ok(target.data.includes("typescript.mapper"), "mapper-scripts must list Typescript.mapper so the selection test finds " + builtMapper)
})
