import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = process.env.VIBELANG_BENCH_MODULES_SCRIPT ?? fileURLToPath(new URL("./bench/modules.sh", import.meta.url))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang benchmark destinations-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, value) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, value)
    return file
  }
  const pkg = (path, value) => {
    put(path + "/package.json", JSON.stringify({ main: "index.cjs" }))
    put(path + "/index.cjs", "module.exports = " + JSON.stringify(value))
  }
  const copied = put("scripts/bench/modules.sh", "")
  cpSync(script, copied)
  put("packages/runtime/dist/index.js", "")
  pkg("packages/runtime", "current runtime")
  pkg("packages/runtime/node_modules/effect", "pinned effect")
  pkg("old install/effect", "old effect")
  pkg("old install/vibelang-runtime", "old runtime")
  const output = join(root, "benchmark output")
  const modules = join(output, "node_modules")
  mkdirSync(modules, { recursive: true })
  const run = () => spawnSync("sh", [copied, output], { encoding: "utf8" })
  const value = name => {
    const result = spawnSync(process.execPath, ["-e", "console.log(require(" + JSON.stringify(name) + "))"], { cwd: output, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  return { root, put, pkg, modules, run, value }
}

for (const name of ["effect", "vibelang-runtime"]) {
  for (const kind of ["directory", "file"]) {
    test("benchmark staging refuses an existing " + name + " " + kind + " without modifying it", t => {
      const f = fixture(t)
      const target = join(f.modules, name)
      const payload = "user installation stays intact"
      if (kind === "directory") f.pkg("benchmark output/node_modules/" + name, payload)
      else writeFileSync(target, payload)
      const result = f.run()
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.ok(result.stderr.includes(target), result.stderr)
      assert.match(result.stderr, /existing non-symlink/)
      assert.match(result.stderr, /fresh benchmark output directory/)
      assert.equal(readFileSync(kind === "directory" ? join(target, "index.cjs") : target, "utf8"),
        kind === "directory" ? "module.exports = " + JSON.stringify(payload) : payload)
      assert.equal(lstatSync(target).isSymbolicLink(), false)
      assert.equal(existsSync(join(target, name)), false)
      // Both collisions are checked before either pinned link is written.
      const other = name === "effect" ? "vibelang-runtime" : "effect"
      assert.equal(existsSync(join(f.modules, other)), false)
    })
  }
}

test("benchmark staging checks both destinations before replacing any previous link", t => {
  const f = fixture(t)
  const effect = join(f.modules, "effect")
  const previous = join(f.root, "old install/effect")
  symlinkSync(previous, effect)
  f.pkg("benchmark output/node_modules/vibelang-runtime", "user runtime")
  const result = f.run()
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(realpathSync(effect), previous)
  assert.equal(f.value("effect"), "old effect")
})

for (const kind of ["absent", "absolute link", "relative link", "dangling link"]) {
  test("benchmark staging installs and reruns pinned links over " + kind + " destinations", t => {
    const f = fixture(t)
    if (kind !== "absent") {
      for (const name of ["effect", "vibelang-runtime"]) {
        const previous = join(f.root, kind === "dangling link" ? "missing install" : "old install", name)
        symlinkSync(kind === "relative link" ? relative(f.modules, previous) : previous, join(f.modules, name))
      }
    }
    for (let i = 0; i < 2; i++) {
      const result = f.run()
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(f.value("effect"), "pinned effect")
      assert.equal(f.value("vibelang-runtime"), "current runtime")
      for (const name of ["effect", "vibelang-runtime"]) assert.ok(lstatSync(join(f.modules, name)).isSymbolicLink())
    }
    assert.equal(readFileSync(join(f.root, "old install/effect/index.cjs"), "utf8"), 'module.exports = "old effect"')
  })
}
