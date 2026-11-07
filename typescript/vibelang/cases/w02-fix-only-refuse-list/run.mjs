// run-seconds: 300
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
const files = {
  "a.vibe": "export type A = Effect.Effect<number>\n",
  "b.vibe": "export type B = Effect.Effect<string>\n",
  "plain.ts": "export const plain = 1\n",
  "outside/d.vibe": "export type D = Effect.Effect<number>\n",
  "empty.txt": "",
  "blank.txt": "\n\n",
  "mixed.txt": "a.vibe\nplain.ts\n",
}
// The project emits, so a run that went on to compile would write out/.
const config = { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, outDir: "out", declaration: true, types: [] }, include: ["*.vibe", "*.ts"] }
try {
  const refusals = [
    ["empty value", ["--only", ","]],
    ["empty string", ["--only", ""]],
    ["empty list file", ["--only", "@empty.txt"]],
    ["blank list file", ["--only", "@blank.txt"]],
    ["a TypeScript module", ["--only", "plain.ts"]],
    ["a missing path", ["--only", "missing.vibe"]],
    ["a .vibe file outside the project", ["--only", "outside/d.vibe"]],
    ["one bad path beside a good one", ["--only", "a.vibe,plain.ts"]],
    ["a list file holding a bad path", ["--only", "@mixed.txt"]],
    ["a bad repeated flag", ["--only", "a.vibe", "--only", "missing.vibe"]],
  ]
  for (const [name, args] of refusals) {
    const root = project(files, config)
    const before = snapshot(root)
    const r = run(root, "--fix", ...args, "-p", "tsconfig.json", "--pretty", "false")
    assert.notEqual(r.status, 0, name + ": " + r.output)
    assert.match(r.output, /--only lists .*no file written/, name + ": " + r.output)
    assert.deepEqual(changed(before, snapshot(root)), [], name + ": " + r.output)
    assert.ok(!fs.existsSync(path.join(root, "out")), name + ": the compilation ran")
  }
  // The neighbour: a list of project modules repairs a.vibe and the
  // compilation after --fix emits.
  {
    const root = project(files, config)
    const before = snapshot(root)
    const r = run(root, "--fix", "--only", "a.vibe", "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(edited(before, snapshot(root)), ["a.vibe"], r.output)
    assert.ok(fs.existsSync(path.join(root, "out", "a.js")), r.output)
  }
  console.log("an empty or non-module --only list stops before writing anything")
} finally {
  cleanup()
}
