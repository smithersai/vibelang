import assert from "node:assert/strict"
import { test } from "node:test"
import { declarationFixture } from "./testing/package-declaration.mjs"

const target = () => declarationFixture("PACKAGE.ts").targets["go-vibelangmapper"]

test("mapper checks stream scope stages through the Go progress runner", () => {
  const mapper = target()
  assert.match(mapper.shell, /node \.\.\/\.\.\/scripts\/go-test-progress\.mjs go test -json /)
  assert.ok(mapper.tools.includes("node"))
  assert.ok(mapper.tools.includes("go"))
  assert.ok(mapper.data.includes("//scripts/go-test-progress.mjs"))
})

test("mapper progress retains native handover, scope dependencies and test bounds", () => {
  const mapper = target()
  for (const setting of ["CGO_ENABLED=0", "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules",
    "VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc",
    "VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper"]) {
    assert.ok(mapper.shell.includes(setting), setting)
  }
  assert.match(mapper.shell, /-count=1 -p 8 -timeout 25m -trimpath \.\/internal\/vibelangmapper\/\.\.\.$/)
  assert.equal(mapper.timeout, declarationFixture("PACKAGE.ts").evaluate('check("bounds", "true", [], []).timeout'))
})
