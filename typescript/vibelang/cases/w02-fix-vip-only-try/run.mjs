// run-seconds: 300
import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const modules = fileURLToPath(new URL("./node_modules", import.meta.url))
const roots = []
// project writes files into a new temporary project that resolves the case's
// packages, and returns its directory.
function project(files, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w02-case-"))
  roots.push(root)
  fs.symlinkSync(modules, path.join(root, "node_modules"), "dir")
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n')
  fs.writeFileSync(path.join(root, "tsconfig.json"), typeof config === "string" ? config : JSON.stringify(config))
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
  }
  return root
}
// snapshot reads every file under root but node_modules, by relative name.
function snapshot(root) {
  const texts = {}
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue }
      if (entry.isFile()) texts[path.relative(root, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8")
    }
  }
  walk(root)
  return texts
}
// changed names the files whose bytes differ between two snapshots.
function changed(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name] !== after[name]).sort()
}
// edited names the changed sources and configs, leaving out what the
// compilation after --fix writes: declaration sidecars and out/.
function edited(before, after) {
  return changed(before, after).filter((name) => !/\.d\.vibex?\.ts$/.test(name) && !name.startsWith("out/"))
}
function run(cwd, ...args) {
  const r = spawnSync(binary, args, { cwd, encoding: "utf8", timeout: 120000 })
  assert.equal(r.error, undefined, String(r.error))
  return { status: r.status, output: r.stdout + r.stderr }
}
function cleanup() { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }) }
const legacy = fs.readFileSync(new URL("./input.txt", import.meta.url), "utf8")
const config = { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, outDir: "out", types: [] }, include: ["*.vibe"] }
try {
  // Before VIP-1, load(2) ran where it stood, and try make() ran the Effect
  // function the legacy compiler inferred for make to get its error instance
  // as data. made has the same result type, Missing, but its callable is an
  // ambient declaration, not a legacy wrapper, so its try ran the instance.
  const migrated = legacy
    .replace("const a = load(2)", "const a = try load(2)")
    .replace("const e = try make()", "const e = make()")
  {
    const root = project({ "legacy.vibe": legacy }, config)
    const r = run(root, "--fix-vip-only", "--fix", "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, r.output)
    assert.match(r.output, /legacy\.vibe: 2 fixes \(try ×1, try removed ×1\)/, r.output)
    const after = fs.readFileSync(path.join(root, "legacy.vibe"), "utf8")
    assert.equal(after, migrated, r.output)
    assert.match(after, /const m = try made\(\)/)
    // The migrated program gives what the legacy one gave: the run load and
    // make's instance as data.
    const program = await import(pathToFileURL(path.join(root, "out", "legacy.js")).href)
    assert.deepEqual(Effect.runSync(program.f()), [2, 27])
  }
  // Ordinary --fix does not run these passes: it neither writes try before
  // load(2) nor removes the valid try before make().
  {
    const root = project({ "legacy.vibe": legacy }, config)
    const r = run(root, "--fix", "-p", "tsconfig.json", "--pretty", "false")
    const after = fs.readFileSync(path.join(root, "legacy.vibe"), "utf8")
    assert.equal(after, legacy, r.output)
  }
  console.log("--fix-vip-only writes try where calls ran and removes it before a legacy wrapper")
} finally {
  cleanup()
}
