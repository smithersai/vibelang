// VIP-32: "VibeLang declares effect as an exact peerDependency".
// Release gate 4 requires that one exact Effect version in the compiler,
// runtime and starter. A matching range is still not an exact pin.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const read = path => JSON.parse(readFileSync(path, "utf8"))

test("the compiler declares the runtime's required Effect ^4.1.0 peer range", () => {
  const compiler = read(join(repo, "packages/compiler/package.json"))
  const runtime = read(join(repo, "packages/runtime/package.json"))
  assert.match(runtime.peerDependencies.effect, /^\^4\.[1-9]\d*\.0$/)
  assert.match(runtime.devDependencies.effect, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.equal(compiler.peerDependencies?.effect, runtime.peerDependencies.effect)
  assert.notEqual(compiler.peerDependenciesMeta?.effect?.optional, true)
})

function metadataFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-effect-peer-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const path of [
    "scripts/release/make-packages.mjs", "scripts/release/zip-times.mjs", "scripts/release/packed-hygiene.mjs", "scripts/release/revision.mjs", "scripts/template-files.mjs", "docs/tools/release-docs.mjs",
    "typescript/tsc/internal/vibelang/identity.go",
    ...["compiler", "runtime", "vite", "unplugin", "create-vibelang", "typescript-shim", "ts-mapper"].map(name => "packages/" + name + "/package.json"),
    "templates/app/package.json",
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    cpSync(join(repo, path), join(root, path))
  }
  return root
}

test("the metadata fixture loads the real packager and stops before building or staging", t => {
  const root = metadataFixture(t)
  const result = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"],
    { encoding: "utf8", timeout: 10_000 })
  assert.ifError(result.error)
  assert.equal(result.status, 1, result.stderr)
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/, "load the packager's local helpers before checking metadata")
  const missing = [...result.stderr.matchAll(/missing dist-npm\/bin\/([^/]+)\/vibelang(?:\.exe)?;/g)].map(match => match[1])
  assert.deepEqual(missing.sort(), ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"])
  assert.doesNotMatch(result.stderr, /effect peer must/)
  assert.equal(existsSync(join(root, "dist-npm")), false, "metadata rejection must not stage packages")
  assert.equal(existsSync(join(root, "packages/runtime/dist")), false, "metadata rejection must not build the runtime")
})

test("release rejects missing, invalid, optional and mismatched compiler Effect peers before packaging", t => {
  const root = metadataFixture(t)
  const path = join(root, "packages/compiler/package.json")
  const original = read(path)
  const range = read(join(root, "packages/runtime/package.json")).peerDependencies.effect
  const invalid = fc.oneof(
    fc.constantFrom(undefined, null, "*", "~4.1.0", ">=4.1.0", "^4.0.0", "latest", [range], {}),
    fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
      .map(parts => parts.join(".")),
  )
  fc.assert(fc.property(invalid, peer => {
    const manifest = { ...original, peerDependencies: { effect: peer } }
    writeFileSync(path, JSON.stringify(manifest))
    const result = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /vibelang: effect peer must match the runtime's range/)
  }), { seed: 320011, numRuns: 30, examples: [[undefined], ["4.1.6"], ["4.0.7"]] })
  writeFileSync(path, JSON.stringify({ ...original, peerDependencies: { effect: range }, peerDependenciesMeta: { effect: { optional: true } } }))
  const optional = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
  assert.notEqual(optional.status, 0)
  assert.match(optional.stderr, /vibelang: effect peer must be required/)
})

test("release rejects invalid Effect ranges and accepts matching ^4.1.0 ranges", t => {
  const root = metadataFixture(t)
  const compilerPath = join(root, "packages/compiler/package.json")
  const runtimePath = join(root, "packages/runtime/package.json")
  const compiler = read(compilerPath)
  const runtime = read(runtimePath)
  const range = runtime.peerDependencies.effect
  for (const effect of ["4.1.6", "^4.0.0", "^3.19.0", "~4.1.0", ">=4.1.0", "*"]) {
    writeFileSync(compilerPath, JSON.stringify({ ...compiler, peerDependencies: { effect } }))
    writeFileSync(runtimePath, JSON.stringify({ ...runtime, peerDependencies: { ...runtime.peerDependencies, effect } }))
    const result = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /vibelang-runtime: effect peer must be a \^4\.x\.0 range/)
  }
  writeFileSync(compilerPath, JSON.stringify({ ...compiler, peerDependencies: { effect: range } }))
  writeFileSync(runtimePath, JSON.stringify(runtime))
  const valid = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
  // This fixture intentionally has no native binaries; its metadata must pass.
  assert.notEqual(valid.status, 0)
  assert.match(valid.stderr, /missing .*dist-npm\/bin/)
  assert.doesNotMatch(valid.stderr, /effect peer must/)
})

test("plugin READMEs, starter README, ts-mapper peer pin, and Vite docs match actual behavior", (t) => {
  const viteReadme = readFileSync(join(repo, "packages/vite/README.md"), "utf8")
  const starterReadme = readFileSync(join(repo, "templates/app/README.md"), "utf8")
  const unpluginReadme = readFileSync(join(repo, "packages/unplugin/README.md"), "utf8")
  const unpluginOptions = readFileSync(join(repo, "packages/unplugin/src/options.d.ts"), "utf8")
  const viteDocs = readFileSync(join(repo, "docs/user/src/setup/vite.md"), "utf8")
  const runtime = read(join(repo, "packages/runtime/package.json"))
  const template = read(join(repo, "templates/app/package.json"))
  const tsMapper = read(join(repo, "packages/ts-mapper/package.json"))

  assert.doesNotMatch(viteReadme, /node_modules\/\.vibelang/)
  assert.doesNotMatch(starterReadme, /node_modules\/\.vibelang/)
  assert.ok(viteReadme.includes("vitest@" + template.devDependencies.vitest), "Vite README vitest pin must match starter")
  assert.doesNotMatch(unpluginReadme, /overrides `rootDir` to the root\b/)
  assert.doesNotMatch(unpluginOptions, /with rootDir set to it/)
  assert.match(viteDocs, /vibelang-unplugin\/rolldown/)
  assert.equal(tsMapper.peerDependencies?.["vibelang-runtime"], runtime.version)
  assert.equal(tsMapper.peerDependencies?.effect, runtime.peerDependencies.effect)

  const root = metadataFixture(t)
  const mapperPath = join(root, "packages/ts-mapper/package.json")
  writeFileSync(mapperPath, JSON.stringify({ ...tsMapper, peerDependencies: { ...tsMapper.peerDependencies, "vibelang-runtime": "0.0.1" } }))
  const drifted = spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 10_000 })
  assert.notEqual(drifted.status, 0)
  assert.match(drifted.stderr, /vibelang-ts-mapper: peer vibelang-runtime 0\.0\.1, expected/)
})
