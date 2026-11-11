import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repository = fileURLToPath(new URL("../../", import.meta.url))
const cases = ["uninterruptible-using", "conditional-record-environment", "vibelang-config",
  "ambient-schema-data-owner.fail", "tooling-format-lsp-sidecar", "appendix-interim-ek4202-ek4406-unreached"]
const inputCases = new Set([...cases, "ek4401-fix.fail"])
// Do not follow fixture links or installed dependencies while changing modes.
// Keep executable bits so the copied compiler still runs.
function permissions(dir, writable) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) permissions(file, writable)
    else if (!entry.isSymbolicLink()) {
      fs.chmodSync(file, fs.statSync(file).mode & ~0o222 | (writable ? 0o200 : 0))
    }
  }
  fs.chmodSync(dir, writable ? 0o755 : 0o555)
}
function snapshot(dir) {
  const records = []
  const visit = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(at, entry.name), stat = fs.lstatSync(file)
      records.push([path.relative(dir, file), stat.mode, stat.mtimeMs, stat.ctimeMs, entry.isSymbolicLink() ? fs.readlinkSync(file) :
        entry.isFile() ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "directory"])
      if (entry.isDirectory()) visit(file)
    }
  }
  visit(dir)
  return records
}

test("real compiler cases leave a read-only checkout unchanged", { timeout: 300_000 }, t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-readonly-"))
  const copy = path.join(temp, "checkout"), scratch = path.join(temp, "scratch")
  t.after(() => {
    if (fs.existsSync(copy)) permissions(copy, true)
    fs.rmSync(temp, { recursive: true, force: true })
  })
  // Copy source inputs and built tools, never repository metadata, old results
  // or installations. Dependency links remain read-only inputs from the caller.
  fs.cpSync(repository, copy, {
    recursive: true, verbatimSymlinks: true,
    filter: file => {
      const relative = path.relative(repository, file), parts = relative.split(path.sep)
      if (parts.some(part => [".git", ".jj", "node_modules", ".cache", ".flows", "out"].includes(part) ||
        part.startsWith(".smthrs-"))) return false
      if (parts.slice(0, 3).join("/") === "typescript/vibelang/cases" && parts.length >= 4 &&
        fs.lstatSync(file).isDirectory() && !inputCases.has(parts[3])) return false
      return true
    },
  })
  for (const dir of ["docs/tools", "experiments", "packages/compiler", "packages/runtime", "packages/ts-mapper/test/.cache"]) {
    const modules = path.join(repository, dir, "node_modules")
    if (!fs.existsSync(modules)) continue
    const at = path.join(copy, dir, "node_modules")
    fs.mkdirSync(path.dirname(at), { recursive: true })
    fs.symlinkSync(fs.realpathSync(modules), at, "dir")
  }
  if (process.env.HARNESS_READONLY_MODULE) {
    fs.copyFileSync(process.env.HARNESS_READONLY_MODULE, path.join(copy, "typescript/vibelang/harness.mjs"))
  }
  fs.mkdirSync(scratch)
  permissions(copy, false)
  const before = snapshot(copy)
  // Assert the mode bits even on a privileged test runner. The hash comparison
  // also detects mutations when the OS lets such a runner bypass permissions.
  assert.equal(fs.statSync(copy).mode & 0o222, 0)
  const result = spawnSync(process.execPath, [
    path.join(copy, "typescript/vibelang/harness.mjs"), "--isolated", "--jobs", "2", ...cases,
  ], {
    cwd: copy, encoding: "utf8", timeout: 240_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, TMPDIR: scratch, EFFECT_NODE_MODULES: fs.realpathSync(process.env.EFFECT_NODE_MODULES ?? path.join(repository, "experiments/node_modules")),
      VIBELANG_RUNTIME: path.join(copy, "packages/runtime") },
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /6 cases: 6 ok, 0 FAIL, 0 pending/)
  assert.deepEqual(snapshot(copy), before, "a repository path changed")
  assert.deepEqual(fs.readdirSync(scratch), [], "successful scratch tree was not removed")
})
