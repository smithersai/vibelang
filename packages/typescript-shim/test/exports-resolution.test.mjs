import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

const pkgRoot = new URL("../", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("package.json", pkgRoot), "utf8"))

test("package exports map resolves exclusively to existing package files", () => {
  assert.equal(manifest.exports["."], "./lib/version.cjs")
  assert.equal(manifest.exports["./bin/tsc"], "./bin/tsc")
  assert.equal(manifest.exports["./lib/tsc"], "./lib/tsc")
  assert.equal(manifest.exports["./package.json"], "./package.json")
  assert.equal(manifest.bin.tsc, "bin/tsc")
  for (const target of Object.values(manifest.exports)) {
    assert.equal(typeof target, "string")
    assert.ok(existsSync(new URL(target, pkgRoot)), `export target ${target} must exist`)
  }
})
