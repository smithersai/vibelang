import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { gzipSync } from "node:zlib"
import { test } from "node:test"
import { prepareToolchainPublication, publishableDependency, stagedRelease, stagedToolchainSpecs, toolchainPackageNames } from "../lib/toolchain-publication.mjs"
import { repinVibeLang } from "../lib/upgrade.mjs"
import { specsFrom, toolchainSpecs } from "../lib/wire.mjs"
const require = createRequire(new URL("../../../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")

// A valid tar header with package metadata; real npm pack/install/import is
// exercised separately in runtime-pack-install.test.mjs.
function artifact(pkg) {
  const body = Buffer.from(JSON.stringify(pkg)), header = Buffer.alloc(512)
  header.write("package/package.json")
  header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116)
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124)
  header.write("00000000000\0", 136); header.fill(32, 148, 156); header.write("0", 156)
  header.write("ustar\0", 257); header.write("00", 263)
  header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ", 148)
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512 + 1024)]))
}
const read = file => JSON.parse(readFileSync(file, "utf8"))
const write = (file, value) => { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + "\n") }

function fixture(manager, versions, names, privatePackage = false, yaml = true) {
  const root = mkdtempSync(join(tmpdir(), "toolchain-publication-"))
  const tarballs = Object.fromEntries(toolchainPackageNames.map((name, i) => {
    const file = ".vibelang-toolchain/" + name + "-" + i + ".tgz"
    mkdirSync(join(root, ".vibelang-toolchain"), { recursive: true })
    writeFileSync(join(root, file), artifact({ name, version: versions[i] }))
    return [name, name + "-" + i + ".tgz"]
  }))
  const specsFor = dir => toolchainSpecs(dir, tarballs)
  const pkg = { name: "fixture-root", version: "1.0.0", private: true, scripts: { test: "unchanged" }, overrides: { untouched: "9.9.9" }, pnpm: { overrides: { untouched: "8.8.8" } }, resolutions: { untouched: "7.7.7" } }
  write(join(root, "package.json"), pkg)
  const file = "packages/library/package.json"
  const leaf = { name: "@alchemy/fixture", version: "1.0.0", ...(privatePackage ? { private: true } : {}), exports: { ".": "./index.js" }, peerDependencies: { effect: "^4.1.1" }, dependencies: { untouched: "^1.2.3", ...Object.fromEntries(names.map(name => [name, specsFor("packages/library")[name]])) }, devDependencies: { unchanged: "3.2.1" } }
  write(join(root, file), leaf)
  const yamlText = 'packages:\n  - "packages/*"\n# retain unrelated policy\noverrides: # keep header comment\n  untouched: "6.6.6"\n  "vibelang-runtime": \'0.0.9\' # retain this comment\n'
  if (manager === "pnpm" && yaml) writeFileSync(join(root, "pnpm-workspace.yaml"), yamlText)
  return { root, file, leaf, pkg, specsFor, yamlText, options: { target: root, manifests: ["package.json", file], manager, specsFor }, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

const version = fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 30 }), fc.constantFrom("", "-alpha.1", "-rc.2+build.7", "+build.4")).map(([a, b, c, suffix]) => a + "." + b + "." + c + suffix)

test("generated public runtime and compiler pins use artifact versions, preserve local builds and unrelated contracts", () => {
  fc.assert(fc.property(fc.constantFrom("npm", "pnpm", "bun", "yarn"), fc.tuple(version, version, version, version), fc.subarray(toolchainPackageNames, { minLength: 1 }), fc.boolean(), fc.boolean(), (manager, versions, names, privatePackage, yaml) => {
    const f = fixture(manager, versions, names, privatePackage, yaml)
    try {
      const result = prepareToolchainPublication(f.options)
      const after = read(join(f.root, f.file)), root = read(join(f.root, "package.json"))
      assert.deepEqual(after.exports, f.leaf.exports)
      assert.deepEqual(after.peerDependencies, f.leaf.peerDependencies)
      assert.equal(after.dependencies.untouched, "^1.2.3")
      assert.equal(after.devDependencies.unchanged, "3.2.1")
      assert.equal(root.scripts.test, "unchanged")
      assert.equal(root.overrides.untouched, "9.9.9")
      assert.equal(root.pnpm.overrides.untouched, "8.8.8")
      assert.equal(root.resolutions.untouched, "7.7.7")
      if (privatePackage) {
        assert.deepEqual(after, f.leaf)
        assert.deepEqual(root, f.pkg)
        assert.deepEqual(result.changed, [])
        assert.equal(existsSync(join(f.root, ".vibelang/toolchain-publication.json")), false)
      } else {
        for (const name of names) {
          assert.equal(after.dependencies[name], versions[toolchainPackageNames.indexOf(name)])
          if (manager === "npm") {
            assert.equal(after.devDependencies[name], f.specsFor("packages/library")[name])
            assert.equal(resolve(f.root, specsFrom(after, "packages/library", ".")[name].slice(5)), resolve(f.root, f.specsFor(".")[name].slice(5)))
          } else assert.equal(after.devDependencies[name], undefined)
          assert.equal(stagedToolchainSpecs(f.root, "packages/library")[name], f.specsFor("packages/library")[name])
        }
        assert.deepEqual(result.releaseRequired, names.map(name => ({ name, version: versions[toolchainPackageNames.indexOf(name)] })).sort((a, b) => a.name.localeCompare(b.name)))
        const receipt = read(join(f.root, ".vibelang/toolchain-publication.json"))
        assert.equal(receipt.overrides.length, manager === "npm" ? 0 : 4)
        if (manager === "pnpm" && yaml) {
          const text = readFileSync(join(f.root, "pnpm-workspace.yaml"), "utf8")
          assert.ok(text.includes("# retain unrelated policy"))
          assert.ok(text.includes("overrides: # keep header comment"))
          assert.equal(text.match(/^overrides:/gm).length, 1)
          assert.ok(text.includes("# retain this comment"))
          assert.ok(text.includes('untouched: "6.6.6"'))
        }
        assert.deepEqual(prepareToolchainPublication(f.options).changed, [], "idempotent")
      }
    } finally { f.dispose() }
  }), { numRuns: 120, seed: 670011 })
})

for (const manager of ["npm", "pnpm", "bun", "yarn"]) {
  test(manager + " publication switches remove generated local overrides and development file pins", () => {
    const f = fixture(manager, ["0.0.11", "0.0.12", "0.0.13", "0.0.14"], ["vibelang-runtime", "vibelang"])
    try {
      prepareToolchainPublication(f.options)
      const specs = Object.fromEntries(toolchainPackageNames.map(name => [name, "0.0.15"]))
      for (const file of f.options.manifests) {
        const path = join(f.root, file)
        writeFileSync(path, repinVibeLang(readFileSync(path, "utf8"), specs).text)
      }
      const result = prepareToolchainPublication({ ...f.options, specsFor: () => specs })
      assert.deepEqual(result.releaseRequired, [])
      const pkg = read(join(f.root, f.file))
      assert.equal(pkg.dependencies.vibelang, "0.0.15")
      if (manager === "npm") assert.equal(pkg.devDependencies.vibelang, "0.0.15")
      else assert.equal(pkg.devDependencies.vibelang, undefined)
      const receipt = read(join(f.root, ".vibelang/toolchain-publication.json"))
      assert.deepEqual(receipt.overrides, [])
      assert.deepEqual(receipt.localPins, {})
      const text = readFileSync(join(f.root, manager === "pnpm" ? "pnpm-workspace.yaml" : "package.json"), "utf8")
      assert.ok(!text.includes("file:"), "no stale override references the removed tarball directory")
      assert.deepEqual(prepareToolchainPublication({ ...f.options, specsFor: () => specs }).changed, [])
    } finally { f.dispose() }
  })
}

test("a changed managed override fails before modifying any package", () => {
  const f = fixture("bun", ["0.0.11", "0.0.11", "0.0.11", "0.0.11"], ["vibelang-runtime"])
  try {
    prepareToolchainPublication(f.options)
    const root = read(join(f.root, "package.json"))
    root.overrides["vibelang-runtime"] = "authored-change"
    write(join(f.root, "package.json"), root)
    const before = readFileSync(join(f.root, f.file), "utf8")
    assert.throws(() => prepareToolchainPublication(f.options), /managed vibelang-runtime override changed/)
    assert.equal(readFileSync(join(f.root, f.file), "utf8"), before)
    assert.equal(read(join(f.root, "package.json")).overrides["vibelang-runtime"], "authored-change")
  } finally { f.dispose() }
})

test("staged metadata rejects the wrong package, invalid release versions and malformed archives", () => {
  const root = mkdtempSync(join(tmpdir(), "publication-metadata-"))
  try {
    const file = join(root, "runtime.tgz")
    for (const version of ["file:../runtime", "latest", "01.0.0", "0.0.11-alpha.01", "0.0", "0.0.11..1"]) {
      writeFileSync(file, artifact({ name: "vibelang-runtime", version }))
      assert.throws(() => stagedRelease(root, "file:./runtime.tgz", "vibelang-runtime"), /exact release version/)
    }
    writeFileSync(file, artifact({ name: "unrelated", version: "0.0.11" }))
    assert.throws(() => stagedRelease(root, "file:./runtime.tgz", "vibelang-runtime"), /real name/)
    writeFileSync(file, "invalid")
    assert.throws(() => stagedRelease(root, "file:./runtime.tgz", "vibelang-runtime"), /Cannot read staged/)
    const original = { name: "fixture", version: "1.0.0", dependencies: { unrelated: "file:./native" } }
    assert.deepEqual(publishableDependency(original, "unrelated", "file:./native", "0.0.11"), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("opencode source-child compiler corpus uses a released dependency and manager-specific staged installation", () => {
  const corpus = read(new URL("./corpus/opencode-packed-source-child-compiler.json", import.meta.url))
  const original = structuredClone(corpus.manifest)
  const spec = original.dependencies.vibelang
  for (const manager of ["npm", "pnpm", "bun", "yarn"]) {
    const after = publishableDependency(original, "vibelang", spec, corpus.version, manager)
    assert.equal(after.dependencies.vibelang, corpus.version)
    assert.equal(after.devDependencies.unchanged, "1.2.3")
    assert.equal(after.devDependencies.vibelang, manager === "npm" ? spec : undefined)
    assert.deepEqual(original, corpus.manifest)
  }
})

// Bun 1.4.2 reads root "overrides" whenever that key exists and consults
// "resolutions" only otherwise (oven-sh/bun bun-v1.4.2
// src/install/lockfile/OverrideMap.rs parse_count/parse_append), so staged
// pins must go where Bun looks.
const bunReads = root => Object.hasOwn(root, "overrides") ? root.overrides : root.resolutions
const corpus = read(new URL("./corpus/opencode-bun-existing-overrides.json", import.meta.url))

function pinFixture(manager, root) {
  const target = mkdtempSync(join(tmpdir(), "toolchain-pin-table-"))
  const tarballs = Object.fromEntries(toolchainPackageNames.map(name => {
    mkdirSync(join(target, ".vibelang-toolchain"), { recursive: true })
    writeFileSync(join(target, ".vibelang-toolchain", name + ".tgz"), artifact({ name, version: "0.0.11" }))
    return [name, name + ".tgz"]
  }))
  const specsFor = dir => toolchainSpecs(dir, tarballs)
  write(join(target, "package.json"), root)
  write(join(target, "child/package.json"), { name: "fixture-child", version: "1.0.0", dependencies: { "vibelang-runtime": specsFor("child")["vibelang-runtime"] } })
  return { target, specsFor, options: { target, manifests: ["package.json", "child/package.json"], manager, specsFor }, dispose: () => rmSync(target, { recursive: true, force: true }) }
}

test("opencode-bun-existing-overrides: Bun pins go into an author's existing overrides, which Bun reads instead of resolutions", () => {
  const f = pinFixture("bun", structuredClone(corpus.root))
  try {
    prepareToolchainPublication(f.options)
    const root = read(join(f.target, "package.json"))
    for (const [name, value] of Object.entries(corpus.root.overrides)) assert.equal(root.overrides[name], value, "author override kept")
    assert.equal(bunReads(root)["vibelang-runtime"], f.specsFor(".")["vibelang-runtime"])
    assert.deepEqual(root.resolutions, corpus.root.resolutions, "the field Bun ignores is left as the author wrote it")
  } finally { f.dispose() }
})

for (const [label, overrides, table] of [["absent", undefined, "resolutions"], ["empty", {}, "overrides"], ["non-empty", { effect: "4.1.1" }, "overrides"]]) {
  test("bun with root overrides " + label + " pins the staged toolchain in " + table + " and a publication switch restores the root manifest", () => {
    const root = { name: "root", private: true, workspaces: ["child"], ...(overrides ? { overrides } : {}) }
    const f = pinFixture("bun", structuredClone(root))
    try {
      prepareToolchainPublication(f.options)
      const after = read(join(f.target, "package.json"))
      for (const name of toolchainPackageNames) assert.equal(after[table][name], f.specsFor(".")[name])
      assert.equal(bunReads(after)["vibelang-runtime"], f.specsFor(".")["vibelang-runtime"])
      assert.equal(Object.hasOwn(after, table === "overrides" ? "resolutions" : "overrides"), false, "no second pin table")
      const published = Object.fromEntries(toolchainPackageNames.map(name => [name, "0.0.11"]))
      prepareToolchainPublication({ ...f.options, specsFor: () => published })
      assert.deepEqual(read(join(f.target, "package.json")), root, "restore leaves the author's root manifest, with no empty table setup created")
    } finally { f.dispose() }
  })
}

test("bun: a conflicting author override for a toolchain package yields to the staged pin and comes back on restore", () => {
  const root = { name: "root", private: true, workspaces: ["child"], overrides: { effect: "4.1.1", "vibelang-runtime": "0.0.9" } }
  const f = pinFixture("bun", structuredClone(root))
  try {
    prepareToolchainPublication(f.options)
    assert.equal(read(join(f.target, "package.json")).overrides["vibelang-runtime"], f.specsFor(".")["vibelang-runtime"], "the staged build wins while staged")
    const receipt = read(join(f.target, ".vibelang/toolchain-publication.json"))
    assert.deepEqual(receipt.overrides.find(slot => slot.name === "vibelang-runtime"), { name: "vibelang-runtime", value: f.specsFor(".")["vibelang-runtime"], file: "package.json", table: "overrides", hadValue: true, previous: "0.0.9" })
    const published = Object.fromEntries(toolchainPackageNames.map(name => [name, "0.0.12"]))
    prepareToolchainPublication({ ...f.options, specsFor: () => published })
    assert.deepEqual(read(join(f.target, "package.json")).overrides, { effect: "4.1.1", "vibelang-runtime": "0.0.12" }, "an existing author pin moves to the published release, as before")
  } finally { f.dispose() }
})

test("bun: a receipt whose pins sit in resolutions moves them into the author's overrides and restores resolutions exactly", () => {
  const root = { name: "root", private: true, workspaces: ["child"], overrides: { effect: "4.1.1" }, resolutions: { untouched: "7.7.7", "vibelang-runtime": "0.0.9" } }
  const f = pinFixture("bun", structuredClone(root))
  try {
    // The receipt an earlier setup wrote when it always used resolutions.
    const staged = f.specsFor(".")
    const old = structuredClone(root)
    for (const name of toolchainPackageNames) old.resolutions[name] = staged[name]
    write(join(f.target, "package.json"), old)
    write(join(f.target, "child/package.json"), { name: "fixture-child", version: "1.0.0", dependencies: { "vibelang-runtime": "0.0.11" } })
    write(join(f.target, ".vibelang/toolchain-publication.json"), { version: 1, manager: "bun", versions: Object.fromEntries(toolchainPackageNames.map(name => [name, "0.0.11"])), packages: ["child/package.json"], localPins: staged, releaseRequired: [{ name: "vibelang-runtime", version: "0.0.11" }], overrides: toolchainPackageNames.map(name => ({ name, value: staged[name], file: "package.json", table: "resolutions", hadValue: name === "vibelang-runtime", ...(name === "vibelang-runtime" ? { previous: "0.0.9" } : {}) })) })
    prepareToolchainPublication(f.options)
    const after = read(join(f.target, "package.json"))
    assert.deepEqual(after.resolutions, root.resolutions, "the author's resolutions come back, not the staged path")
    for (const name of toolchainPackageNames) assert.equal(after.overrides[name], staged[name])
    assert.equal(after.overrides.effect, "4.1.1")
    assert.deepEqual(prepareToolchainPublication(f.options).changed, [], "idempotent")
  } finally { f.dispose() }
})

test("yarn keeps resolutions even when overrides exist, and a non-object Bun overrides stops setup", () => {
  const f = pinFixture("yarn", { name: "root", private: true, workspaces: ["child"], overrides: { effect: "4.1.1" } })
  try {
    prepareToolchainPublication(f.options)
    const after = read(join(f.target, "package.json"))
    assert.equal(after.resolutions["vibelang-runtime"], f.specsFor(".")["vibelang-runtime"])
    assert.deepEqual(after.overrides, { effect: "4.1.1" })
  } finally { f.dispose() }
  for (const overrides of [null, "x", []]) {
    const g = pinFixture("bun", { name: "root", private: true, workspaces: ["child"], overrides })
    try {
      const before = readFileSync(join(g.target, "package.json"), "utf8")
      assert.throws(() => prepareToolchainPublication(g.options), /Bun reads the root overrides/)
      assert.equal(readFileSync(join(g.target, "package.json"), "utf8"), before)
    } finally { g.dispose() }
  }
})

test("property: Bun's effective pin table holds every staged pin; author entries survive; a publication switch restores the root", () => {
  const map = fc.option(fc.dictionary(fc.constantFrom("effect", "untouched", "vibelang-runtime", "vibelang"), fc.constantFrom("4.1.1", "0.0.9", "^1.0.0"), { maxKeys: 3 }), { nil: undefined })
  fc.assert(fc.property(fc.constantFrom("bun", "yarn", "pnpm"), map, map, fc.boolean(), (manager, overrides, resolutions, rerun) => {
    const root = { name: "root", private: true, workspaces: ["child"], ...(overrides ? { overrides } : {}), ...(resolutions ? { resolutions } : {}) }
    const f = pinFixture(manager, structuredClone(root))
    try {
      prepareToolchainPublication(f.options)
      if (rerun) assert.deepEqual(prepareToolchainPublication(f.options).changed, [], "idempotent")
      const after = read(join(f.target, "package.json"))
      const effective = manager === "bun" ? bunReads(after) : manager === "yarn" ? after.resolutions : after.pnpm.overrides
      for (const name of toolchainPackageNames) assert.equal(effective[name], f.specsFor(".")[name])
      for (const field of ["overrides", "resolutions"]) for (const [name, value] of Object.entries(root[field] ?? {})) {
        if (after[field] !== effective || !toolchainPackageNames.includes(name)) assert.equal(after[field][name], value, field + "." + name + " kept")
      }
      const published = Object.fromEntries(toolchainPackageNames.map(name => [name, "0.0.12"]))
      prepareToolchainPublication({ ...f.options, specsFor: () => published })
      const restored = read(join(f.target, "package.json")), expected = structuredClone(root)
      const table = manager === "bun" ? (overrides ? expected.overrides : expected.resolutions) : manager === "yarn" ? expected.resolutions : undefined
      for (const name of toolchainPackageNames) if (table && Object.hasOwn(table, name)) table[name] = "0.0.12"
      assert.deepEqual(restored, expected)
    } finally { f.dispose() }
  }), { numRuns: 150, seed: 1903 })
})

function tarball(files) {
  const blocks = []
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text), header = Buffer.alloc(512)
    header.write("package/" + name)
    header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116)
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124)
    header.write("00000000000\0", 136); header.fill(32, 148, 156); header.write("0", 156)
    header.write("ustar\0", 257); header.write("00", 263)
    header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ", 148)
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}
const bun = spawnSync("bun", ["--version"], { encoding: "utf8" })

test("a real Bun workspace install with author overrides imports the staged runtime", { skip: bun.status !== 0 && "bun is not installed", timeout: 120000 }, () => {
  const target = mkdtempSync(join(tmpdir(), "toolchain-pin-bun-"))
  try {
    const tarballs = {}
    for (const name of toolchainPackageNames) {
      mkdirSync(join(target, ".vibelang-toolchain"), { recursive: true })
      writeFileSync(join(target, ".vibelang-toolchain", name + ".tgz"), tarball({ "package.json": JSON.stringify({ name, version: "0.0.11", type: "module", main: "index.js" }), "index.js": "export const marker = " + JSON.stringify("staged " + name) + "\n" }))
      tarballs[name] = name + ".tgz"
    }
    const specsFor = dir => toolchainSpecs(dir, tarballs)
    write(join(target, "package.json"), structuredClone(corpus.root))
    write(join(target, "child/package.json"), { name: "fixture-child", version: "1.0.0", type: "module", dependencies: { "vibelang-runtime": specsFor("child")["vibelang-runtime"] } })
    prepareToolchainPublication({ target, manifests: ["package.json", "child/package.json"], manager: "bun", specsFor })
    assert.equal(read(join(target, "child/package.json")).dependencies["vibelang-runtime"], "0.0.11", "the published dependency is the release version")
    // An unreachable registry: the install passes only if Bun takes the staged pin.
    const env = { ...process.env, BUN_INSTALL_CACHE_DIR: join(target, ".bun-cache"), NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/" }
    const install = spawnSync("bun", ["install", "--ignore-scripts", "--registry", "http://127.0.0.1:9/"], { cwd: target, env, encoding: "utf8", timeout: 90000 })
    assert.equal(install.status, 0, install.stdout + install.stderr)
    const loaded = spawnSync("bun", ["-e", "console.log((await import('vibelang-runtime')).marker)"], { cwd: join(target, "child"), env, encoding: "utf8" })
    assert.equal(loaded.stdout.trim(), "staged vibelang-runtime", loaded.stderr)
  } finally { rmSync(target, { recursive: true, force: true }) }
})
