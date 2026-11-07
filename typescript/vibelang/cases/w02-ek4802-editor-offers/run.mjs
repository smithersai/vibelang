// run-seconds: 180
import { Connection } from "../../lsp-connection.mjs"
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
const probes = {
  // A direct Effect-valued argument under an inferred contract: both repairs.
  direct: "function take<T>(x: T): number { return 1 }\nexport effect function direct(job: number!!) { return take(job) }\n",
  // The written contract number!! accepts no string failure: no try.
  rejected: "function take<T>(x: T): number { return 1 }\nexport effect function rejected(job: number!string): number!! { return take(job) }\n",
  // A container or a callback is not a direct Effect-valued argument: no try.
  container: "function many<T>(x: T[]): number { return 1 }\nexport effect function container(job: number!!) { return many([job]) }\n",
  callback: "function later<T>(f: () => T): number { return 1 }\nexport effect function callback(job: number!!) { return later(() => job) }\n",
}
const runIt = "Run it with try"
const keep = "Keep the Effect value with explicit type arguments"
const want = {
  direct: [[runIt, "try "], [keep, "<number!!>"]],
  rejected: [[keep, "<number!string!>"]],
  container: [[keep, "<number!!>"]],
  callback: [[keep, "<number!!>"]],
}
const directory = project(Object.fromEntries(Object.entries(probes).map(([n, t]) => [n + ".vibe", t])),
  { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: [] }, include: ["*.vibe"] })
const connection = new Connection(binary, ["--lsp", "--stdio"], directory, { requestTimeoutMs: 30000 })
const apply = (text, edits) => {
  const offset = (p) => text.split("\n").slice(0, p.line).reduce((n, line) => n + line.length + 1, 0) + p.character
  let out = text
  for (const e of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start))) out = out.slice(0, offset(e.range.start)) + e.newText + out.slice(offset(e.range.end))
  return out
}
try {
  const rootUri = pathToFileURL(directory).href
  await connection.request("initialize", {
    processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "w02-ek4802-editor-offers" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: {
      diagnostic: { dynamicRegistration: false }, codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } } }
    }, workspace: { configuration: true, workspaceEdit: { documentChanges: true } } }
  })
  connection.notify("initialized", {})
  let version = 1
  for (const [name, text] of Object.entries(probes)) {
    const uri = pathToFileURL(path.join(directory, name + ".vibe")).href
    connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: version++, text } })
    const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
    const warnings = report.items.filter((d) => d.code === 4802)
    assert.equal(warnings.length, 1, name + ": " + JSON.stringify(report.items))
    assert.equal(warnings[0].severity, 2, name + ": EK4802 is a warning")
    const actions = await connection.request("textDocument/codeAction", { textDocument: { uri }, range: warnings[0].range, context: { diagnostics: warnings, only: ["quickfix"] } })
    const offered = (actions ?? []).filter((a) => a.title === runIt || a.title === keep)
    assert.deepEqual(offered.map((a) => [a.title, a.edit.changes[uri].map((e) => e.newText).join("")]), want[name], name)
    // Each offered repair leaves the module without EK4802 and without errors.
    for (const action of offered) {
      const edited = apply(text, action.edit.changes[uri])
      connection.notify("textDocument/didChange", { textDocument: { uri, version: version++ }, contentChanges: [{ text: edited }] })
      const after = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
      assert.deepEqual(after.items.filter((d) => d.code === 4802 || d.severity === 1), [], name + " after " + action.title + ": " + edited)
    }
    connection.notify("textDocument/didChange", { textDocument: { uri, version: version++ }, contentChanges: [{ text }] })
  }
  console.log("the editor offers try only for an accepted direct argument, and explicit type arguments everywhere")
} finally {
  await connection.close()
  cleanup()
}
