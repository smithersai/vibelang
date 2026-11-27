import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

const pkgRoot = new URL("../", import.meta.url)
const repoRoot = new URL("../../../", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("package.json", pkgRoot), "utf8"))
const runtimeManifest = JSON.parse(readFileSync(new URL("packages/runtime/package.json", repoRoot), "utf8"))

test("vibelang-ts-mapper manifest declares contentMapper protocol and aligned peerDependencies", () => {
  assert.equal(manifest.name, "vibelang-ts-mapper")
  assert.equal(manifest.license, "Apache-2.0")
  assert.equal(manifest.type, "module")
  assert.deepEqual(manifest.typescript?.contentMapper?.exec, ["./bin/vibelang-mapper"])
  assert.equal(manifest.typescript?.contentMapper?.dynamicConfig, true)
  assert.ok(Array.isArray(manifest.typescript?.contentMapper?.compilerOptions))
  assert.ok(manifest.typescript.contentMapper.compilerOptions.includes("jsx"))
  assert.equal(manifest.peerDependencies["vibelang-runtime"], runtimeManifest.version)
  assert.equal(manifest.exports["./prelude"]?.types, "./prelude.d.ts")
  assert.ok(existsSync(new URL("prelude.d.ts", pkgRoot)))
})
