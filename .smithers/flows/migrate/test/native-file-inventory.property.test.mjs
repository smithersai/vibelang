import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { rewriteExports, restoreExports } from "../lib/codemod.mjs"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { comparePacks, excludeSidecars, packRepository } from "../lib/pack-policy.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-native-file-inventory.json", import.meta.url), "utf8"))
const scratch = tmpdir()
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const manifestAt = root => JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const run = (cwd, command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60000 })
  assert.equal(result.status, 0, [command, ...args].join(" ") + "\n" + result.stdout + result.stderr)
  return result.stdout
}
function setup(root, { files = corpus.files, publishFiles = corpus.publishFiles, modules = corpus.modules } = {}) {
  const pkg = { name: "native-inventory-control", version: "1.0.0", type: "module",
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }, files: [...files],
    publishConfig: { files: [...publishFiles], exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } } }
  put(root, "package.json", JSON.stringify(pkg))
  for (const file of modules) put(root, file, "export const answer = 42\n")
  put(root, "src/private/secret.ts", "export const secret = true\n")
  put(root, "src/private/secret.vibe", "export const secret = true\n")
  put(root, "src/unrelated.vibe", "export const unrelated = true\n")
  put(root, "dist/index.js", "export const answer = 42\n")
  put(root, "dist/index.d.ts", "export declare const answer: 42\n")
  put(root, "README.md", "Package control.\n")
  return pkg
}
const migrated = modules => modules.map(from => ({ from, to: from.replace(/\.(?:m?ts)$/, ".vibe") }))

test("published file inventory oracle quotes the tooling spec", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.rule))
})

test("source allowlists follow exact renamed modules and restore only recorded additions", () => {
  const root = mkdtempSync(join(scratch, "native-inventory-"))
  try {
    const original = setup(root), renames = migrated(corpus.modules)
    const edits = rewriteExports(root, renames)
    const next = manifestAt(root)
    for (const { to } of renames) {
      assert.ok(next.files.includes(to), "root files omit " + to)
      assert.ok(next.publishConfig.files.includes(to), "published files omit " + to)
    }
    assert.deepEqual(next.files.slice(0, original.files.length), original.files)
    assert.deepEqual(next.exports, original.exports)
    assert.deepEqual(next.publishConfig.exports, original.publishConfig.exports)
    assert.ok(!next.files.includes("src/**/*.vibe"), "do not widen to unrelated native sources")
    assert.deepEqual(rewriteExports(root, renames), [], "restart is idempotent")
    next.files.push("assets")
    next.publishConfig.files.push("docs")
    put(root, "package.json", JSON.stringify(next))
    restoreExports(root, JSON.parse(JSON.stringify(edits)), corpus.modules[0])
    const partially = manifestAt(root)
    assert.ok(!partially.files.includes(renames[0].to))
    assert.ok(partially.files.includes(renames[1].to), "another migrated module stays packed")
    restoreExports(root, edits, corpus.modules[1])
    const restored = manifestAt(root)
    assert.deepEqual(restored.files, [...original.files, "assets"])
    assert.deepEqual(restored.publishConfig.files, [...original.publishConfig.files, "docs"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("existing native entries and packages without allowlists keep authored publication policy", () => {
  const root = mkdtempSync(join(scratch, "native-inventory-authored-"))
  try {
    const original = setup(root, { files: ["src/**/*.ts", "src/index.vibe"], publishFiles: ["src"] })
    assert.deepEqual(rewriteExports(root, migrated(["src/index.ts"])), [])
    assert.deepEqual(manifestAt(root), original)
    delete original.files
    delete original.publishConfig.files
    put(root, "package.json", JSON.stringify(original))
    assert.deepEqual(rewriteExports(root, migrated(["src/index.ts"])), [])
    assert.deepEqual(manifestAt(root), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("durable codemod journals source inventory additions before applying renames", () => {
  const root = mkdtempSync(join(scratch, "native-inventory-journal-"))
  try {
    setup(root)
    const before = readFileSync(join(root, "package.json"), "utf8")
    const state = prepareState(root, corpus.modules, corpus.modules, { ts, tracked: ["package.json", ...corpus.modules] })
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), before)
    assert.ok(state.exportEdits.some(edit => edit.fileEntry === "src/index.vibe"), "inventory edit belongs to durable scope")
    applyState(root, JSON.parse(JSON.stringify(state)))
    assert.ok(manifestAt(root).files.includes("src/index.vibe"))
    assert.ok(manifestAt(root).publishConfig.files.includes("src/index.vibe"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

function selection(input) {
  const root = mkdtempSync(join(scratch, "native-inventory-select-"))
  try {
    const from = "src/" + input.stem + "." + input.extension, to = from.replace(/\.(?:m?ts)$/, ".vibe")
    const pattern = input.mode === "exact" ? from : input.mode === "directory" ? "src" : input.mode === "all" ? "src/**" : "src/**/*." + input.extension
    const files = [pattern, ...input.excluded ? ["!src/**"] : [], ...input.targetExcluded ? ["!**/*.vibe"] : []]
    setup(root, { modules: [from], files, publishFiles: files })
    const edits = rewriteExports(root, [{ from, to }])
    const next = manifestAt(root)
    const add = !input.excluded && !input.targetExcluded && ["exact", "extension"].includes(input.mode)
    assert.equal(next.files.includes(to), add)
    assert.equal(next.publishConfig.files.includes(to), add)
    assert.deepEqual(rewriteExports(root, [{ from, to }]), [])
    restoreExports(root, edits, from)
    assert.deepEqual(manifestAt(root).files, files)
    assert.deepEqual(manifestAt(root).publishConfig.files, files)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("property: extension allowlists preserve selection, exclusions and authored entries across restore", async () => {
  await checkProperty(fc, { name: "published-native-file-inventory", rule: corpus.rule,
    command: "node --test .smithers/flows/migrate/test/native-file-inventory.property.test.mjs",
    arbitrary: fc.record({ stem: fc.constantFrom("index", "deep/worker", "space name", "雪"),
      extension: fc.constantFrom("ts", "mts"), mode: fc.constantFrom("exact", "directory", "all", "extension"),
      excluded: fc.boolean(), targetExcluded: fc.boolean() }),
    check: selection, numRuns: 160, regressions: new URL("./corpus/", import.meta.url) })
})

for (const packer of ["npm", "bun", "pnpm"]) test("packed " + packer + " consumer preserves native sources, runtime and ordinary declarations", async () => {
  const root = mkdtempSync(join(scratch, "native-inventory-pack-"))
  try {
    const pkg = join(root, "pkg")
    setup(pkg)
    const config = { target: pkg, packages: [{ dir: "." }], packer }
    const beforeDir = join(root, "before"), afterDir = join(root, "after")
    const before = await packRepository(config, beforeDir)
    const control = snapshot => {
      const out = join(root, "consumer-pack-" + snapshot)
      mkdirSync(out)
      if (packer === "bun") run(pkg, packer, ["pm", "pack", "--destination", out])
      else run(pkg, packer, ["pack", "--pack-destination", out])
      const archives = readdirSync(out).filter(file => file.endsWith(".tgz"))
      assert.equal(archives.length, 1)
      const consumer = join(root, "consumer-" + snapshot)
      put(consumer, "package.json", '{"private":true,"type":"module"}')
      run(consumer, "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", join(out, archives[0])])
      for (const runtime of ["node", "bun"]) assert.equal(run(consumer, runtime, ["--input-type=module", "-e", 'import { answer } from "native-inventory-control"; console.log(answer)']).trim(), "42")
      put(consumer, "index.ts", 'import { answer } from "native-inventory-control"; const exact: 42 = answer; export { exact }\n')
      run(consumer, process.execPath, [require.resolve("typescript/lib/tsc.js"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "index.ts"])
    }
    control("before")
    rewriteExports(pkg, migrated(corpus.modules))
    for (const { from, to } of migrated(corpus.modules)) renameSync(join(pkg, from), join(pkg, to))
    put(pkg, "src/index.d.vibe.ts", "export declare const answer: 42\n")
    const manifest = manifestAt(pkg)
    excludeSidecars(pkg, manifest)
    put(pkg, "package.json", JSON.stringify(manifest))
    const after = await packRepository(config, afterDir)
    const files = after.packages["."].files
    for (const file of ["src/index.vibe", "src/helper.vibe", "dist/index.js", "dist/index.d.ts", "README.md"]) assert.ok(files.includes(file), "tarball omitted " + file + ": " + files.join(", "))
    assert.ok(!files.some(file => file.includes("private") || file.includes("unrelated") || /\.d\.vibe\.ts$/.test(file)), files.join(", "))
    assert.equal(comparePacks(before, after, { ".": migrated(corpus.modules).map(item => item.to) }).ok, true)
    control("after")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
