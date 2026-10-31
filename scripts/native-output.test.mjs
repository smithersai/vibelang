import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8")
const compilerNative = { native: true }
function targets(file) {
  const source = stripTypeScriptTypes(read(file)).replace(/^import .*$/gm, "")
    .replace("export const Package", "globalThis.result")
  const context = {
    S: { Shell: { Build: spec => spec, Test: spec => spec }, Host: { bin: bin => bin },
      Filegroup: spec => spec, glob: patterns => patterns, file: file => file, Package: spec => spec },
    Tsc: { srcs: {} }, Typescript: { compiler: {} },
    Packages: { "compiler-native": compilerNative }, Vibelang: {}
  }
  runInNewContext(source, context)
  return context.result.targets
}

test("release declares the native compiler dependency used by its warning fixture", () => {
  assert.ok(targets("PACKAGE.ts").release.data.includes(compilerNative))
})

function fixture(t, windows = false) {
  const root = mkdtempSync(join(tmpdir(), "native output with spaces "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (name, content, mode) => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, mode ? { mode } : undefined)
  }
  for (const file of ["scripts/build-vibelang.sh", "scripts/native-output.sh"]) {
    if (existsSync(new URL("../" + file, import.meta.url))) put(file, read(file))
  }
  for (const dir of ["typescript/tsc", "typescript/built/local", "packages/compiler/native"]) mkdirSync(join(root, dir), { recursive: true })
  // Hold the actual output descriptor open until the reader acknowledges it.
  // This models the linker/cp write window deterministically, without a sleep.
  const writer = `#!${process.execPath}
const fs = require("node:fs")
const args = process.argv.slice(2)
const out = args.includes("-o") ? args[args.indexOf("-o") + 1] : args.at(-1)
const fd = fs.openSync(out, "w")
fs.writeSync(fd, fs.readFileSync("/bin/true"))
fs.chmodSync(out, 0o755)
if (process.env.NATIVE_TEST_FAIL) process.exit(23)
process.stdout.write("NATIVE_WRITING\\n")
process.stdin.once("data", () => { fs.closeSync(fd); process.exit(0) })
`
  put("bin/go", writer, 0o755)
  put("bin/cp", writer, 0o755)
  if (windows) put("bin/uname", "#!/bin/sh\necho MINGW64_NT-test\n", 0o755)
  return { root, put, env: { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH } }
}

const writers = [
  ["standalone compiler", "sh scripts/build-vibelang.sh", "packages/compiler/native/vibelang"],
  ["Windows standalone compiler", "sh scripts/build-vibelang.sh", "packages/compiler/native/vibelang.exe", true],
  ["graph compiler", targets("typescript/PACKAGE.ts").compiler.shell, "typescript/built/local/tsc"],
  ["graph forms generator", targets("typescript/PACKAGE.ts")["forms-generator"].shell, "typescript/built/local/vibelang-forms"],
  ["graph native copy", targets("packages/PACKAGE.ts")["compiler-native"].shell, "packages/compiler/native/vibelang"]
]
for (const script of ["packages/compiler/test/eslint/run.sh", "packages/vite/test/run.sh", "packages/unplugin/test/run.sh",
  "typescript/vibelang/smoke.sh", "typescript/vibelang/lsp-smoke.sh", "packages/ts-mapper/test/e2e.sh"]) {
  // Exercise each entry point's actual build invocation, leaving the unrelated
  // test/install steps to their own suites.
  const command = read(script).match(/\(cd "[^"]+" && CGO_ENABLED=0 (.+)\)/)?.[1]
  assert.ok(command, script + ": native build invocation")
  const typescript = script.startsWith("typescript/")
  const output = typescript ? (script.endsWith("/smoke.sh") ? "typescript/built/local/tsc" : "typescript/built/local/vibelang")
    : script.startsWith("packages/ts-mapper/") ? "packages/ts-mapper/bin/vibelang-mapper" : "packages/compiler/native/vibelang"
  const setup = 'repo="$PWD"; package="$PWD/packages/ts-mapper"; root="$PWD' + (typescript ? '/typescript' : '') +
    '"; VIBELANG_BINARY="$repo/packages/compiler/native/vibelang"; tsc="$root/built/local/tsc"; vibelang="$root/built/local/vibelang"; cd typescript/tsc; '
  writers.push([script, setup + command, output])
}
for (const [name, command, output, windows] of writers) test(name + ": readers execute throughout a rebuild without ETXTBSY", {
  skip: process.platform !== "linux", timeout: 20_000
}, async t => {
  const f = fixture(t, windows)
  const binary = join(f.root, output)
  mkdirSync(dirname(binary), { recursive: true })
  copyFileSync("/bin/true", binary)
  const before = statSync(binary).ino
  const child = spawn("sh", ["-c", command], { cwd: f.root, env: f.env, stdio: ["pipe", "pipe", "pipe"] })
  let stdout = "", stderr = ""
  child.stderr.on("data", data => { stderr += data })
  const done = new Promise(resolve => child.on("close", code => resolve(code)))
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", data => { stdout += data; if (stdout.includes("NATIVE_WRITING\n")) resolve() })
    child.on("error", reject)
    child.on("exit", code => { if (!stdout.includes("NATIVE_WRITING\n")) reject(new Error(`writer exited ${code}: ${stdout}${stderr}`)) })
  })
  t.after(() => { child.stdin.end("publish\n"); child.kill() })
  await ready
  const failures = []
  for (let i = 0; i < 32; i++) {
    const result = spawnSync(binary, [], { timeout: 1000 })
    if (result.status !== 0) failures.push(result.error?.code ?? result.status)
  }
  const during = statSync(binary).ino
  child.stdin.end("publish\n")
  assert.equal(await done, 0, stdout + stderr)
  assert.deepEqual(failures, [], name + ": reader errors while output is open for writing")
  assert.equal(during, before, "old executable stays published until the writer closes")
  assert.notEqual(statSync(binary).ino, before, "publication replaces the inode")
  assert.equal(spawnSync(binary).status, 0)
  assert.deepEqual(readdirSync(dirname(binary)).filter(name => name.startsWith(".native-output-")), [])
})

test("a failed native build keeps the previous executable and removes its temporary output", t => {
  const f = fixture(t)
  const binary = join(f.root, "packages/compiler/native/vibelang")
  mkdirSync(dirname(binary), { recursive: true })
  copyFileSync("/bin/true", binary)
  const before = statSync(binary).ino
  const run = spawnSync("sh", ["scripts/build-vibelang.sh"], { cwd: f.root,
    env: { ...f.env, NATIVE_TEST_FAIL: "1" }, encoding: "utf8" })
  assert.equal(run.status, 23, run.stdout + run.stderr)
  assert.equal(statSync(binary).ino, before)
  assert.deepEqual(readdirSync(dirname(binary)), ["vibelang"])
})
