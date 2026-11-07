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
// The EK4834 fix writes "fast" for try Effect.succeed("fast"), so mode
// narrows to the literal "fast" and more.vibe's push("slow") stops checking.
const files = {
  "a.vibe": 'export effect function modes() {\n  const mode = try Effect.succeed("fast")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n',
  "more.vibe": 'import { modes } from "./a.vibe"\nexport effect function more() {\n  const all = try modes()\n  all.push("slow")\n  return all\n}\n',
}
const repaired = 'export effect function modes() {\n  const mode = "fast"\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n'
const config = { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, outDir: "out", types: [], rewriteRelativeImportExtensions: true }, include: ["*.vibe"] }
const sources = (texts) => Object.fromEntries(Object.entries(texts).filter(([n]) => n.endsWith(".vibe")))
try {
  // The project compiles before any fix.
  {
    const root = project(files, config)
    const r = run(root, "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, r.output)
    assert.doesNotMatch(r.output, /error/, r.output)
  }
  // Ordinary --fix checks the whole project, so more.vibe's error refuses it.
  {
    const root = project(files, config)
    const r = run(root, "--fix", "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, r.output)
    assert.match(r.output, /a\.vibe:2: EK4834 not fixed: .*more\.vibe: TS2345/, r.output)
    assert.deepEqual(sources(snapshot(root)), files)
  }
  // With only a.vibe listed, the fix is kept, more.vibe keeps its bytes, and
  // the compilation after --fix reports more.vibe's error and fails.
  {
    const root = project(files, config)
    const r = run(root, "--fix", "--only", "a.vibe", "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 2, r.output)
    const after = snapshot(root)
    assert.equal(after["a.vibe"], repaired, r.output)
    assert.equal(after["more.vibe"], files["more.vibe"])
    assert.match(r.output, /^more\.vibe\(4,12\): error TS2345: Argument of type '"slow"' is not assignable to parameter of type '"fast"'\.$/m, r.output)
    assert.doesNotMatch(r.output, /^a\.vibe\(\d+,\d+\): error/m, r.output)
  }
  // With more.vibe listed too, its error refuses the fix.
  {
    const root = project(files, config)
    const r = run(root, "--fix", "--only", "a.vibe,more.vibe", "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, r.output)
    assert.match(r.output, /a\.vibe:2: EK4834 not fixed: .*more\.vibe: TS2345/, r.output)
    assert.deepEqual(sources(snapshot(root)), files)
  }
  console.log("a fix that breaks only an unlisted module is kept and the compilation reports it")
} finally {
  cleanup()
}
