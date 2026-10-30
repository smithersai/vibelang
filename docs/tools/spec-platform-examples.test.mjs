import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read, run } from "./spec-witness.mjs"

test("Intl classification and the module-directory repair agree with the published APIs", () => {
  const services = chapter("005-services")
  assert.ok(services.includes("ECMAScript library globals (`Date.now`, `Math.random`, `JSON`, `Intl`)"))
  assert.ok(services.includes("`Intl` is an [ECMAScript internationalization library](https://tc39.es/ecma402/#intl-object) declaration and needs no allowlist entry"))
  assert.ok(services.includes("use (try Path.Path).fromFileUrl(…), then dirname"))
  const vip = read("docs/design/vips/0033-platform-stdlib.md")
  assert.ok(vip.includes("ECMAScript library globals (including `Intl`)"))
  assert.ok(!vip.includes("`AbortController`, `Intl`"))
  const inventory = JSON.parse(read("docs/design/inventory/platform-globals.json"))
  assert.ok(!inventory.allowlist.includes("Intl"))
  assert.ok(read("docs/user/src/platform/platform-globals.md").includes("first read `try Path.Path`"))
  const result = run(`
import { Effect, Path } from "effect"
import assert from "node:assert/strict"
assert.equal(new Intl.NumberFormat("en-US").format(1234), "1,234")
const directory = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.dirname(yield* path.fromFileUrl(new URL("file:///tmp/example.mjs")))
})
const exit = Effect.runSyncExit(Effect.provide(directory, Path.layer))
assert.equal(exit._tag, "Success")
assert.equal(exit.value, "/tmp")
assert.equal("fromFileUrl" in Path, false)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
