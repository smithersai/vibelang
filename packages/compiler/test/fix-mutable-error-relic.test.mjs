import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const runtime = join(repo, "packages/runtime")
const source = [
  "export error Failure { /** payload */ mutable /* field */ value: number; readonly fixed?: string; readonly?: string; /* trailing */ }",
  "export error DocumentedFailure {",
  " /** declared payload */ mutable value: number;",
  " /** other doc */ fixed?: string;",
  "}",
  "export effect function main() {",
  " const value = new Failure({ value: 7 });",
  ' const other = { _tag: "Failure", value: 8 } as unknown as Failure;',
  " return [value.value, value._tag, match (other) { when Failure(let found): found.value; default: -1; }];",
  "}",
  "",
].join("\n")

for (const scope of [[], ["--fix-migration-only"]]) {
  test("--fix preserves mutable error payload bytes and matching " + scope.join(" "), (t) => {
    assert.ok(existsSync(native), "build the native compiler before running this test")
    assert.ok(existsSync(join(runtime, "dist/entry.js")), "build the runtime before running this test")
    const root = mkdtempSync(join(tmpdir(), "vibelang-mutable-error-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "node_modules"))
    symlinkSync(realpathSync(join(runtime, "node_modules/effect")), join(root, "node_modules/effect"))
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "main.vibe"), source)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], declaration: true, outDir: "out" },
      files: ["main.vibe"],
    }))
    const compile = (...args) => {
      const result = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false", ...args], { cwd: root, encoding: "utf8", timeout: 60000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return result
    }
    const exit = () => {
      const script = 'import { Effect } from "effect"; import { main } from "./out/main.js"; console.log(JSON.stringify(await Effect.runPromiseExit(main())))'
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8", timeout: 60000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return result.stdout.trim()
    }
    compile()
    const api = readFileSync(join(root, "out/main.d.ts"), "utf8")
    const before = exit()
    assert.deepEqual(JSON.parse(before).value, [7, "Failure", 8])
    const receipt = compile("--fix", ...scope)
    const fixed = readFileSync(join(root, "main.vibe"), "utf8")
    assert.doesNotMatch(fixed, /mutable\s+value/, receipt.stdout + receipt.stderr)
    assert.match(fixed, /class Failure extends \$MutableErrorBase/)
    for (const comment of ["/** payload */", "/* field */", "/* trailing */"]) assert.ok(fixed.includes(comment), fixed)
    assert.equal(readFileSync(join(root, "out/main.d.ts"), "utf8"), api)
    assert.equal(exit(), before)
    assert.match(compile("--fix", ...scope).stdout, /0 fixes in 0 files/)
  })
}

test("--fix preserves matching through a reassigned constructor alias", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-mutable-error-alias-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(runtime, "node_modules/effect")), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const aliased = [
    "export error Failure { mutable value: number }",
    "class Sub extends Failure {}",
    "let Alias = Failure;",
    "Alias = Sub;",
    "export effect function main() {",
    ' const other = { _tag: "Failure", value: 8 } as unknown as Failure;',
    " return match (other) { when Alias(let found): found.value; default: -1; };",
    "}",
    "",
  ].join("\n")
  writeFileSync(join(root, "main.vibe"), aliased)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], declaration: true, outDir: "out" },
    files: ["main.vibe"],
  }))
  const compile = (...args) => {
    const result = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false", ...args], { cwd: root, encoding: "utf8", timeout: 60000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result
  }
  const exit = () => {
    const script = 'import { Effect } from "effect"; import { main } from "./out/main.js"; console.log(JSON.stringify(await Effect.runPromiseExit(main())))'
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8", timeout: 60000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout.trim()
  }
  compile()
  const api = readFileSync(join(root, "out/main.d.ts"), "utf8")
  const before = exit()
  assert.equal(JSON.parse(before).value, -1)
  compile("--fix", "--fix-migration-only")
  assert.equal(readFileSync(join(root, "out/main.d.ts"), "utf8"), api)
  assert.equal(exit(), before)
  assert.doesNotMatch(readFileSync(join(root, "main.vibe"), "utf8"), /mutable\s+value/)

})
