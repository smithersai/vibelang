// run-seconds: 360
// rule-evidence: docs/design/src/007-tooling.md#the-effect-version | Without a configuration file, use the nearest ancestor `package.json`, stopping at the path root; if none exists, the diagnostic has no source location.
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-project-anchor-"))
const source = path.join(directory, "src/main.vibe")
const nearest = path.join(directory, "src/package.json")
const parent = path.join(directory, "package.json")

function expectedManifest() {
  for (let dir = path.dirname(source);;) {
    const manifest = path.join(dir, "package.json")
    if (fs.existsSync(manifest)) return manifest
    const next = path.dirname(dir)
    if (next === dir) return undefined
    dir = next
  }
}

function check() {
  const manifest = expectedManifest()
  const result = spawnSync(compiler, [
    "--noEmit", "--module", "NodeNext", "--target", "ES2022",
    "--skipLibCheck", "--types", "", "--pretty", "false", source
  ], { cwd: directory, encoding: "utf8", timeout: 120_000 })
  const output = (result.stdout ?? "") + (result.stderr ?? "")
  assert.ifError(result.error)
  assert.equal(result.signal, null, output)
  assert.notEqual(result.status, 0, output)
  const lines = output.split(/\r?\n/).filter(line => /error EK3201:/.test(line))
  assert.equal(lines.length, 1, output)
  const prefix = manifest
    ? path.relative(directory, manifest).replaceAll("\\", "/") + "(1,1): error EK3201:"
    : "error EK3201:"
  assert.ok(lines[0].replaceAll("\\", "/").startsWith(prefix), output)
}

try {
  fs.mkdirSync(path.dirname(source), { recursive: true })
  const effect = path.join(directory, "node_modules/effect")
  fs.mkdirSync(effect, { recursive: true })
  fs.writeFileSync(path.join(effect, "package.json"),
    JSON.stringify({ name: "effect", version: "0.0.0", types: "index.d.ts" }))
  fs.writeFileSync(path.join(effect, "index.d.ts"), "export declare const value: number\n")
  fs.writeFileSync(source, "export const value: number = 1\n")
  fs.writeFileSync(parent, JSON.stringify({ name: "parent-project" }))
  fs.writeFileSync(nearest, JSON.stringify({ name: "nearest-project" }))
  check()
  fs.rmSync(nearest)
  check()
  fs.rmSync(parent)
  check()
  console.log("project anchors verified")
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
