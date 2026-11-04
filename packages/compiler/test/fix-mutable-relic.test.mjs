import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const source = [
  "export interface Values { /* field */ mutable value: number; readonly fixed?: string; mutable?: boolean }",
  "export interface Documented {",
  "  mutable /** field docs */ item: number;",
  "  mutable /** index docs */ [key: string]: number;",
  "}",
  "export type Dictionary = { mutable [mutable: string]: number }",
  'const key = "value" as const;',
  "export type Nested = { mutable [key]?: { mutable inner: number } }",
  "",
].join("\n")
const expected = source
  .replace("mutable value", "value")
  .replace("mutable /** field docs */ item", " item")
  .replace("mutable /** index docs */ [key:", " [key:")
  .replace("mutable [mutable", "[mutable")
  .replace("mutable [key]", "[key]")
  .replace("mutable inner", "inner")

for (const scope of [[], ["--fix-migration-only"]]) {
  test("--fix removes redundant mutable markers and preserves declaration bytes " + scope.join(" "), (t) => {
    assert.ok(existsSync(native), "build the native compiler before running this test")
    const root = mkdtempSync(join(tmpdir(), "vibelang-mutable-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "out"))
    writeFileSync(join(root, "main.vibe"), source)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], declaration: true, emitDeclarationOnly: true, outDir: "out" },
      vibe: { effectModules: false, effectGlobals: false },
      files: ["main.vibe"],
    }))
    const run = (...args) => {
      const result = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false", ...args], { cwd: root, encoding: "utf8", timeout: 60000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return result
    }
    run()
    const before = readFileSync(join(root, "out/main.d.ts"), "utf8")
    run("--fix", ...scope)
    const fixed = readFileSync(join(root, "main.vibe"), "utf8")
    assert.ok(fixed.startsWith(expected), fixed)
    for (const comment of ["/** field docs */", "/** index docs */"]) assert.ok(fixed.includes(comment), fixed)
    assert.equal(readFileSync(join(root, "out/main.d.ts"), "utf8"), before)
    const second = run("--fix", ...scope)
    assert.match(second.stdout, /0 fixes in 0 files/)
    assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), fixed)
  })
}
