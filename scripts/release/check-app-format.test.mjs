import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const fc = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))("fast-check")

const script = readFileSync(new URL("./check-app.sh", import.meta.url), "utf8")
const rehearsal = readFileSync(new URL("./rehearse.sh", import.meta.url), "utf8")

function probe(t, manager, failure = "", exit = 23) {
  const dir = mkdtempSync(join(tmpdir(), "release-format-check-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, "bin"))
  // Stop before builds: exercise the real scaffold/install/format shell control
  // flow, with commands recording their calls and deterministic failures.
  const prefix = script.slice(0, script.indexOf('  step "run build"'))
  const check = join(dir, "check.sh")
  writeFileSync(check, prefix + '\ndone\n')
  const fake = join(dir, "bin/tool")
  writeFileSync(fake, `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path")
const name = path.basename(process.argv[1]), args = process.argv.slice(2)
fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({ name, args, cwd: process.cwd(), registry: process.env.pnpm_config_registry }) + "\\n")
if (["npm", "bun", "pnpm"].includes(name) && args[0] === "create") {
  const app = path.resolve(args[2])
  fs.mkdirSync(path.join(app, "node_modules/.bin"), { recursive: true })
  fs.mkdirSync(path.join(app, "src"))
  fs.writeFileSync(path.join(app, "src/main.vibe"), "export const value = 42\\n")
  for (const bin of ["vibelang", "vibelang-format", "dprint"]) fs.symlinkSync(process.env.PROBE_TOOL, path.join(app, "node_modules/.bin", bin))
}
if (name === "node") process.stdin.resume()
if (name === "vibelang") console.log("VibeLang 0.0.12 (fixture)")
if (name === "dprint") {
  const config = JSON.parse(fs.readFileSync("dprint.json", "utf8"))
  if (!config.plugins.includes("npm:vibelang/dprint-plugin.json")) process.exit(91)
  if (!config.plugins.some(p => p.startsWith("https://plugins.dprint.dev/typescript-"))) process.exit(92)
}
if (name === process.env.PROBE_FAILURE) process.exit(Number(process.env.PROBE_EXIT))
`)
  chmodSync(fake, 0o755)
  for (const name of ["npm", "bun", "pnpm", "node"]) symlinkSync(fake, join(dir, "bin", name))
  const log = join(dir, "calls.jsonl")
  const result = spawnSync("sh", [check, "https://registry.invalid/", "0.0.12", manager], {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, PATH: join(dir, "bin") + ":" + process.env.PATH,
      TMPDIR: dir, PROBE_LOG: log, PROBE_TOOL: fake, PROBE_FAILURE: failure, PROBE_EXIT: String(exit) }
  })
  return { result, calls: readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) }
}

for (const manager of ["npm", "bun", "pnpm"]) {
  test(`${manager} checks both installed formatter entry points`, t => {
    const { result, calls } = probe(t, manager)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const format = calls.find(c => c.name === "vibelang-format" && c.args[0] === "--check")
    assert.ok(format, "the installed formatter must run")
    assert.equal(format.args[0], "--check")
    assert.ok(format.args.some(arg => arg.includes("vibe")))
    const dprint = calls.find(c => c.name === "dprint")
    assert.ok(dprint, "the README dprint configuration must run")
    assert.equal(dprint.args[0], "check")
    if (manager === "pnpm") {
      assert.ok(calls.some(c => c.name === "pnpm" && c.args[0] === "create" && c.args[1] === "vibelang@0.0.12"))
      assert.equal(calls.find(c => c.name === "pnpm").registry, "https://registry.invalid/")
    }
  })
  for (const command of ["vibelang-format", "dprint"]) {
    test(`${manager} fails the rehearsal when ${command} fails`, t => {
      const { result } = probe(t, manager, command)
      assert.equal(result.status, 23, result.stdout + result.stderr)
    })
  }
}

test("the full release rehearsal includes pnpm", () => {
  assert.match(rehearsal, /check-app\.sh" "\$registry" "\$version" npm (?:bun pnpm|pnpm bun)/)
})

test("formatter failures preserve arbitrary nonzero exits across package managers", t => {
  fc.assert(fc.property(fc.constantFrom("npm", "bun", "pnpm"),
    fc.constantFrom("vibelang-format", "dprint"), fc.integer({ min: 1, max: 125 }),
    (manager, command, exit) => {
      const { result } = probe(t, manager, command, exit)
      assert.equal(result.status, exit, result.stdout + result.stderr)
    }), { seed: 110708, numRuns: 15 })
})

test("installed-package verification resolves an unhoisted optional platform package", t => {
  const dir = mkdtempSync(join(tmpdir(), "package-platform-layout-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, "package.json"), "{}\n")
  const modules = join(dir, "node_modules")
  const slot = join(modules, ".pnpm/vibelang@0.0.12_effect@4.1.1/node_modules")
  const compiler = join(slot, "vibelang")
  mkdirSync(join(compiler, "editor"), { recursive: true })
  mkdirSync(join(slot, "vibelang-linux-x64"), { recursive: true })
  mkdirSync(join(modules, "vibelang-runtime/dist"), { recursive: true })
  mkdirSync(join(modules, "vibelang-vite"), { recursive: true })
  mkdirSync(join(modules, "effect"), { recursive: true })
  for (const path of [compiler, join(slot, "vibelang-linux-x64"),
    join(modules, "vibelang-runtime"), join(modules, "vibelang-vite")]) {
    writeFileSync(join(path, "package.json"), JSON.stringify({ version: "0.0.12" }))
  }
  writeFileSync(join(compiler, "editor/vibelang.vsix"), "")
  writeFileSync(join(modules, "vibelang-runtime/dist/index.js"), "")
  writeFileSync(join(modules, "effect/index.js"), "")
  symlinkSync(compiler, join(modules, "vibelang"), process.platform === "win32" ? "junction" : "dir")
  const check = script.split("<<'JS'\n")[1].split("\nJS")[0]
  assert.ok(check, "execute the installed-package verification from check-app")
  const result = spawnSync(process.execPath, ["--input-type=module", "-", "0.0.12", "linux-x64"],
    { cwd: dir, input: check, encoding: "utf8", timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /one copy of effect/)
  writeFileSync(join(compiler, "format.mjs"), "// fixture\n")
  const mismatched = spawnSync(process.execPath, ["--input-type=module", "-", "0.0.12", "linux-x64"],
    { cwd: dir, input: check, encoding: "utf8", timeout: 10000,
      env: { ...process.env, VIBELANG_REHEARSAL_FORMAT_SHA256: "0".repeat(64) } })
  assert.notEqual(mismatched.status, 0, "a public package with the same version must not stand in for the candidate")
  assert.match(mismatched.stderr, /formatter checksum/)

})
