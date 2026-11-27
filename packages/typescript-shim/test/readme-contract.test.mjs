import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const pkgRoot = new URL("../", import.meta.url)
const readme = readFileSync(new URL("README.md", pkgRoot), "utf8")

test("typescript-shim README documents @vibe directive, VIP-42, and paired compiler requirement", () => {
  assert.ok(readme.includes("vibelang-typescript"), "README must name vibelang-typescript")
  assert.ok(readme.includes("// @vibe"), "README must document the // @vibe directive")
  assert.ok(readme.includes("VIP-42"), "README must reference VIP-42")
  assert.ok(readme.includes("vibelang"), "README must mention paired vibelang compiler package")
  assert.ok(!readme.includes("/Users/"), "README must not leak private paths")
})
