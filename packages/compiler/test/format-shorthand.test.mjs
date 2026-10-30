import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { formatSource } from "../format.mjs"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(root, "packages/compiler/native/vibelang")

test("format preserves shorthand diagnostics; --fix alone migrates declarations", t => {
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
  assert.equal((before.text.match(/error EK4618:/g) ?? []).length, 2, before.text)
  const formatted = formatSource(source, path)
  assert.doesNotMatch(formatted, /\bfunction\b/, "formatting must preserve the missing-function diagnostic")
  assert.equal(formatSource(formatted, path), formatted, "formatting is idempotent")
  writeFileSync(path, formatted)
  const after = compile()
  assert.equal(after.status, 2, after.text)
  assert.equal((after.text.match(/error EK4618:/g) ?? []).length, 2, after.text)
  const fixed = compile("--fix", "--fix-vip-only")
  assert.equal(fixed.status, 0, fixed.text)
  assert.doesNotMatch(fixed.text, /(?:error|warning) EK4618:/)
  assert.match(readFileSync(path, "utf8"), /\beffect function work\b/)
  assert.match(readFileSync(path, "utf8"), /\basync function wait\b/)
})
