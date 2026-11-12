import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const native = { skip: process.platform === "win32" && "C parser builds run under WSL" }

async function fixture(t, packaged = false) {
  const root = mkdtempSync(join(tmpdir(), "vibex-ast-grep-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modulePath = join(root, "packages/compiler/ast-grep.mjs")
  mkdirSync(dirname(modulePath), { recursive: true })
  cpSync(new URL("../ast-grep.mjs", import.meta.url), modulePath)
  const grammarRoot = packaged ? join(dirname(modulePath), "tree-sitter") : join(root, "editors/tree-sitter-vibelang")
  mkdirSync(grammarRoot, { recursive: true })
  const { buildAstGrep } = await import(pathToFileURL(modulePath))
  const build = (paths, legacy = false) => {
    const grammars = paths.map((path, i) => ({ name: i ? "vibex" + i : "vibe", path, "file-types": [i ? "vibex" : "vibe"] }))
    if (!legacy) writeFileSync(join(grammarRoot, "tree-sitter.json"), JSON.stringify({ grammars }))
    for (const { name, path } of grammars) {
      const src = legacy ? grammarRoot : join(grammarRoot, path, "src")
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, "parser.c"), `int tree_sitter_${name}(void) { return 1; }\n`)
      writeFileSync(join(src, "scanner.c"), `int ${name}_scan(void) { return 1; }\n`)
    }
    const library = buildAstGrep(join(root, "parser.so"))
    const symbols = execFileSync("nm", ["-g", library], { encoding: "utf8" })
    for (const { name } of grammars) assert.ok(symbols.includes("tree_sitter_" + name), symbols)
  }
  return build
}

for (const packaged of [false, true]) {
  test(`ast-grep builds every registered parser from ${packaged ? "the npm package" : "a checkout"}`, native, async t => {
    const build = await fixture(t, packaged)
    build([".", "vibex"])
  })
}
test("ast-grep still builds a legacy flat packaged parser", native, async t => {
  const build = await fixture(t, true)
  build(["."], true)
})
test("generated grammar layouts preserve every exported parser symbol", native, async t => {
  // The developer-tools contract: compile every registered parser, rather
  // than guessing a source path from the compiler's current first grammar.
  const docs = readFileSync(new URL("../../../docs/user/src/setup/developer-tools.md", import.meta.url), "utf8")
  assert.ok(docs.includes("compiles every parser declared by") && docs.includes("into one shared library."))
  const build = await fixture(t)
  fc.assert(fc.property(fc.uniqueArray(fc.constantFrom("vibex", "nested/tsx", "other"), { minLength: 1, maxLength: 3 }), paths => {
    build([".", ...paths])
  }), { seed: 3912, numRuns: 12 })
})

const astGrepBin = fileURLToPath(new URL("../bin/vibelang-ast-grep", import.meta.url))
const emptyDir = t => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-ast-grep-cli-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test("vibelang-ast-grep --help and -h print usage and write no file", t => {
  const dir = emptyDir(t)
  for (const flag of ["--help", "-h"]) {
    const result = spawnSync(process.execPath, [astGrepBin, flag], { cwd: dir, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^Usage: vibelang-ast-grep \[output\]/)
  }
  assert.deepEqual(readdirSync(dir), [])
})

test("vibelang-ast-grep refuses any other option or extra argument with usage and status 2", t => {
  const dir = emptyDir(t)
  const option = fc.array(fc.constantFrom(..."abcdhvxyz=-0"), { maxLength: 8 }).map(chars => "-" + chars.join(""))
    .filter(arg => arg !== "-h" && arg !== "--help")
  const argv = fc.oneof(option.map(arg => [arg]), fc.tuple(option, fc.constantFrom("out.so", "--help")),
    fc.constant(["a.so", "b.so"]), fc.constant(["--help", "-h"]))
  fc.assert(fc.property(argv, args => {
    const result = spawnSync(process.execPath, [astGrepBin, ...args], { cwd: dir, encoding: "utf8" })
    assert.equal(result.status, 2, JSON.stringify(args))
    assert.match(result.stderr, /^Usage: vibelang-ast-grep \[output\]/)
    assert.deepEqual(readdirSync(dir), [], JSON.stringify(args))
  }), { seed: 1013, numRuns: 12 })
})
