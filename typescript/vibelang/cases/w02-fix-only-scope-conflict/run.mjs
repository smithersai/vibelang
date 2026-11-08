// run-seconds: 300
import { createRequire } from "node:module"
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
  "list.txt": "a.vibe\n",
}
const config = { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, outDir: "out", types: [] }, include: ["*.vibe"] }
try {
  // Without --fix, --only is an unknown compiler option, as stock TypeScript
  // reports it, and nothing is compiled or written.
  const unknown = "error TS5023: Unknown compiler option '--only'."
  for (const args of [["--only", "a.vibe"], ["-p", "tsconfig.json", "--only", "a.vibe,b.vibe"]]) {
    const root = project(files, config)
    const before = snapshot(root)
    const r = run(root, ...args, "--pretty", "false")
    assert.equal(r.status, 1, r.output)
    assert.equal(r.output.trim().split("\n")[0], unknown, r.output)
    assert.deepEqual(changed(before, snapshot(root)), [], args.join(" "))
  }
  const require = createRequire(import.meta.url)
  assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
  const stock = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
  const root = project({ "a.ts": "export const a = 1\n" }, { compilerOptions: { noEmit: true, types: [] }, files: ["a.ts"] })
  const native = spawnSync(process.execPath, [stock, "--only", "a.ts", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000 })
  assert.equal(native.status, 1, native.stdout + native.stderr)
  assert.equal((native.stdout + native.stderr).trim(), unknown)
  console.log("--only refuses a scope flag and is TS5023 without --fix")
} finally {
  cleanup()
}
