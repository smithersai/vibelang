import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"
import { test } from "node:test"

const pkgRoot = new URL("../", import.meta.url)

const entrypoints = [
  ["bin/tsc", 'import "../launcher.mjs"'],
  ["lib/tsc", 'import "../launcher.mjs"'],
  ["tsc", 'import "./launcher.mjs"']
]

test("every tsc shim entrypoint delegates cleanly to launcher.mjs with node shebang", () => {
  for (const [rel, expectedImport] of entrypoints) {
    const fileUrl = new URL(rel, pkgRoot)
    const source = readFileSync(fileUrl, "utf8")
    assert.ok(source.startsWith("#!/usr/bin/env node\n"), `${rel} must start with node shebang`)
    assert.ok(source.includes(expectedImport), `${rel} must import ${expectedImport}`)
    assert.ok(statSync(fileUrl).size < 256, `${rel} should stay a minimal delegating shim`)
  }
})
