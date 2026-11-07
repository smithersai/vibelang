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
  "direct.vibe": "function take<T>(x: T): number { return 1 }\nexport effect function direct(job: number!!) { return take(job) }\n",
  // try makes same(job) a number, which kept's declared Effect type rejects.
  "result.vibe": "function same<T>(x: T): T { return x }\nexport effect function result(job: number!!) {\n  const kept: number!! = same(job)\n  return 1\n}\n",
  "container.vibe": "function many<T>(x: T[]): number { return 1 }\nexport effect function container(job: number!!) { return many([job]) }\n",
  "callback.vibe": "function later<T>(f: () => T): number { return 1 }\nexport effect function callback(job: number!!) { return later(() => job) }\n",
}
const config = { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, outDir: "out", types: [] }, include: ["*.vibe"] }
const sources = (texts) => Object.fromEntries(Object.entries(texts).filter(([n]) => n.endsWith(".vibe")))
const warnings = (output) => output.split("\n").filter((l) => / warning EK4802:/.test(l)).map((l) => l.slice(0, l.indexOf("(")))
try {
  const root = project(files, config)
  const first = run(root, "-p", "tsconfig.json", "--pretty", "false")
  assert.equal(first.status, 0, first.output)
  assert.deepEqual(warnings(first.output).sort(), ["callback.vibe", "container.vibe", "direct.vibe", "result.vibe"], first.output)
  const r = run(root, "--fix", "-p", "tsconfig.json", "--pretty", "false")
  assert.equal(r.status, 0, r.output)
  const after = sources(snapshot(root))
  // The direct argument runs with try.
  assert.equal(after["direct.vibe"], files["direct.vibe"].replace("take(job)", "take(try job)"))
  // The try that adds an error is refused and named, with the error it adds.
  assert.equal(after["result.vibe"], files["result.vibe"])
  assert.match(r.output, /result\.vibe:3: EK4802 not fixed: the fixed program would report .*result\.vibe: TS2322/, r.output)
  // Explicit type arguments would repair these; batch --fix never writes them.
  assert.equal(after["container.vibe"], files["container.vibe"])
  assert.equal(after["callback.vibe"], files["callback.vibe"])
  for (const [name, text] of Object.entries(after)) assert.ok(!/(take|same|many|later)<(?!T>\()/.test(text), name + " got explicit type arguments")
  // The compilation after --fix still warns at each site it did not repair.
  assert.deepEqual(warnings(r.output).sort(), ["callback.vibe", "container.vibe", "result.vibe"], r.output)
  console.log("batch --fix writes only try and refuses the try that adds an error")
} finally {
  cleanup()
}
