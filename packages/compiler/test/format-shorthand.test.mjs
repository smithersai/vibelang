// docs/design/src/001-functions.md, Syntax: no top-level shorthand; `effect load() { }`
// and `async load() { }` outside a class or object literal are EK0101; insert `function`.
// docs/design/vips/0034-compiler-and-tooling.md, One formatter: formatting preserves
// diagnostic codes, categories and occurrences and does not apply diagnostic repairs.
import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { formatSource } from "../format.mjs"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(root, "packages/compiler/native/vibelang")

test("format preserves shorthand diagnostics", t => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-format-shorthand-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(join(root, "packages/runtime/node_modules/effect"), join(dir, "node_modules/effect"), "dir")
  symlinkSync(join(root, "packages/runtime"), join(dir, "node_modules/vibelang-runtime"), "dir")
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "esnext", module: "nodenext", skipLibCheck: true, noEmit: true },
    files: ["main.vibe"]
  }))
  const path = join(dir, "main.vibe")
  const source = 'export effect work(){return 1}\nexport async wait(){return 2}\n'
  const compile = (...args) => {
    const result = spawnSync(binary, ["-p", dir, "--pretty", "false", ...args], { encoding: "utf8", timeout: 60_000 })
    assert.ifError(result.error)
    return { ...result, text: result.stdout + result.stderr }
  }
  writeFileSync(path, source)
  const before = compile()
  assert.equal(before.status, 2, before.text)
  assert.match(before.text, /function/, "the diagnostic explains the mechanical function-keyword repair")
  assert.equal((before.text.match(/error EK0101:/g) ?? []).length, 2, before.text)
  const formatted = formatSource(source, path)
  assert.doesNotMatch(formatted, /\bfunction\b/, "formatting must preserve the missing-function diagnostic")
  assert.equal(formatSource(formatted, path), formatted, "formatting is idempotent")
  writeFileSync(path, formatted)
  const after = compile()
  assert.equal(after.status, 2, after.text)
  assert.equal((after.text.match(/error EK0101:/g) ?? []).length, 2, after.text)
})
