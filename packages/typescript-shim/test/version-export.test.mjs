import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const pkgRoot = new URL("../", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("package.json", pkgRoot), "utf8"))
const versionApi = require("../lib/version.cjs")
const dts = readFileSync(new URL("lib/version.d.cts", pkgRoot), "utf8")

test("lib/version.cjs exports exact manifest version and major.minor", () => {
  assert.equal(versionApi.version, manifest.version)
  assert.equal(versionApi.versionMajorMinor, manifest.version.split(".").slice(0, 2).join("."))
  assert.deepEqual(Object.keys(versionApi).sort(), ["version", "versionMajorMinor"])
})

test("lib/version.d.cts declares both runtime version exports", () => {
  assert.match(dts, /export declare const version: string/)
  assert.match(dts, /export declare const versionMajorMinor: string/)
})
