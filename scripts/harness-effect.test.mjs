import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const source = process.env.HARNESS_EFFECT_SOURCE ??
  fileURLToPath(new URL("../typescript/vibelang/", import.meta.url))

function fixture(t, kind, suffix = "") {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-harness-effect-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, "typescript")
  const dir = path.join(root, "vibelang")
  const at = path.join(dir, "cases", "safe")
  const modules = path.join(temp, "dependency scope " + suffix)
  const effect = path.join(modules, "effect")
  const put = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  for (const name of ["harness.mjs", "harness-command.mjs"]) {
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(source, name), path.join(dir, name))
  }
  put(path.join(root, "package.json"), '{"type":"module"}')
  put(path.join(root, "runtime/package.json"), JSON.stringify({
    name: "vibelang-runtime", type: "module", files: ["dist"], exports: "./dist/index.js",
  }))
  put(path.join(root, "runtime/dist/index.js"), "")
  put(path.join(at, "tsconfig.json"), "{}")
  put(path.join(at, "expected/stdout.txt"), "fixture-ok\n")
  put(path.join(at, "out/keep.txt"), "original output\n")
  const trace = path.join(temp, "compiler.jsonl")
  const compiler = path.join(root, "built/local/tsc")
  put(compiler, "#!" + process.execPath + "\n" + [
    'import fs from "node:fs"',
    'fs.appendFileSync(process.env.HARNESS_EFFECT_TRACE, JSON.stringify(process.argv.slice(2)) + "\\n")',
    'fs.mkdirSync("out", { recursive: true })',
    'fs.writeFileSync("out/main.js", \'console.log("fixture-ok")\\n\')',
  ].join("\n"))
  fs.chmodSync(compiler, 0o755)
  if (kind !== "missing scope") fs.mkdirSync(modules, { recursive: true })
  if (kind === "file") put(effect, "not a package")
  else if (kind === "dangling link") fs.symlinkSync(path.join(temp, "absent"), effect)
  else if (kind === "missing manifest") fs.mkdirSync(effect)
  else if (kind === "directory manifest") fs.mkdirSync(path.join(effect, "package.json"), { recursive: true })
  else if (kind === "direct") put(path.join(effect, "package.json"), '{"name":"effect","version":"4.0.0"}')
  else if (kind === "linked package") {
    const target = path.join(temp, "installed effect")
    put(path.join(target, "package.json"), '{"name":"effect","version":"4.0.0"}')
    fs.symlinkSync(target, effect)
  } else if (kind === "linked scope") {
    fs.rmdirSync(modules)
    const target = path.join(temp, "installed modules")
    put(path.join(target, "effect/package.json"), '{"name":"effect","version":"4.0.0"}')
    fs.symlinkSync(target, modules)
  }
  return {
    temp, root, dir, at, trace, effect,
    invoke: (args = []) => spawnSync(process.execPath, [path.join(dir, "harness.mjs"), "--jobs", "1", ...args, "safe"], {
      env: { ...process.env, EFFECT_NODE_MODULES: modules,
        VIBELANG_RUNTIME: path.join(root, "runtime"), HARNESS_EFFECT_TRACE: trace },
      encoding: "utf8", timeout: 10_000,
    }),
  }
}

function rejected(f, args) {
  const result = f.invoke(args)
  assert.equal(result.error, undefined, result.stderr)
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.ok(result.stderr.includes("harness.mjs: missing Effect package at " + f.effect), result.stderr)
  assert.match(result.stderr, /EFFECT_NODE_MODULES/)
  assert.match(result.stderr, /bun install/)
  assert.equal(result.stdout, "")
  assert.equal(fs.existsSync(f.trace), false, "invalid environment started the compiler")
  assert.equal(fs.readFileSync(path.join(f.at, "out/keep.txt"), "utf8"), "original output\n")
  assert.equal(fs.existsSync(path.join(f.at, "node_modules")), false, "invalid environment staged dependencies")
  assert.equal(fs.existsSync(path.join(f.root, ".cache/vibelang-harness")), false)
  assert.deepEqual(fs.readdirSync(f.dir).filter(name => name.startsWith(".smthrs-harness-")), [])
}

const invalid = ["missing scope", "missing package", "file", "dangling link", "missing manifest", "directory manifest"]
for (const kind of invalid) {
  for (const isolated of [false, true]) {
    test("missing Effect is rejected before case writes: " + kind + (isolated ? " isolated" : ""), t => {
      const f = fixture(t, kind)
      rejected(f, isolated ? ["--isolated"] : [])
    })
  }
}

test("missing Effect takes precedence over an unmatched selector", t => {
  rejected(fixture(t, "missing package"), ["no-such-case"])
})

for (const kind of ["direct", "linked package", "linked scope"]) {
  for (const isolated of [false, true]) {
    test("valid Effect install executes the case: " + kind + (isolated ? " isolated" : ""), t => {
      const f = fixture(t, kind)
      const result = f.invoke(isolated ? ["--isolated"] : [])
      assert.equal(result.error, undefined, result.stderr)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /1 cases: 1 ok, 0 FAIL/)
      assert.equal(fs.readFileSync(f.trace, "utf8").trim().split("\n").length, 1)
      assert.ok(fs.statSync(path.join(f.effect, "package.json")).isFile())
      if (isolated) assert.equal(fs.readFileSync(path.join(f.at, "out/keep.txt"), "utf8"), "original output\n")
    })
  }
}

test("generated missing package path neighbours preserve case outputs", t => {
  let seed = 0x87c0ffee
  for (let i = 0; i < 24; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const f = fixture(t, invalid[seed % invalid.length], ["space ", "é漢字", "#%", "dashed-"][i % 4] + seed.toString(36))
    const args = i % 2 ? ["--isolated"] : []
    rejected(f, args)
  }
})
