import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const script = readFileSync(new URL("./check-typescript-shim.sh", import.meta.url), "utf8")

test("pnpm alias checks permit dprint builds before compiler execution", t => {
  const dir = mkdtempSync(join(tmpdir(), "release-shim-pnpm-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bin = join(dir, "bin")
  mkdirSync(bin)
  const npx = join(bin, "npx")
  writeFileSync(npx, `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path")
if (process.argv.includes("exec")) {
  let dir = process.cwd()
  while (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) && path.dirname(dir) !== dir) dir = path.dirname(dir)
  const config = path.join(dir, "pnpm-workspace.yaml")
  if (!fs.existsSync(config) || !/dprint: true/.test(fs.readFileSync(config, "utf8"))) {
    console.error("ERR_PNPM_IGNORED_BUILDS: dprint"); process.exit(23)
  }
  if (process.env.pnpm_config_registry !== "https://registry.invalid/") {
    console.error("pnpm registry was not configured"); process.exit(24)
  }
  if (process.argv.includes("--version")) console.log("VibeLang 0.0.12 (fixture)")
}
`)
  chmodSync(npx, 0o755)
  const registry = script.slice(script.indexOf('export npm_config_registry='), script.indexOf('effect=$(npm view'))
  const fixtures = script.slice(script.indexOf('step "pnpm installs the alias"'), script.indexOf('step "bun installs the alias"'))
  const result = spawnSync("sh", ["-c", 'set -eu\nregistry=https://registry.invalid/\nversion=0.0.12\nshim=7.1.12\neffect=4.1.1\n' +
    'scratch="$SHIM_TEST_ROOT"\nstep() { :; }\nhello() { mkdir -p "$1"; }\n' + registry + fixtures], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, PATH: bin + ":" + process.env.PATH, SHIM_TEST_ROOT: dir }
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
