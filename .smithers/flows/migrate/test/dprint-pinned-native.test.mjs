import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

test("pinned formatter repair formats VibeLang and preserves the TypeScript control", t => {
  const repo = fileURLToPath(new URL("../../../../", import.meta.url))
  const compiler = process.env.VIBELANG_BINARY ?? join(repo, "packages/compiler/native/vibelang")
  const dprint = process.env.VIBELANG_DPRINT ?? join(repo, "packages/compiler/node_modules/.bin/dprint")
  assert.ok(existsSync(compiler), "build the native compiler for this regression")
  assert.ok(existsSync(dprint), "install dprint for this regression")
  const manifest = spawnSync(compiler, ["--write-dprint-plugin", join(repo, "packages/compiler")], { encoding: "utf8" })
  assert.equal(manifest.status, 0, manifest.stdout + manifest.stderr)
  const root = mkdtempSync(join(tmpdir(), "pinned-format-native-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const plugin = "https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a"
  const typescript = "export const original = 1\n"
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { fmt: "dprint fmt", check: "dprint check" } }))
  writeFileSync(join(root, "dprint.json"), JSON.stringify({
    includes: ["**/*.{ts,vibe}"], excludes: ["node_modules"],
    typescript: { semiColons: "asi" },
    plugins: [plugin, "npm:vibelang/dprint-plugin.json"]
  }))
  writeFileSync(join(root, "control.ts"), typescript)
  writeFileSync(join(root, "source.vibe"), "export const value    =    { a:1,b:2 };\n")
  wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) })
  const config = JSON.parse(readFileSync(join(root, "dprint.json")))
  assert.deepEqual(config.plugins, [plugin])
  assert.ok(config.plugins.every(value => /@[0-9a-f]{64}$/.test(value)))
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  symlinkSync(dprint, join(root, "node_modules/.bin/dprint"))
  symlinkSync(join(repo, "packages/compiler/bin/vibelang-format"), join(root, "node_modules/.bin/vibelang-format"))
  const pkg = JSON.parse(readFileSync(join(root, "package.json")))
  const run = name => spawnSync("sh", ["-c", pkg.scripts[name]], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: compiler, PATH: join(root, "node_modules/.bin") + ":" + process.env.PATH }
  })
  const before = run("check")
  assert.notEqual(before.status, 0, before.stdout + before.stderr)
  assert.match(before.stdout + before.stderr, /source\.vibe/)
  const formatted = run("fmt")
  assert.equal(formatted.status, 0, formatted.stdout + formatted.stderr)
  assert.equal(readFileSync(join(root, "source.vibe"), "utf8"), "export const value = { a: 1, b: 2 }\n")
  assert.equal(readFileSync(join(root, "control.ts"), "utf8"), typescript)
  const after = run("check")
  assert.equal(after.status, 0, after.stdout + after.stderr)
  assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) }).changed, [])
})
