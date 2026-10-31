// VIP-32: "VibeLang declares effect as an exact peerDependency".
// Release gate 4 requires that one exact Effect version in the compiler,
// runtime and starter. A matching range is still not an exact pin.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const read = path => JSON.parse(readFileSync(path, "utf8"))

test("the compiler declares the runtime's exact, required Effect peer", () => {
  const compiler = read(join(repo, "packages/compiler/package.json"))
  const runtime = read(join(repo, "packages/runtime/package.json"))
  assert.match(runtime.peerDependencies.effect, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.equal(compiler.peerDependencies?.effect, runtime.peerDependencies.effect)
  assert.notEqual(compiler.peerDependenciesMeta?.effect?.optional, true)
})

function metadataFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-effect-peer-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const path of [
    "scripts/release/make-packages.mjs", "docs/tools/release-docs.mjs",
    "typescript/tsc/internal/vibelang/identity.go",
    ...["compiler", "runtime", "vite", "unplugin", "create-vibelang"].map(name => "packages/" + name + "/package.json"),
    "templates/app/package.json",
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    cpSync(join(repo, path), join(root, path))
  }
  return root
}

test("release rejects missing, ranged, optional and mismatched compiler Effect peers before packaging", t => {
  const root = metadataFixture(t)
  const path = join(root, "packages/compiler/package.json")
  const original = read(path)
  const pin = read(join(root, "packages/runtime/package.json")).peerDependencies.effect
  const invalid = fc.oneof(
    fc.constantFrom(undefined, null, "*", "^" + pin, "~" + pin, ">=" + pin, "latest", [pin], {}),
    fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
      .map(parts => parts.join(".")).filter(value => value !== pin),
  )
  fc.assert(fc.property(invalid, peer => {
    const manifest = { ...original, peerDependencies: { effect: peer } }
    writeFileSync(path, JSON.stringify(manifest))
    const result = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /vibelang: effect peer must match the runtime's exact pin/)
  }), { seed: 320011, numRuns: 30, examples: [[undefined], ["^" + pin], ["4.0.7"]] })
  writeFileSync(path, JSON.stringify({ ...original, peerDependencies: { effect: pin }, peerDependenciesMeta: { effect: { optional: true } } }))
  const optional = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
  assert.notEqual(optional.status, 0)
  assert.match(optional.stderr, /vibelang: effect peer must be required/)
})

test("release rejects a matching Effect range and accepts matching exact pins", t => {
  const root = metadataFixture(t)
  const compilerPath = join(root, "packages/compiler/package.json")
  const runtimePath = join(root, "packages/runtime/package.json")
  const compiler = read(compilerPath)
  const runtime = read(runtimePath)
  const pin = runtime.peerDependencies.effect
  for (const effect of ["^" + pin, "~" + pin, ">=" + pin, "*"]) {
    writeFileSync(compilerPath, JSON.stringify({ ...compiler, peerDependencies: { effect } }))
    writeFileSync(runtimePath, JSON.stringify({ ...runtime, peerDependencies: { ...runtime.peerDependencies, effect } }))
    const result = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /vibelang-runtime: effect peer must be an exact version/)
  }
  writeFileSync(compilerPath, JSON.stringify({ ...compiler, peerDependencies: { effect: pin } }))
  writeFileSync(runtimePath, JSON.stringify(runtime))
  const exact = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
  // This fixture intentionally has no native binaries; its metadata must pass.
  assert.notEqual(exact.status, 0)
  assert.match(exact.stderr, /missing .*dist-npm\/bin/)
  assert.doesNotMatch(exact.stderr, /effect peer must/)
})
