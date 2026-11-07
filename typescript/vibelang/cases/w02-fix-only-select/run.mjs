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
// Every module offers the EK4833 fix that writes `T!!` for `Effect.Effect<T>`.
const files = {
  "a.vibe": "export type A = Effect.Effect<number>\n",
  "b.vibe": "export type B = Effect.Effect<string>\n",
  "c.vibe": "export type C = Effect.Effect<boolean>\n",
  "x.vibex": "export type X = Effect.Effect<bigint>\n",
  "plain.ts": "export const plain = 1\n",
}
const fixed = {
  "a.vibe": "export type A = number!!\n",
  "b.vibe": "export type B = string!!\n",
  "c.vibe": "export type C = boolean!!\n",
  "x.vibex": "export type X = bigint!!\n",
}
const config = { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: [] }, include: ["*.vibe", "*.vibex", "*.ts"] }
try {
  // Ordinary --fix repairs every module, so a narrower run is the flag's doing.
  {
    const root = project(files, config)
    const before = snapshot(root)
    const r = run(root, "--fix", "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(edited(before, snapshot(root)), ["a.vibe", "b.vibe", "c.vibe", "x.vibex"], r.output)
  }
  // Each list form selects exactly the modules it names, and writes in each
  // what ordinary --fix writes there.
  const forms = [
    ["one path", ["--only", "a.vibe"], ["a.vibe"]],
    ["comma list", ["--only", "a.vibe,b.vibe"], ["a.vibe", "b.vibe"]],
    ["repeated flag", ["--only", "a.vibe", "--only", "c.vibe"], ["a.vibe", "c.vibe"]],
    ["list file", ["--only", "@batch.txt"], ["b.vibe", "x.vibex"]],
    ["list file and comma list", ["--only", "@batch.txt", "--only", "c.vibe,a.vibe"], ["a.vibe", "b.vibe", "c.vibe", "x.vibex"]],
  ]
  for (const [name, args, want] of forms) {
    const root = project({ ...files, "batch.txt": "b.vibe\nx.vibex\n" }, config)
    const before = snapshot(root)
    const r = run(root, "--fix", ...args, "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, name + ": " + r.output)
    const after = snapshot(root)
    assert.deepEqual(edited(before, after), want, name + ": " + r.output)
    for (const file of want) assert.equal(after[file], fixed[file], name + ": " + file)
    assert.match(r.output, /partial repair: --only limited it to \d+ modules?/, name)
  }
  // Paths are relative to the current directory, not to the project: from the
  // project's parent, both a path and a list file name proj/ modules.
  {
    const root = project({ ...Object.fromEntries(Object.entries(files).map(([n, t]) => ["proj/" + n, t])), "proj/tsconfig.json": JSON.stringify(config), "pick.txt": "proj/b.vibe\n" }, {})
    const before = snapshot(root)
    const r = run(root, "--fix", "--only", "proj/a.vibe", "--only", "@pick.txt", "-p", "proj/tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(edited(before, snapshot(root)), ["proj/a.vibe", "proj/b.vibe"], r.output)
  }
  console.log("--fix --only repairs exactly the listed modules, in every list form")
} finally {
  cleanup()
}
