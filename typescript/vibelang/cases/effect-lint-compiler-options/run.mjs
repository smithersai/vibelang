import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name this workspace's compiler")
const dir = mkdtempSync(join(tmpdir(), "vip38-lint-options-"))
try {
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], target: "ES2022", module: "NodeNext" }, files: ["main.vibe"], vibe: { effectGlobals: false, effectModules: false } }))
  const source = "export const value = 1\n"
  writeFileSync(join(dir, "main.vibe"), source)
  const invoke = args => {
    const r = spawnSync(binary, args, { cwd: dir, encoding: "utf8", timeout: 15000 })
    assert.equal(r.error, undefined, String(r.error))
    assert.equal(r.signal, null, r.stdout + r.stderr)
    return r
  }
  for (const args of [
    ["-p", "tsconfig.json"],
    ["--project", ".", "--strict", "--noEmit", "--target", "ES2022"],
    ["--strict", "--noEmit", "--target", "ES2022", "main.vibe"]
  ]) {
    const r = invoke(["lint", ...args])
    assert.equal(r.status, 0, JSON.stringify(args) + "\n" + r.stdout + r.stderr)
    assert.equal(readdirSync(dir).some(name => name.endsWith(".d.vibe.ts") || name.endsWith(".js")), false)
  }
  const issues = []
  for (const args of [["--fix"], ["--config", "anything.json"], ["--not-a-compiler-option"]]) {
    const r = invoke(["lint", ...args])
    try {
    assert.notEqual(r.status, 0, JSON.stringify(args))
    assert.match(r.stdout + r.stderr, /TS5023/, JSON.stringify(args))
    assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), source)
    } catch (error) { issues.push(error) }
  }
  if (issues.length) throw new AggregateError(issues, "VIP-38 rejected lint options")
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log("lint compiler options")
