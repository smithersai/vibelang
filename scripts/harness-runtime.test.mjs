import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = process.env.VIBELANG_HARNESS_RUNTIME_ROOT ?? fileURLToPath(new URL("../typescript/vibelang/", import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "harness runtime-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  for (const name of ["harness.mjs", "harness-command.mjs"]) {
    put("typescript/vibelang/" + name, readFileSync(join(source, name)))
  }
  put("typescript/package.json", '{"type":"module"}')
  put("typescript/built/local/tsc", '#!' + process.execPath + '\nimport fs from "node:fs";fs.writeFileSync(process.env.RUNTIME_TRACE,"compiled");fs.mkdirSync("out",{recursive:true});fs.writeFileSync("out/main.js",\'console.log("okay")\')\n')
  chmodSync(join(root, "typescript/built/local/tsc"), 0o755)
  put("typescript/vibelang/cases/one/tsconfig.json", "{}")
  put("typescript/vibelang/cases/one/expected/stdout.txt", "okay\n")
  for (const dir of ["out", "node_modules"]) put("typescript/vibelang/cases/one/" + dir + "/keep.txt", "original")
  put("modules/effect/package.json", '{"name":"effect","version":"4.1.0"}')
  put("runtime/package.json", '{"name":"vibelang-runtime","type":"module","files":["dist"],"exports":"./dist/index.js"}')
  put("runtime/dist/index.js", "export const runtime = true")
  const runtime = join(root, "runtime")
  const trace = join(root, "compiler-trace")
  const invoke = (value = runtime, args = []) => spawnSync(process.execPath, [join(root, "typescript/vibelang/harness.mjs"), ...args, "one"], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, EFFECT_NODE_MODULES: join(root, "modules"), VIBELANG_RUNTIME: value, RUNTIME_TRACE: trace },
  })
  return { root, runtime, trace, put, invoke }
}

const bad = [
  ["missing directory", f => join(f.root, "missing runtime")],
  ["file", f => { f.put("not-directory", "file"); return join(f.root, "not-directory") }],
  ["dangling alias", f => { const at = join(f.root, "alias"); symlinkSync("missing", at); return at }],
  ["relative directory", f => relative(f.root, f.runtime)],
  ["missing manifest", f => { rmSync(join(f.runtime, "package.json")); return f.runtime }],
  ["manifest directory", f => { rmSync(join(f.runtime, "package.json")); mkdirSync(join(f.runtime, "package.json")); return f.runtime }],
  ["invalid JSON", f => { f.put("runtime/package.json", "{broken"); return f.runtime }],
  ...[null, {}, { name: "other-package", files: ["dist"] }, { name: "vibelang-runtime" }, { name: "vibelang-runtime", files: "dist" }, { name: "vibelang-runtime", files: [null] }].map((pkg, i) =>
    ["invalid manifest " + i, f => { f.put("runtime/package.json", JSON.stringify(pkg)); return f.runtime }]),
  ["missing build", f => { rmSync(join(f.runtime, "dist"), { recursive: true }); return f.runtime }],
  ["missing entry", f => { rmSync(join(f.runtime, "dist/index.js")); return f.runtime }],
  ["entry directory", f => { rmSync(join(f.runtime, "dist/index.js")); mkdirSync(join(f.runtime, "dist/index.js")); return f.runtime }],
]

for (const args of [[], ["--isolated"], ["--status"]]) {
  for (const [name, breakRuntime] of bad) test("runtime preflight preserves cases: " + name + " " + args, t => {
    const f = fixture(t)
    const runtime = breakRuntime(f)
    const result = f.invoke(runtime, args)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.match(result.stderr, /harness\.mjs: invalid VIBELANG_RUNTIME/)
    assert.ok(result.stderr.includes(runtime), result.stderr)
    assert.ok(!existsSync(f.trace), "compiler ran")
    for (const dir of ["out", "node_modules"]) {
      assert.equal(readFileSync(join(f.root, "typescript/vibelang/cases/one", dir, "keep.txt"), "utf8"), "original")
    }
    assert.deepEqual(readdirSync(join(f.root, "typescript/vibelang")).filter(name => name.startsWith(".smthrs-harness-")), [])
    assert.ok(!existsSync(join(f.root, "typescript/.cache/vibelang-harness")), "invalid setup emitted per-case failure receipts")
  })
}

for (const mode of ["directory", "alias", "unicode path"]) test("a provisioned runtime still runs the case: " + mode, t => {
  const f = fixture(t)
  let runtime = f.runtime
  if (mode !== "directory") {
    runtime = join(f.root, mode === "alias" ? "alias" : "runtime café 雪")
    symlinkSync(f.runtime, runtime)
  }
  const result = f.invoke(runtime, ["--isolated"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /1 ok/)
  assert.equal(readFileSync(f.trace, "utf8"), "compiled")
})
