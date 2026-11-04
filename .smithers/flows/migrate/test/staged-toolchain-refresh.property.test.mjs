import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { gzipSync } from "node:zlib"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { addCompilerScripts, refreshToolchainSpecs, repositoryPackages, toolchainDirectory, toolchainSpecs } from "../lib/wire.mjs"
import { must, readJson } from "../lib/util.mjs"

// Setup deletes .vibelang-toolchain before it copies a toolchain's tarballs,
// so a second setup with a newer toolchain must move every specifier an
// earlier setup wrote into it (opencode setup42-m26: install ENOENT on the
// old vibelang and vibelang-unplugin tarballs).
const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = readJson(new URL("./corpus/opencode-staged-toolchain-refresh.json", import.meta.url))
const names = ["vibelang", "vibelang-runtime", "vibelang-vite", "vibelang-unplugin"]
const tarballs = (hash) => Object.fromEntries(names.map((name) => [name, `${name}-0.0.11-${hash}.tgz`]))

test("drive2-opencode minimal: addCompilerScripts moves a staged compiler whose scripts already run vibelang", () => {
  for (const typecheck of ["vibelang -b", "vibelang -p tsconfig.json", "vibelang -b --singleThreaded"]) {
    const next = addCompilerScripts({ scripts: { typecheck }, devDependencies: { vibelang: "file:./.vibelang-toolchain/vibelang-old.tgz" } }, "file:./.vibelang-toolchain/vibelang-new.tgz")
    assert.equal(next.devDependencies.vibelang, "file:./.vibelang-toolchain/vibelang-new.tgz", typecheck)
    assert.deepEqual(next.scripts, { typecheck })
  }
  // A compiler setup did not stage stays as the repository has it.
  for (const vibelang of ["^0.0.10", "file:../vendor/vibelang.tgz", "file:./.vibelang-toolchain-old/vibelang.tgz"]) {
    const pkg = { scripts: { typecheck: "vibelang -b" }, devDependencies: { vibelang } }
    assert.deepEqual(addCompilerScripts(pkg, "file:./.vibelang-toolchain/vibelang-new.tgz"), pkg)
  }
})

// Where a package.json can name a tarball: [field path, key under it].
const places = [
  [["dependencies"]], [["devDependencies"]], [["optionalDependencies"]], [["overrides"]], [["overrides", "@opencode/sdk"]],
  [["resolutions"]], [["pnpm", "overrides"]], [["workspaces", "catalog"]], [["workspaces", "catalogs", "tools"]], [["catalog"]], [["catalogs", "tools"]],
]
const put = (object, path, key, value) => {
  let at = object
  for (const part of path) at = at[part] ??= {}
  at[key] = value
}

test("refreshToolchainSpecs: an earlier setup's specifiers equal a fresh setup's, and nothing else moves", () => {
  fc.assert(fc.property(
    fc.constantFrom(".", "packages/a", "packages/a/b"),
    fc.uniqueArray(fc.record({ name: fc.constantFrom(...names), place: fc.constantFrom(...places), link: fc.boolean() }), { maxLength: 6, selector: (r) => `${r.place[0].join(".")}:${r.name}` }),
    fc.constantFrom("0.0.11-0123456789ab", "0.0.10", "0.0.11"),
    fc.integer({ min: 0, max: 4 }),
    fc.boolean(),
    (dir, refs, oldVersion, indent, partial) => {
      const oldSpecs = toolchainSpecs(dir, Object.fromEntries(names.map((name) => [name, `${name}-${oldVersion}.tgz`])))
      const newTarballs = tarballs("fedcba987654")
      const newSpecs = toolchainSpecs(dir, partial ? { vibelang: newTarballs.vibelang } : newTarballs)
      const shape = (specs, missing) => {
        const pkg = { name: "fixture", devDependencies: { effect: "4.1.0", vibelangish: "file:./vendor/vibelang-0.0.9.tgz", other: "file:./.vibelang-toolchain-old/vibelang-0.0.9.tgz" } }
        for (const { name, place: [path], link } of refs) {
          const old = specs[name] === undefined || specs !== newSpecs
          const spec = specs[name] ?? missing[name]
          put(pkg, path, name, link && old ? spec.replace(/^file:/, "link:") : spec)
        }
        return pkg
      }
      const before = JSON.stringify(shape(oldSpecs, {}), null, indent)
      const result = refreshToolchainSpecs(before, dir, newSpecs)
      const expected = shape(newSpecs, oldSpecs)
      assert.deepEqual(JSON.parse(result.text), expected)
      assert.deepEqual([...result.stale].sort(), refs.filter((r) => !newSpecs[r.name]).map((r) => (r.link ? oldSpecs[r.name].replace(/^file:/, "link:") : oldSpecs[r.name])).sort())
      // The file's formatting stays, and a second refresh changes nothing.
      assert.equal(result.text.split("\n").length, before.split("\n").length)
      assert.equal(refreshToolchainSpecs(result.text, dir, newSpecs).text, result.text)
    }), { seed: 260311, numRuns: 300 })
})

// An npm tarball of files under package/, as setup's publication step reads one.
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

// A staged toolchain directory whose tarballs differ from every other's by content.
function toolchain(root, tag) {
  const dir = join(root, `toolchain-${tag}`)
  mkdirSync(dir, { recursive: true })
  for (const name of names) writeFileSync(join(dir, `${name}-0.0.11.tgz`), tarball({ "package.json": JSON.stringify({ name, version: "0.0.11", build: tag }) }))
  writeFileSync(join(dir, "toolchain.json"), JSON.stringify({ version: "0.0.11", effect: "4.0.6", compiler: "native/vibelang", packages: Object.fromEntries(names.map((name) => [name, `${name}-0.0.11.tgz`])) }))
  return dir
}

async function tree(root, shape) {
  const write = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  const json = (file, value) => write(file, JSON.stringify(value, null, 2) + "\n")
  json("package.json", { name: "fixture", private: true, type: "module", workspaces: ["packages/*"], ...(shape.rootScript ? { scripts: { typecheck: shape.rootScript } } : {}) })
  write("tsconfig.json", '{"compilerOptions":{"noEmit":true},"files":[]}\n')
  if (shape.bun) write("bun.lock", "")
  // A public package depends on the runtime by release, and the root pins the staged build (toolchain-publication).
  json("packages/a/package.json", { name: "@fixture/a", ...(shape.public ? { version: "1.0.0" } : { private: true }), type: "module", scripts: { typecheck: "tsc --noEmit", ...(shape.bunBuild ? { build: "bun script/build.ts" } : {}) }, devDependencies: { effect: "4.0.6" } })
  write("packages/a/tsconfig.json", '{"compilerOptions":{"noEmit":true,"module":"preserve"},"include":["src"]}\n')
  write("packages/a/src/index.ts", "export const a = 1\n")
  if (shape.bunBuild) write("packages/a/script/build.ts", 'await Bun.build({ entrypoints: ["./src/index.ts"], outdir: "dist", plugins: [] })\n')
  if (shape.reaching) json("packages/b/package.json", { name: "@fixture/b", type: "module", scripts: { typecheck: shape.reaching }, dependencies: { "@fixture/a": "workspace:*" } })
  if (shape.foreign) json("packages/c/package.json", { name: "@fixture/c", type: "module", devDependencies: { vibelang: "^0.0.10", other: "file:../../vendor/vibelang-old.tgz" } })
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
}

// Every package.json of the tree, by path.
const manifests = (root) => Object.fromEntries(repositoryPackages(root).map(({ dir }) => [dir, readFileSync(join(root, dir, "package.json"), "utf8")]))
const setUp = (target, dir) => wireTarget(makeConfig({ target, packages: ["packages/a"], test: "true", toolchain: dir, install: "true" }), join(target, ".logs"))

async function verify(shape) {
  const root = mkdtempSync(join(tmpdir(), "staged-refresh-"))
  try {
    const older = toolchain(root, "old"), newer = toolchain(root, "new")
    const fresh = join(root, "fresh"), refreshed = join(root, "refreshed")
    await tree(fresh, shape)
    cpSync(fresh, refreshed, { recursive: true, verbatimSymlinks: true })
    await setUp(fresh, newer)
    await setUp(refreshed, older)
    const before = manifests(refreshed)
    await setUp(refreshed, newer)
    assert.deepEqual(manifests(refreshed), manifests(fresh), JSON.stringify(shape))
    // What install reads exists: every staged specifier names a tarball in the directory.
    for (const [dir, text] of Object.entries(manifests(refreshed))) {
      for (const spec of text.match(/(?:file|link):[^"]*\.vibelang-toolchain\/[^"]+/g) ?? []) {
        assert.ok(readFileSync(join(refreshed, dir, spec.replace(/^(?:file|link):/, ""))), `${dir}: ${spec}`)
      }
    }
    if (shape.foreign) assert.equal(manifests(refreshed)["packages/c"], before["packages/c"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("opencode corpus: setup42-m26 refresh moves the compiler and unplugin of an already-wired tree", async () => {
  await verify(corpus.input)
})

test("setup with an older toolchain, then a newer one, writes what a fresh setup with the newer one writes", async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({
      rootScript: fc.constantFrom(undefined, "tsc -b", "vibelang -b"),
      reaching: fc.constantFrom(undefined, "tsc --noEmit", "vibelang -p tsconfig.json"),
      bunBuild: fc.boolean(),
      foreign: fc.boolean(),
      bun: fc.boolean(),
      public: fc.boolean(),
    }),
    verify,
  ), { seed: 260312, numRuns: 16 })
})
