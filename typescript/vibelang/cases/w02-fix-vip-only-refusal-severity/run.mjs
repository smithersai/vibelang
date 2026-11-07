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
// load(n) in the unmarked callback may have run before VIP-1: whether it
// did depends on how the old compiler inferred the arrow, so it is refused.
const refused = "effect function load(n: number) {\n  try yieldNow\n  return n\n}\n\nexport effect function f() {\n  return [1].map((n) => {\n    load(n)\n    return n\n  })\n}\n"
const other = "function take<T>(x: T): number { return 1 }\nexport effect function other(job: number!!) { return take(job) }\n"
const config = '{\n  // the project\'s own comment\n  "compilerOptions": {"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"out","types":[]},\n  "include": ["*.vibe"]\n}\n'
const strip = (jsonc) => JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, ""))
try {
  {
    const root = project({ "refused.vibe": refused, "other.vibe": other }, config)
    const before = run(root, "-p", "tsconfig.json", "--pretty", "false", "--noEmit")
    assert.match(before.output, /^other\.vibe\(2,59\): warning EK4802:/m, before.output)
    const r = run(root, "--fix-vip-only", "--fix", "-p", "tsconfig.json", "--pretty", "false")
    assert.ok(r.status >= 2, "a refusing run fails: " + r.output)
    assert.match(r.output, /refused\.vibe:8: try not written: /, r.output)
    assert.match(r.output, /tsconfig\.json: EK4802 is now an error: /, r.output)
    const text = fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")
    // The setting, preceded by a comment that says why; the project's own
    // comment and settings stay.
    assert.match(text, /\/\/ vibelang --fix-vip-only refused 1 call that may have run before VIP-1[^\n]*EK4802 is an error until each is migrated by hand; remove this setting when --fix-vip-only refuses none\.\n\s*"vibe": \{"severities": \{"EK4802": "error"\}\},/, text)
    assert.match(text, /\/\/ the project's own comment/)
    const parsed = strip(text)
    assert.deepEqual(parsed.vibe, { severities: { EK4802: "error" } })
    assert.deepEqual(parsed.include, ["*.vibe"])
    // Every inferred Effect argument site in the project now fails to compile,
    // including one in a module the refusal did not touch.
    const after = run(root, "-p", "tsconfig.json", "--pretty", "false", "--noEmit")
    assert.notEqual(after.status, 0, after.output)
    assert.match(after.output, /^other\.vibe\(2,59\): error EK4802:/m, after.output)
    // A second refusing run leaves the config as it is.
    const again = run(root, "--fix-vip-only", "--fix", "-p", "tsconfig.json", "--pretty", "false")
    assert.ok(again.status >= 2, again.output)
    assert.equal(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"), text)
    assert.doesNotMatch(again.output, /EK4802 is now an error/, again.output)
  }
  // A run that refuses no call writes no setting, and EK4802 stays a warning.
  {
    const root = project({ "other.vibe": other }, config)
    const r = run(root, "--fix-vip-only", "--fix", "-p", "tsconfig.json", "--pretty", "false")
    assert.equal(r.status, 0, r.output)
    assert.equal(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"), config)
    assert.match(r.output, /^other\.vibe\(2,59\): warning EK4802:/m, r.output)
  }
  console.log("a refusing --fix-vip-only makes EK4802 an error in the config and says why")
} finally {
  cleanup()
}
