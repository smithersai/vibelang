import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const source = process.env.VIBELANG_HARNESS_OPTIONS_ROOT ??
  fileURLToPath(new URL("../typescript/vibelang/", import.meta.url))

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-harness-options-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, "typescript")
  const dir = path.join(root, "vibelang")
  const at = path.join(dir, "cases", "safe")
  const put = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  fs.mkdirSync(dir, { recursive: true })
  for (const name of ["harness.mjs", "harness-command.mjs"]) {
    fs.copyFileSync(path.join(source, name), path.join(dir, name))
  }
  put(path.join(root, "package.json"), '{"type":"module"}')
  put(path.join(root, "runtime/package.json"), JSON.stringify({
    name: "vibelang-runtime", type: "module", version: "0.0.0",
    files: ["dist"], exports: "./dist/index.js",
  }))
  put(path.join(root, "runtime/dist/index.js"), "")
  put(path.join(root, "modules/effect/package.json"), '{"name":"effect","version":"4.0.0"}')
  put(path.join(at, "tsconfig.json"), "{}")
  put(path.join(at, "expected/stdout.txt"), "fixture-ok\n")
  put(path.join(at, "out/keep.txt"), "original output\n")
  const trace = path.join(temp, "compiler.jsonl")
  const compiler = path.join(root, "built/local/tsc")
  put(compiler, '#!' + process.execPath + '\n' + [
    'import fs from "node:fs"',
    'fs.appendFileSync(process.env.HARNESS_OPTIONS_TRACE, JSON.stringify(process.argv.slice(2)) + "\\n")',
    'fs.mkdirSync("out", { recursive: true })',
    'fs.writeFileSync("out/main.js", \'console.log("fixture-ok")\\n\')',
  ].join("\n"))
  fs.chmodSync(compiler, 0o755)
  return {
    temp, root, dir, at, trace,
    invoke: args => spawnSync(process.execPath, [path.join(dir, "harness.mjs"), ...args], {
      env: { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"),
        VIBELANG_RUNTIME: path.join(root, "runtime"), HARNESS_OPTIONS_TRACE: trace },
      encoding: "utf8", timeout: 10_000,
    }),
  }
}

function rejected(f, args, flag) {
  const result = f.invoke(args)
  assert.equal(result.error, undefined, result.stderr)
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.ok(result.stderr.includes("harness.mjs: unknown option " + flag), result.stderr)
  assert.equal(result.stdout, "")
  assert.equal(fs.existsSync(f.trace), false, "invalid options started the compiler")
  assert.equal(fs.readFileSync(path.join(f.at, "out/keep.txt"), "utf8"), "original output\n")
  assert.equal(fs.existsSync(path.join(f.at, "node_modules")), false, "invalid options staged dependencies")
  assert.equal(fs.existsSync(path.join(f.root, ".cache/vibelang-harness")), false)
  assert.deepEqual(fs.readdirSync(f.dir).filter(name => name.startsWith(".smthrs-harness-")), [])
}

for (const flag of ["--isolatd", "--job", "--verboes", "--jobs=2", "--status=false", "--report=file.json", "-x", "-j", "--"]) {
  for (const after of [false, true]) {
    test("unknown harness option rejected before writes: " + flag + (after ? " after selector" : ""), t => {
      const f = fixture(t)
      rejected(f, after ? ["safe", flag] : [flag, "safe"], flag)
    })
  }
}

test("generated unknown option neighbours fail before selecting or changing cases", t => {
  const f = fixture(t)
  let seed = 0x86c0ffee
  for (let i = 0; i < 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const option = "--unrecognized-" + seed.toString(36)
    rejected(f, i % 2 ? [option] : ["--jobs", "1", option, "safe"], option)
  }
})

for (const flags of [[], ["--status"], ["--verbose"], ["-v"], ["--jobs", "1"], ["--late-start"], ["--isolated"],
  ["--status", "--verbose", "--jobs", "1", "--late-start", "--isolated"]]) {
  test("supported harness options still execute the selected case: " + JSON.stringify(flags), t => {
    const f = fixture(t)
    const result = f.invoke([...flags, "safe"])
    assert.equal(result.error, undefined, result.stderr)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /1 cases: 1 ok, 0 FAIL/)
    assert.equal(fs.readFileSync(f.trace, "utf8").trim().split("\n").length, 1)
    if (flags.includes("--isolated")) {
      assert.equal(fs.readFileSync(path.join(f.at, "out/keep.txt"), "utf8"), "original output\n")
    }
  })
}

