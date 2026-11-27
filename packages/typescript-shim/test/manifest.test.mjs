import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

const pkgRoot = new URL("../", import.meta.url)
const repoRoot = new URL("../../../", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("package.json", pkgRoot), "utf8"))
const compilerManifest = JSON.parse(readFileSync(new URL("packages/compiler/package.json", repoRoot), "utf8"))

test("vibelang-typescript manifest declares aligned 7.1.<patch> version and vibelang dependency", () => {
  assert.equal(manifest.name, "vibelang-typescript")
  assert.equal(manifest.license, "Apache-2.0")
  assert.equal(manifest.type, "module")
  assert.equal(manifest.dependencies.vibelang, compilerManifest.version)
  const compilerPatch = compilerManifest.version.split(".")[2]
  assert.equal(manifest.version, `7.1.${compilerPatch}`)
})

test("vibelang-typescript files array covers every published runtime entrypoint", () => {
  for (const required of ["bin", "lib", "launcher.mjs", "tsc", "README.md"]) {
    assert.ok(manifest.files.includes(required), `missing ${required} in files`)
    assert.ok(existsSync(new URL(required, pkgRoot)), `declared file ${required} does not exist`)
  }
})
