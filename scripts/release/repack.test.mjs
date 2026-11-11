// node --test scripts/release/repack.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { repack } from "./repack.mjs"

const fc = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))("fast-check")

function fixture(t, options = {}) {
  options = { plugin: true, ...options }
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-repack-test-"))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const source = join(scratch, "source")
  const tarballs = join(scratch, "tarballs")
  mkdirSync(join(source, "bin"), { recursive: true })
  mkdirSync(join(source, "editor"))
  mkdirSync(tarballs)
  const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]
  const pkg = {
    name: "vibelang", version: "0.0.1", bin: { vibelang: "bin/vibelang" },
    files: ["bin", "editor", "LICENSE", "NOTICE", "README.md", ...(options.plugin ? ["dprint-plugin.json"] : [])],
    scripts: { prepack: "node -e 'process.exit(80)'" },
    optionalDependencies: Object.fromEntries(platforms.filter((p) => !p.includes(options.stripped ?? "none")).map((p) => [(p.startsWith("win32-") ? `@smthrs/cli-${p}` : `vibelang-${p}`), "0.0.1"]))
  }
  writeFileSync(join(source, "package.json"), JSON.stringify(pkg, null, 2) + "\n")
  for (const [path, content] of Object.entries({ "bin/vibelang": "#!/usr/bin/env node\nconsole.log('unchanged launcher')\n", "editor/vibelang.vsix": Buffer.from([0, 255, 1, 128]), LICENSE: "license\n", NOTICE: "notice\n", "README.md": "readme\n" })) {
    writeFileSync(join(source, path), content)
  }
  chmodSync(join(source, "bin/vibelang"), 0o755)
  if (options.plugin) {
    const dprintNames = { "darwin-arm64": "darwin-aarch64", "darwin-x64": "darwin-x86_64", "linux-arm64": "linux-aarch64", "linux-x64": "linux-x86_64", "win32-arm64": "windows-aarch64", "win32-x64": "windows-x86_64" }
    const plugin = { schemaVersion: 2, kind: "process", name: "dprint-plugin-vibelang", version: "0.0.1" }
    for (const p of platforms.filter((p) => !p.includes(options.strippedPlugin ?? "none"))) plugin[dprintNames[p]] = { reference: `npm:${p.startsWith("win32-") ? `@smthrs/cli-${p}` : `vibelang-${p}`}@0.0.1/bin/${p.startsWith("win32") ? "vibelang.exe" : "vibelang"}`, checksum: "0".repeat(64) }
    writeFileSync(join(source, "dprint-plugin.json"), JSON.stringify(plugin, null, 2) + "\n")
  }
  const [packed] = JSON.parse(execFileSync("npm", ["pack", source, "--pack-destination", tarballs, "--ignore-scripts", "--json", "--silent"], { encoding: "utf8" }))
  const packages = platforms.map((p) => (p.startsWith("win32-") ? `@smthrs/cli-${p}` : `vibelang-${p}`)).concat("vibelang-runtime", "vibelang-vite", "create-vibelang").map((name) => {
    const file = `${name.replace("@", "").replace("/", "-")}-0.0.1.tgz`
    writeFileSync(join(tarballs, file), `unchanged ${name}`)
    return { name, version: "0.0.1", file, sha256: `existing-${name}` }
  })
  const entry = { name: packed.name, version: packed.version, file: packed.filename, size: packed.size, unpackedSize: packed.unpackedSize, files: packed.files.length }
  const manifest = { version: "0.0.1", packages: [...packages, entry] }
  writeFileSync(join(tarballs, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  return { scratch, source, tarballs, pkg, entry, manifest, others: packages.map((p) => [p.file, readFileSync(join(tarballs, p.file))]) }
}

const archiveFile = (tarballs, path) => execFileSync("tar", ["-xOzf", join(tarballs, "vibelang-0.0.1.tgz"), `package/${path}`])
const manifestFile = (tarballs) => JSON.parse(readFileSync(join(tarballs, "manifest.json"), "utf8"))

test("win32 repack changes only platform manifests, records sha256, and preserves the other nine tarballs", (t) => {
  const { tarballs, pkg, entry, manifest, others } = fixture(t)
  const files = ["bin/vibelang", "editor/vibelang.vsix", "LICENSE", "NOTICE", "README.md"]
  const before = files.map((path) => [path, archiveFile(tarballs, path)])
  repack(tarballs, "win32")
  const result = JSON.parse(archiveFile(tarballs, "package.json"))
  delete pkg.optionalDependencies["@smthrs/cli-win32-arm64"]
  delete pkg.optionalDependencies["@smthrs/cli-win32-x64"]
  assert.deepEqual(result, pkg)
  assert.equal(Object.keys(result.optionalDependencies).length, 4)
  for (const [path, content] of before) assert.deepEqual(archiveFile(tarballs, path), content, path)
  for (const [file, content] of others) assert.deepEqual(readFileSync(join(tarballs, file)), content, file)
  const updated = manifestFile(tarballs)
  assert.deepEqual(updated.packages.slice(0, 9), manifest.packages.slice(0, 9))
  const last = updated.packages.at(-1)
  assert.equal(last.sha256, createHash("sha256").update(readFileSync(join(tarballs, entry.file))).digest("hex"))
  assert.equal(last.size, readFileSync(join(tarballs, entry.file)).length)
  assert.equal(last.files, entry.files)
  const after = readFileSync(join(tarballs, entry.file))
  const afterManifest = readFileSync(join(tarballs, "manifest.json"))
  repack(tarballs, "win32")
  assert.deepEqual(readFileSync(join(tarballs, entry.file)), after)
  assert.deepEqual(readFileSync(join(tarballs, "manifest.json")), afterManifest)
})

test("win32 repack drops the skipped platforms from the dprint plugin manifest", (t) => {
  const { tarballs, entry } = fixture(t, { plugin: true })
  repack(tarballs, "win32")
  const plugin = JSON.parse(archiveFile(tarballs, "dprint-plugin.json"))
  assert.deepEqual(Object.keys(plugin).sort(), ["darwin-aarch64", "darwin-x86_64", "kind", "linux-aarch64", "linux-x86_64", "name", "schemaVersion", "version"])
  assert.equal(plugin["linux-x86_64"].reference, "npm:vibelang-linux-x64@0.0.1/bin/vibelang")
  assert.equal(JSON.parse(archiveFile(tarballs, "package.json")).name, entry.name)
  assert.equal(archiveFile(tarballs, "bin/vibelang").toString(), "#!/usr/bin/env node\nconsole.log('unchanged launcher')\n")
})

test("empty and unmatched skip patterns leave tarball and manifest byte-identical", (t) => {
  const { tarballs, entry } = fixture(t)
  const before = readFileSync(join(tarballs, entry.file))
  const beforeManifest = readFileSync(join(tarballs, "manifest.json"))
  for (const skip of ["", ", ,", "no-match"]) repack(tarballs, skip)
  assert.deepEqual(readFileSync(join(tarballs, entry.file)), before)
  assert.deepEqual(readFileSync(join(tarballs, "manifest.json")), beforeManifest)
})

test("comma and whitespace skip patterns use the publisher's substring matching", (t) => {
  const { tarballs } = fixture(t)
  repack(tarballs, "win32, darwin-x64\tlinux-arm64")
  assert.deepEqual(JSON.parse(archiveFile(tarballs, "package.json")).optionalDependencies, {
    "vibelang-darwin-arm64": "0.0.1", "vibelang-linux-x64": "0.0.1"
  })
})

test("a package identity mismatch fails without replacing tarball or manifest", (t) => {
  const { tarballs, entry, manifest } = fixture(t)
  manifest.version = "0.0.2"
  writeFileSync(join(tarballs, "manifest.json"), JSON.stringify(manifest))
  const before = readFileSync(join(tarballs, entry.file))
  const beforeManifest = readFileSync(join(tarballs, "manifest.json"))
  assert.throws(() => repack(tarballs, "win32"), /expected vibelang@0\.0\.2/)
  assert.deepEqual(readFileSync(join(tarballs, entry.file)), before)
  assert.deepEqual(readFileSync(join(tarballs, "manifest.json")), beforeManifest)
})

test("npm pack cannot silently omit an existing payload", (t) => {
  const { scratch, source, tarballs, entry } = fixture(t)
  const extracted = join(scratch, "original")
  mkdirSync(join(extracted, "package"), { recursive: true })
  execFileSync("tar", ["-xzf", join(tarballs, entry.file), "-C", extracted])
  writeFileSync(join(extracted, "package", "extra.txt"), "not selected by package.json files\n")
  execFileSync("tar", ["-czf", join(tarballs, entry.file), "-C", extracted, "package"])
  const before = readFileSync(join(tarballs, entry.file))
  const beforeManifest = readFileSync(join(tarballs, "manifest.json"))
  assert.throws(() => repack(tarballs, "win32"), /changed package files or permissions/)
  assert.deepEqual(readFileSync(join(tarballs, entry.file)), before)
  assert.deepEqual(readFileSync(join(tarballs, "manifest.json")), beforeManifest)
})

// A skip run must not decide what a later run publishes.
test("a run without a skip pattern restores the full tarball and manifest after a skip run", (t) => {
  const { tarballs, entry } = fixture(t, { plugin: true })
  const before = readFileSync(join(tarballs, entry.file))
  const beforeManifest = readFileSync(join(tarballs, "manifest.json"))
  repack(tarballs, "win32")
  assert.equal(Object.keys(JSON.parse(archiveFile(tarballs, "package.json")).optionalDependencies).length, 4)
  assert.notDeepEqual(readFileSync(join(tarballs, entry.file)), before)
  repack(tarballs, "")
  assert.deepEqual(readFileSync(join(tarballs, entry.file)), before)
  assert.deepEqual(readFileSync(join(tarballs, "manifest.json")), beforeManifest)
  assert.equal(Object.keys(JSON.parse(archiveFile(tarballs, "package.json")).optionalDependencies).length, 6)
  assert.equal(Object.keys(JSON.parse(archiveFile(tarballs, "dprint-plugin.json"))).filter((key) => key.includes("windows")).length, 2)
  assert.deepEqual(readFileSync(join(tarballs, "vibelang-0.0.1.full.tgz")), before)
})

test("property: the tarball depends only on the last skip pattern, whatever ran before", (t) => {
  const { tarballs, pkg } = fixture(t, { plugin: true })
  const all = Object.keys(pkg.optionalDependencies)
  const skip = fc.constantFrom("", "win32", "darwin", "linux-arm64", "x64", "win32,linux", "no-match", "arm64 darwin-x64")
  const fresh = new Map()
  fc.assert(fc.property(fc.array(skip, { maxLength: 3 }), skip, (earlier, last) => {
    for (const pattern of earlier) repack(tarballs, pattern)
    repack(tarballs, last)
    const patterns = last.split(/[,\s]+/).filter(Boolean)
    const expected = all.filter((name) => !patterns.some((pattern) => name.includes(pattern)))
    assert.deepEqual(Object.keys(JSON.parse(archiveFile(tarballs, "package.json")).optionalDependencies), expected)
    const references = Object.values(JSON.parse(archiveFile(tarballs, "dprint-plugin.json"))).map((value) => value?.reference).filter(Boolean)
    assert.deepEqual(references.map((reference) => reference.slice(4, reference.lastIndexOf("@"))), expected)
    // The same pattern always yields the same bytes and manifest entry.
    const now = JSON.stringify([createHash("sha256").update(readFileSync(join(tarballs, "vibelang-0.0.1.tgz"))).digest("hex"), manifestFile(tarballs)])
    if (fresh.has(last)) assert.equal(now, fresh.get(last))
    fresh.set(last, now)
  }), { numRuns: 12, seed: 544002, examples: [[["win32"], ""], [["win32", "darwin"], "win32"], [[], "linux-arm64"]] })
})

for (const [name, options, message] of [
  ["optionalDependencies", { stripped: "win32" }, /lists optionalDependencies \[.*\], but manifest\.json has the platform packages \[.*@smthrs\/cli-win32-x64.*\]; run make-packages/],
  ["dprint plugin", { plugin: true, strippedPlugin: "win32" }, /dprint-plugin\.json references .*run make-packages/],
]) {
  test(`a tarball whose ${name} already lack a platform the manifest publishes is refused`, (t) => {
    const { tarballs, entry } = fixture(t, options)
    const before = readFileSync(join(tarballs, entry.file))
    const beforeManifest = readFileSync(join(tarballs, "manifest.json"))
    for (const skip of ["", "win32"]) assert.throws(() => repack(tarballs, skip), message)
    assert.deepEqual(readFileSync(join(tarballs, entry.file)), before)
    assert.deepEqual(readFileSync(join(tarballs, "manifest.json")), beforeManifest)
    assert.equal(existsSync(join(tarballs, "vibelang-0.0.1.full.tgz")), false, "a stripped tarball is never kept as the full one")
  })
}

test("a full tarball without its manifest entry is refused", (t) => {
  const { tarballs } = fixture(t)
  repack(tarballs, "win32")
  rmSync(join(tarballs, "vibelang-0.0.1.full.json"))
  assert.throws(() => repack(tarballs, ""), /must both exist; run make-packages/)
})


test("a tarball without its dprint plugin manifest is refused before any artifact changes", (t) => {
  const { tarballs, entry } = fixture(t, { plugin: false })
  const before = readFileSync(join(tarballs, entry.file))
  const beforeManifest = readFileSync(join(tarballs, "manifest.json"))
  for (const skip of ["", "win32"]) assert.throws(() => repack(tarballs, skip), /missing dprint-plugin\.json/)
  assert.deepEqual(readFileSync(join(tarballs, entry.file)), before)
  assert.deepEqual(readFileSync(join(tarballs, "manifest.json")), beforeManifest)
  assert.equal(existsSync(join(tarballs, "vibelang-0.0.1.full.tgz")), false)
})
