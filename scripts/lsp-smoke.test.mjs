import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stripTypeScriptTypes } from "node:module"
import { spawnSync } from "node:child_process"
import { runInNewContext } from "node:vm"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const read = (file) => readFileSync(new URL(file, root), "utf8")

test("LSP smoke is a cached compiler-suite target with editor and fixture inputs", () => {
  const source = stripTypeScriptTypes(read("typescript/vibelang/PACKAGE.ts"))
    .replace(/^import .*$/gm, "")
    .replace("export const Package", "globalThis.result")
  const compiler = { compiler: true }, runtime = { runtime: true }, published = { published: true }
  const context = {
    S: { Shell: { Test: (spec) => spec }, file: (file) => file, glob: (glob) => glob,
      Filegroup: (spec) => spec, Package: (spec) => spec, Host: { bin: (bin) => bin } },
    Typescript: { compiler }, Packages: { "runtime-dist": runtime, "runtime-published": published },
    readdirSync, existsSync, join, dirname: () => new URL("typescript/vibelang/", root).pathname,
    fileURLToPath: () => "", importMetaUrl: ""
  }
  runInNewContext(source.replaceAll("import.meta.url", "importMetaUrl"), context)
  const target = context.result.targets["lsp-smoke"]
  assert.ok(target, "the compiler-suite wildcard must select an LSP smoke target")
  assert.ok(target.data.includes(compiler), "compiler input includes the Go language server")
  assert.ok(target.data.includes(runtime))
  assert.ok(target.data.includes(published))
  for (const input of ["lsp-smoke.sh", "lsp-smoke.mjs", "lsp-fixture/**",
    "//experiments/package.json", "//experiments/bun.lock", "//packages/runtime/bun.lock"]) {
    assert.ok(target.data.includes(input), "missing cache input: " + input)
  }
  assert.match(target.shell, /sh typescript\/vibelang\/lsp-smoke\.sh --no-build/)
  assert.equal(target.sandbox, "none")
  assert.ok(target.tools.includes("node"))
})

test("the graph's no-build smoke path uses prepared outputs without rebuilding the runtime", () => {
  const temp = mkdtempSync(join(tmpdir(), "vibelang-lsp-graph-"))
  try {
    for (const dir of ["typescript/vibelang/lsp-fixture", "typescript/built/local", "experiments/node_modules/effect",
      "packages/runtime", "bin"]) mkdirSync(join(temp, dir), { recursive: true })
    writeFileSync(join(temp, "typescript/vibelang/lsp-smoke.sh"), read("typescript/vibelang/lsp-smoke.sh"))
    writeFileSync(join(temp, "typescript/built/local/tsc"), '#!/bin/sh\ncase "$1" in\n--version) echo "VibeLang 0.0.12 (TypeScript 7)" ;;\n--help) echo "vibelang: The VibeLang Compiler - Version 0.0.12" ;;\n*) echo "unexpected compiler build" >&2; exit 91 ;;\nesac\n', { mode: 0o755 })
    writeFileSync(join(temp, "bin/go"), '#!/bin/sh\necho "unexpected Go build" >&2\nexit 92\n', { mode: 0o755 })
    writeFileSync(join(temp, "typescript/vibelang/lsp-smoke.mjs"), `
import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
assert.ok(process.argv[2].endsWith("/typescript/built/local/tsc"))
assert.equal(realpathSync(new URL("./lsp-fixture/node_modules/effect", import.meta.url)), realpathSync("experiments/node_modules/effect"))
assert.equal(realpathSync(new URL("./lsp-fixture/node_modules/vibelang-runtime", import.meta.url)), realpathSync("packages/runtime"))
console.log("ok   prepared smoke")
`)
    const result = spawnSync("sh", ["typescript/vibelang/lsp-smoke.sh", "--no-build"], {
      cwd: temp, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: join(temp, "bin") + ":" + process.env.PATH }
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /ok   prepared smoke/)
    assert.equal(existsSync(join(temp, "packages/runtime/node_modules")), false, "shared runtime install stays untouched")
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("a failed editor check leaves later checks running and names every failure", () => {
  const source = read("typescript/vibelang/lsp-smoke.mjs")
  const checker = source.slice(source.indexOf("let failures = 0"), source.indexOf('console.log(`server:'))
  const lines = []
  const context = { console: { log: (line) => lines.push(line) } }
  return runInNewContext(checker + `
(async () => {
  await check("hover: first failure", () => { throw new Error("first reason") })
  await check("quickfix: second failure", () => { throw new Error("second reason") })
  await check("shutdown: later check", () => {})
  return failures
})()
`, context).then((failures) => {
    assert.equal(failures, 2)
    assert.deepEqual(lines, [
      "FAIL hover: first failure: first reason",
      "FAIL quickfix: second failure: second reason",
      "ok   shutdown: later check"
    ])
  })
})
