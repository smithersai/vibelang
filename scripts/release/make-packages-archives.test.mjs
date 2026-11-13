// Local release assembly only: npm pack runs, npm publish never does.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { dirname, join } from "node:path"
import { test } from "node:test"

import { repo, json, vsixFiles, zipAt, fixture, assemble, listing, archive, unzipped, strays } from "./make-packages-fixture.mjs"

test("packs every file the compiler package lists and every target its exports name", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  const compiler = json(join(root, "packages/compiler/package.json"))
  assert.deepEqual(archive(root, "vibelang", "tree-sitter/src/scanner.c"), readFileSync(join(repo, "editors/tree-sitter-vibelang/src/scanner.c")))
  assert.ok(archive(root, "vibelang", "tree-sitter/src/parser.c").length > 1000)
  const targets = Object.values(compiler.exports).flatMap((target) => typeof target === "string" ? [target] : Object.values(target))
  for (const path of [...targets.map((target) => target.replace(/^\.\//, "")), ...compiler.files.filter((file) => file !== "bin" && file !== "editor")]) {
    assert.ok(archive(root, "vibelang", path).length > 0, `vibelang tarball lacks ${path}`)
  }
})

test("packs the same vibelang tarball when only the VS Code extension's packaging time differs", { timeout: 240_000 }, (t) => {
  const hashes = []
  for (const when of ["2026-11-08T05:04:40Z", "2026-11-08T05:16:08Z"]) {
    const root = fixture(t)
    writeFileSync(join(root, "editors/vscode/vibelang.vsix"), zipAt(new Date(when), vsixFiles))
    const result = assemble(root)
    assert.equal(result.status, 0, result.stderr)
    const { file } = json(join(root, "dist-npm/tarballs/manifest.json")).packages.find((pkg) => pkg.name === "vibelang")
    hashes.push(createHash("sha256").update(readFileSync(join(root, "dist-npm/tarballs", file))).digest("hex"))
    assert.deepEqual(unzipped(root, archive(root, "vibelang", "editor/vibelang.vsix")), vsixFiles)
  }
  assert.equal(hashes[0], hashes[1])
})

test("release assembly includes every registered grammar and its manifest", { timeout: 120_000 }, t => {
  const root = fixture(t)
  const grammarRoot = join(root, "editors/tree-sitter-vibelang")
  const manifest = json(join(grammarRoot, "tree-sitter.json"))
  manifest.grammars.push({ name: "extra", path: "extra", "file-types": ["extra"] })
  writeFileSync(join(grammarRoot, "tree-sitter.json"), JSON.stringify(manifest))
  mkdirSync(join(grammarRoot, "extra/src"), { recursive: true })
  writeFileSync(join(grammarRoot, "extra/src/parser.c"), "int tree_sitter_extra(void) { return 1; }")
  writeFileSync(join(grammarRoot, "extra/src/scanner.c"), "int extra_scan(void) { return 1; }")
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(archive(root, "vibelang", "tree-sitter/tree-sitter.json")), manifest)
  assert.equal(archive(root, "vibelang", "tree-sitter/extra/src/parser.c").toString(), "int tree_sitter_extra(void) { return 1; }")
  const unpacked = join(root, "unpacked")
  mkdirSync(unpacked)
  const version = json(join(root, "packages/compiler/package.json")).version
  execFileSync("tar", ["-xzf", join(root, "dist-npm/tarballs", `vibelang-${version}.tgz`), "-C", unpacked])
  const library = join(root, "parser.so")
  const build = spawnSync(process.execPath, [join(unpacked, "package/bin/vibelang-ast-grep"), library], { encoding: "utf8" })
  if (process.platform === "win32") {
    assert.equal(build.status, 1)
    assert.match(build.stderr, /WSL/)
    return
  }
  assert.equal(build.status, 0, build.stderr)
  const symbols = execFileSync("nm", ["-g", library], { encoding: "utf8" })
  assert.ok(symbols.includes("tree_sitter_vibe"), symbols)
  assert.ok(symbols.includes("tree_sitter_extra"), symbols)
})

test("untracked files in the template and package source directories are not packed", { timeout: 120_000 }, (t) => {
  const root = fixture(t, { untracked: Object.keys(strays) })
  for (const path of Object.keys(strays)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), "TOKEN=not-for-npm\n")
  }
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  for (const [path, name] of Object.entries(strays)) {
    const leaked = listing(root, name).filter((file) => file.endsWith("/" + path.split("/").at(-1)))
    assert.deepEqual(leaked, [], `${name} packs the untracked ${path}`)
  }
  assert.ok(listing(root, "create-vibelang").includes("package/template/src/main.vibe"))
  assert.ok(listing(root, "vibelang-vite").includes("package/src/index.js"))
})

test("a tracked lockfile in the template is still left out, by the shared exclusion list", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  for (const name of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]) writeFileSync(join(root, "templates/app", name), "lock\n")
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(listing(root, "create-vibelang").filter((file) => /lock/.test(file)), [])
})
