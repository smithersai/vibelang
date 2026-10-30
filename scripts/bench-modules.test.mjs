import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = fileURLToPath(new URL("./bench/modules.sh", import.meta.url))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang module staging-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    return file
  }
  const pkg = (path, value) => {
    put(path + "/package.json", JSON.stringify({ main: "index.cjs" }))
    return put(path + "/index.cjs", "module.exports = " + JSON.stringify(value) + "\n")
  }
  mkdirSync(join(root, "scripts/bench"), { recursive: true })
  cpSync(script, join(root, "scripts/bench/modules.sh"))
  put("packages/runtime/dist/index.js", "")
  pkg("packages/runtime", "runtime")
  pkg("packages/runtime/node_modules/effect", "runtime effect")
  for (const [install, packages] of [
    ["experiments", ["@fixture/shared", "@fixture/experiment", "plain-shared", "experiment-only"]],
    ["docs/tools", ["@fixture/shared", "@fixture/documentation", "plain-shared", "documentation-only"]]
  ]) {
    for (const name of packages) pkg(install + "/node_modules/" + name, install + " " + name)
    pkg(install + "/node_modules/effect", install + " effect")
    pkg(install + "/node_modules/vibelang-runtime", install + " runtime")
    pkg(install + "/node_modules/vibelang-vite", install + " vite")
  }
  const output = join(root, "benchmark output")
  const modules = join(output, "node_modules")
  const run = () => {
    const result = spawnSync("sh", [join(root, "scripts/bench/modules.sh"), output], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
  const value = name => readFileSync(createRequire(join(output, "package.json")).resolve(name), "utf8")
  const assertValue = (name, expected) => assert.equal(value(name), "module.exports = " + JSON.stringify(expected) + "\n")
  const assertInputsUnchanged = () => {
    assert.equal(existsSync(join(root, "experiments/node_modules/@fixture/documentation")), false)
    assert.equal(existsSync(join(root, "docs/tools/node_modules/@fixture/experiment")), false)
  }
  return { root, put, pkg, output, modules, run, assertValue, assertInputsUnchanged }
}

test("benchmark staging merges scoped packages and preserves package precedence on rerun", t => {
  const f = fixture(t)
  for (let i = 0; i < 2; i++) {
    f.run()
    for (const name of ["@fixture/shared", "@fixture/experiment", "plain-shared", "experiment-only"]) {
      f.assertValue(name, "experiments " + name)
    }
    for (const name of ["@fixture/documentation", "documentation-only"]) f.assertValue(name, "docs/tools " + name)
    f.assertValue("effect", "runtime effect")
    f.assertValue("vibelang-runtime", "runtime")
    assert.equal(existsSync(join(f.modules, "vibelang-vite")), false)
    f.assertInputsUnchanged()
  }
})

for (const kind of ["absolute symlink", "relative symlink", "directory"]) {
  test("benchmark staging merges an existing scope " + kind + " without writing into its source", t => {
    const f = fixture(t)
    const existing = kind === "directory" ? "benchmark output/node_modules/@fixture" : "previous install/@fixture"
    f.pkg(existing + "/shared", "previous shared")
    f.pkg(existing + "/local", "previous local")
    if (kind !== "directory") {
      mkdirSync(f.modules, { recursive: true })
      const target = join(f.root, existing)
      symlinkSync(kind === "relative symlink" ? relative(f.modules, target) : target, join(f.modules, "@fixture"))
    }
    for (let i = 0; i < 2; i++) {
      f.run()
      f.assertValue("@fixture/shared", "previous shared")
      f.assertValue("@fixture/local", "previous local")
      f.assertValue("@fixture/documentation", "docs/tools @fixture/documentation")
      f.assertValue("@fixture/experiment", "experiments @fixture/experiment")
      f.assertInputsUnchanged()
      if (kind !== "directory") assert.equal(existsSync(join(f.root, existing, "documentation")), false)
    }
  })
}

test("migrating an old scope symlink preserves the input installation alias", t => {
  const f = fixture(t)
  const alias = join(f.root, "experiments/node_modules")
  const original = join(f.root, "first installation")
  renameSync(alias, original)
  symlinkSync(original, alias)
  mkdirSync(f.modules, { recursive: true })
  symlinkSync(relative(f.modules, join(alias, "@fixture")), join(f.modules, "@fixture"))
  f.run()
  f.assertValue("@fixture/experiment", "experiments @fixture/experiment")
  const replacement = join(f.root, "second installation")
  f.pkg("second installation/@fixture/experiment", "replacement experiment")
  rmSync(alias)
  symlinkSync(replacement, alias)
  assert.equal(realpathSync(join(f.modules, "@fixture/experiment")), join(replacement, "@fixture/experiment"))
  assert.equal(readFileSync(join(f.modules, "@fixture/experiment/index.cjs"), "utf8"), 'module.exports = "replacement experiment"\n')
})
