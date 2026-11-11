import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, realpathSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { stagePackageTest, fixtureDirectory } from "./testing/package-fixtures.mjs"
import { preparePackageTests } from "./testing/prepare-package-tests.mjs"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "package-fixture-contract-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (name, value) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), value)
  }
  for (const pkg of ["compiler", "runtime", "vite", "unplugin"]) {
    put("packages/" + pkg + "/package.json", '{"type":"module"}')
    put("packages/" + pkg + "/src/value.js", 'export const value = "source"')
    mkdirSync(join(root, "packages", pkg, "node_modules"), { recursive: true })
  }
  put(join("packages", "compiler", "native", "vibelang"), "native")
  put(join("packages", "compiler", "project.mjs"), "export const backend = 1")
  put(join("packages", "runtime", "tsconfig.json"), "{}")
  put("packages/runtime/node_modules/@effect/fake/index.js", 'export const scope = "effect"')
  put(join("experiments", "node_modules", "effect", "package.json"), '{"name":"effect","type":"module","exports":"./index.js"}')
  put("experiments/node_modules/effect/index.js", "export const marker = 1")
  for (const group of ["vite", "unplugin", "source-map-tools"]) {
    const dir = "packages/" + fixtureDirectory(group)
    put(dir + "/.prepared/runtime/package.json", '{"type":"module"}')
    put(dir + "/.prepared/runtime/dist/index.js", 'export const prepared = "real bytes"')
    put(dir + "/.prepared/programs.jsonl", '{"key":"program"}\n')
    put(dir + "/.fixtures/sentinel", "shared fixture must survive")
    put(dir + "/other.test.mjs", 'throw new Error("another assertion file was loaded")')
    put(dir + "/selected.test.mjs", 'import {writeFileSync} from "node:fs"; writeFileSync(new URL("./.fixtures/private",import.meta.url),"owned");')
    mkdirSync(join(root, dir, "node_modules"), { recursive: true })
    if (group === "source-map-tools") put(dir + "/node_modules/@effect/vitest/index.js", "export const test = 1")
  }
  return { root, put }
}
function links(root) {
  return readdirSync(root).flatMap(name => {
    const file = join(root, name), info = lstatSync(file)
    return info.isSymbolicLink() ? [file] : info.isDirectory() ? links(file) : []
  })
}

for (const group of ["vite", "unplugin", "source-map-tools"]) {
  test(group + " leaves stage private projects without replacing shared fixtures or installs", t => {
    const { root, put } = fixture(t), file = fixtureDirectory(group) + "/selected.test.mjs"
    const companion = fixtureDirectory(group) + "/companion.test.mjs"
    put("packages/" + companion, "export const selected = true")
    const first = stagePackageTest(root, group, file), second = stagePackageTest(root, group, [file, companion])
    try {
      assert.notEqual(first.root, second.root)
      assert.equal(first.files.length, 1)
      assert.equal(second.files.length, 2)
      assert.ok(existsSync(second.files[1]))
      assert.ok(!existsSync(join(dirname(first.file), "companion.test.mjs")))
      for (const staged of [first, second]) {
        const compiler = join(staged.root, "packages/compiler")
        assert.equal(realpathSync(join(compiler, "project.mjs")), join(compiler, "project.mjs"),
          "backend identity must be local to the same repository view as its test")
        if (group !== "source-map-tools") assert.equal(realpathSync(join(staged.cwd, "node_modules/vibelang")), compiler)
      }
      assert.ok(!existsSync(join(dirname(first.file), "other.test.mjs")), "unrelated assertions are not read or staged")
      for (const staged of [first, second]) {
        const result = spawnSync(process.execPath, [staged.file], { cwd: staged.cwd, encoding: "utf8" })
        assert.equal(result.status, 0, result.stdout + result.stderr)
        assert.equal(readFileSync(join(dirname(staged.file), ".fixtures/private"), "utf8"), "owned")
        const runtime = join(dirname(staged.file), ".fixtures/vibelang-runtime")
        assert.equal(readFileSync(join(runtime, "dist/index.js"), "utf8"), 'export const prepared = "real bytes"')
        assert.equal(realpathSync(join(runtime, "node_modules/effect")), realpathSync(join(root, "experiments/node_modules/effect")))
      }
      const dir = join(root, "packages", fixtureDirectory(group))
      assert.equal(readFileSync(join(dir, ".fixtures/sentinel"), "utf8"), "shared fixture must survive")
      assert.ok(!existsSync(join(dir, ".fixtures/private")))
      assert.ok(!existsSync(join(root, "packages", group === "source-map-tools" ? "compiler" : group, "node_modules/vibelang")))
    } finally {
      first.cleanup(); second.cleanup()
    }
    assert.ok(!existsSync(first.root) && !existsSync(second.root))
  })
}

test("expensive preparation caches real files and removes all install links", t => {
  const { root, put } = fixture(t)
  put("fake-compiler", "#!" + process.execPath + '\nconst fs=require("node:fs"),path=require("node:path");const dir=path.dirname(process.argv[3]);fs.mkdirSync(path.join(dir,"dist"),{recursive:true});fs.writeFileSync(path.join(dir,"dist/index.js"),"compiled");\n')
  const binary = join(root, "fake-compiler")
  const chmod = spawnSync("chmod", ["+x", binary])
  assert.equal(chmod.status, 0)
  preparePackageTests(root, "vite", binary)
  const output = join(root, "packages/vite/test/.prepared")
  assert.deepEqual(links(output), [], "artifacts must never contain workspace or install symlinks")
  assert.equal(readFileSync(join(output, "runtime/dist/index.js"), "utf8"), "compiled")
})

test("a failed native preparation leaves no install links in its output", t => {
  const { root, put } = fixture(t)
  put("bad-compiler", "#!/bin/sh\nexit 7\n")
  const binary = join(root, "bad-compiler")
  spawnSync("chmod", ["+x", binary])
  assert.throws(() => preparePackageTests(root, "unplugin", binary), /compilation failed: 7/)
  assert.deepEqual(links(join(root, "packages/unplugin/test/.prepared")), [])
})
