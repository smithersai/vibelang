import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(root, "packages/compiler/native/vibelang")

function preview(t, compilerOptions, base, rootOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-show-config-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, "main.ts"), "export const value = 1\n")
  if (base) writeFileSync(join(dir, "base.json"), JSON.stringify({ compilerOptions: base }))
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    ...rootOptions, ...(base ? { extends: "./base.json" } : {}), compilerOptions, files: ["main.ts"]
  }))
  const result = spawnSync(binary, ["--showConfig", "-p", dir, "--pretty", "false"], {
    encoding: "utf8", timeout: 60_000
  })
  assert.ifError(result.error)
  return result
}

test("--showConfig reports invalid option values instead of printing a partial configuration", t => {
  const result = preview(t, { strict: "yes", target: "not-a-target" })
  const output = result.stdout + result.stderr
  assert.notEqual(result.status, 0, output)
  assert.match(output, /strict/)
  assert.match(output, /target/)
  assert.doesNotMatch(output, /"compilerOptions"\s*:/)
})

test("--showConfig reports errors inherited from a base configuration", t => {
  const result = preview(t, {}, { strict: "yes" })
  const output = result.stdout + result.stderr
  assert.notEqual(result.status, 0, output)
  assert.match(output, /strict/)
  assert.doesNotMatch(output, /"compilerOptions"\s*:/)
})

test("--showConfig reports invalid legacy VibeLang settings", t => {
  const result = preview(t, { vibelang: { tracing: "loud" } })
  const output = result.stdout + result.stderr
  assert.notEqual(result.status, 0, output)
  assert.match(output, /vibelang.tracing/)
  assert.doesNotMatch(output, /"compilerOptions"\s*:/)
})

test("--showConfig preserves valid resolved settings and succeeds", t => {
  const result = preview(t, { strict: true, target: "esnext" })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const config = JSON.parse(result.stdout)
  assert.equal(config.compilerOptions.strict, true)
  assert.equal(config.compilerOptions.target, "esnext")
  assert.equal(config.files.length, 1)
})

test("--showConfig succeeds with a migration warning and keeps stdout as JSON", t => {
  const result = preview(t, { vibelang: { diagnostics: { EK4801: "warning" } } })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(JSON.parse(result.stdout).files.length, 1)
})

test("--showConfig fails when a migration warning is promoted to an error", t => {
  const result = preview(t, { vibelang: { diagnostics: { EK4801: "warning" } } }, undefined,
    { vibe: { severities: { EK3009: "error" } } })
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout + result.stderr, /EK3009/)
  assert.doesNotMatch(result.stdout, /"compilerOptions"\s*:/)
})
