import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")

// A malformed stub must fail closed rather than falling through to the host Go.
const commands = Object.fromEntries(["sh", "dirname", "basename", "mkdir", "mktemp", "mv", "rm", "date", "uname", "wc", "tr", "cat"]
  .map(name => [name, execFileSync("sh", ["-c", "command -v " + name], { encoding: "utf8" }).trim()]))

const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]
function fixture(t, failures = {}, missing = []) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-binary-status-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ["scripts/release", "packages/compiler", "typescript/tsc", "fake-bin"]) mkdirSync(join(root, dir), { recursive: true })
  const script = join(root, "scripts/release/build-binaries.sh")
  copyFileSync(fileURLToPath(new URL("./build-binaries.sh", import.meta.url)), script)
  copyFileSync(fileURLToPath(new URL("../native-output.sh", import.meta.url)), join(root, "scripts/native-output.sh"))
  writeFileSync(join(root, "packages/compiler/package.json"), JSON.stringify({ version: "0.0.11" }))
  const fakeGo = join(root, "fake-bin/go")
  writeFileSync(fakeGo, "#!" + process.execPath + String.fromCharCode(10) + [
    'const fs = require("node:fs")',
    'const platform = (process.env.GOOS === "windows" ? "win32" : process.env.GOOS) + "-" + (process.env.GOARCH === "amd64" ? "x64" : process.env.GOARCH)',
    'const failures = JSON.parse(process.env.TEST_BUILD_FAILURES)',
    'if (failures[platform] === "kill") process.kill(process.pid, "SIGKILL")',
    'if (failures[platform]) process.exit(failures[platform])',
    'if (JSON.parse(process.env.TEST_BUILD_MISSING).includes(platform)) process.exit(0)',
    'const out = process.argv[process.argv.indexOf("-o") + 1]',
    'fs.writeFileSync(out, ["#!/bin/sh", "echo " + JSON.stringify("VibeLang 0.0.11 (test fixture)"), ""].join(String.fromCharCode(10)))',
    'fs.chmodSync(out, 0o755)',
  ].join(String.fromCharCode(10)) + String.fromCharCode(10))
  chmodSync(fakeGo, 0o755)
  for (const [name, path] of Object.entries({ ...commands, node: process.execPath })) symlinkSync(path, join(root, "fake-bin", name))
  return { root, script, env: { ...process.env, PATH: join(root, "fake-bin"),
    TEST_BUILD_FAILURES: JSON.stringify(failures), TEST_BUILD_MISSING: JSON.stringify(missing) } }
}
function build(f) {
  return spawnSync("sh", [f.script, "--local"], { env: f.env, encoding: "utf8", timeout: 20_000 })
}

function receipt(f, platform) {
  return Object.fromEntries(readFileSync(join(f.root, "dist-npm/bin", platform + ".status"), "utf8")
    .split(String.fromCharCode(10)).filter(Boolean).map(line => line.split("=")))
}

test("a silent cross-build failure names its platform and records every target exit", t => {
  const f = fixture(t, { "linux-arm64": 23, "win32-arm64": 137 })
  const result = build(f)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /linux-arm64 failed.*exit 23/)
  assert.match(result.stderr, /win32-arm64 failed.*exit 137/)
  assert.match(result.stderr, /win32-arm64.*without diagnostic output/)
  for (const platform of platforms) {
    const status = receipt(f, platform)
    assert.match(status.completed, /Z$/)
    const code = platform === "linux-arm64" ? 23 : platform === "win32-arm64" ? 137 : 0
    assert.equal(status.exit, String(code))
  }
})

test("a successful Go exit without a binary is reported against its target", t => {
  const f = fixture(t, {}, ["win32-arm64"])
  const result = build(f)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /win32-arm64.*success without.*binary/)
  assert.equal(receipt(f, "win32-arm64").exit, "1")
})

test("a successful matrix keeps six completion records and checks the host version", t => {
  const f = fixture(t)
  const result = build(f)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /prints: VibeLang 0.0.11/)
  for (const platform of platforms) assert.equal(receipt(f, platform).exit, "0")
})

test("signal deaths and arbitrary target failures keep their identity and nonzero exit", t => {
  fc.assert(fc.property(fc.constantFrom(...platforms), fc.oneof(fc.integer({ min: 1, max: 255 }), fc.constant("kill")), (platform, failure) => {
    const f = fixture(t, { [platform]: failure })
    const result = build(f)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    const expected = failure === "kill" ? 137 : failure
    assert.match(result.stderr, new RegExp(platform + " failed.*exit " + expected))
    for (const target of platforms) assert.equal(receipt(f, target).exit, String(target === platform ? expected : 0))
  }), { numRuns: 20, seed: 110017, examples: [["win32-arm64", "kill"], ["linux-arm64", 23], ["darwin-x64", 255]] })
})
