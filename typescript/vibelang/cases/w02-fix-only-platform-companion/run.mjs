// run-seconds: 300
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const modules = fileURLToPath(new URL("./node_modules", import.meta.url))
const roots = []
// project writes files into a new temporary project that resolves the case's
// packages, and returns its directory.
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w02-companion-"))
  roots.push(root)
  fs.symlinkSync(modules, path.join(root, "node_modules"), "dir")
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n')
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: [], lib: ["ES2022", "DOM"] },
    include: ["*.vibe", "*.ts"],
  }))
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text)
  return root
}
// snapshot reads every source of root but node_modules and sidecars, by name.
function snapshot(root) {
  const texts = {}
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && !/\.d\.vibex?\.ts$/.test(entry.name)) texts[entry.name] = fs.readFileSync(path.join(root, entry.name), "utf8")
  }
  return texts
}
const changed = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name] !== after[name]).sort()
function fix(root, ...args) {
  const r = spawnSync(binary, ["-p", "tsconfig.json", "--fix", ...args, "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.equal(r.error, undefined, String(r.error))
  return { status: r.status, output: r.stdout + r.stderr }
}
const wrapped = 'import * as Effect from "effect/Effect"\nexport const title = Effect.sync(() => document.title)\n'
const marker = "// Generated platform helpers for this VibeLang module.\n"
try {
  // A listed module takes its fresh companion, exactly as plain --fix makes it.
  const listed = project({ "a.vibe": wrapped, "b.vibe": "export const b = 1\n" })
  const before = snapshot(listed)
  const only = fix(listed, "--only", "a.vibe")
  assert.notEqual(only.status, 3, only.output)
  assert.doesNotMatch(only.output, /does not list|wrote nothing/, only.output)
  const after = snapshot(listed)
  assert.deepEqual(changed(before, after), ["a.platform.ts", "a.vibe"], only.output)
  assert.ok(after["a.platform.ts"].startsWith(marker), after["a.platform.ts"])
  assert.match(after["a.vibe"], /\$platform/)
  const plain = project({ "a.vibe": wrapped, "b.vibe": "export const b = 1\n" })
  const whole = fix(plain)
  assert.equal(whole.status, 0, whole.output)
  const want = snapshot(plain)
  assert.equal(after["a.vibe"], want["a.vibe"])
  assert.equal(after["a.platform.ts"], want["a.platform.ts"])
  // An unlisted module's companion is never written.
  const unlisted = project({ "a.vibe": "export const a = 1\n", "b.vibe": wrapped })
  const beforeUnlisted = snapshot(unlisted)
  fix(unlisted, "--only", "a.vibe")
  assert.deepEqual(changed(beforeUnlisted, snapshot(unlisted)), [])
  // A file that already claims the name, tracked or not, is left as it was.
  for (const claim of ["a.platform.ts", "a.platform.tsx", "a.platform.js", "a.platform.d.ts"]) {
    const claimed = project({ "a.vibe": wrapped, [claim]: claim.endsWith(".d.ts") ? "export declare const taken: number\n" : "export const taken = 1\n" })
    const beforeClaimed = snapshot(claimed)
    const refused = fix(claimed, "--only", "a.vibe")
    assert.notEqual(refused.status, 3, refused.output)
    const afterClaimed = snapshot(claimed)
    assert.equal(afterClaimed[claim], beforeClaimed[claim], claim)
    assert.doesNotMatch(afterClaimed["a.vibe"], /\$platform/, claim)
    assert.deepEqual(changed(beforeClaimed, afterClaimed).filter((name) => name !== "a.vibe"), [], claim)
  }
  console.log("--only creates a listed module's fresh platform companion and never writes a file that claims its name")
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
}
