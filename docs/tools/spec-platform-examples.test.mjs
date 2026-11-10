import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read, run } from "./spec-witness.mjs"

test("Intl classification and the module-directory repair agree with the published APIs", () => {
  const services = chapter("005-services")
  assert.ok(services.includes("ECMAScript library globals (`Date.now`, `Math.random`, `JSON`, `Intl`)"))
  assert.ok(services.includes("`Intl` is an [ECMAScript internationalization library](https://tc39.es/ecma402/#intl-object) declaration and needs no allowlist entry"))
  // VIP-33, amended: import.meta follows TypeScript, so the chapter no longer prescribes a directory repair for
  // import.meta.dirname; the Path repair below stays the documented way to derive a directory from a file URL.
  assert.ok(services.includes("VibeLang imposes no additional restriction on `import.meta` syntax."))
  const vip = read("docs/design/vips/0033-platform-stdlib.md")
  assert.ok(vip.includes("ECMAScript library globals (including `Intl`)"))
  assert.ok(!vip.includes("`AbortController`, `Intl`"))
  const inventory = JSON.parse(read("docs/design/inventory/platform-globals.json"))
  assert.ok(!inventory.allowlist.includes("Intl"))
  // The guide's directory repair obtains Path's implementation with `try Path.Path` before fromFileUrl and dirname.
  const guide = read("docs/user/src/platform/platform-globals.md")
  assert.ok(guide.includes("`try Path.Path`") && guide.includes("fromFileUrl") && guide.includes("dirname"))
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
