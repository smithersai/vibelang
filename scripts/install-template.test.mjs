import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const installer = fileURLToPath(new URL("./install-template.mjs", import.meta.url))
const manifest = { dependencies: { "vibelang-runtime": "published" }, devDependencies: { vibelang: "published", "vibelang-vite": "published" } }

function fixture(t, previous = "owned") {
  const root = mkdtempSync(join(tmpdir(), "vibelang template refresh-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => {
    const target = join(root, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  mkdirSync(join(root, "scripts"))
  cpSync(installer, join(root, "scripts/install-template.mjs"))
  put("templates/app/package.json", JSON.stringify(manifest))
  put("templates/app/src/main.vibe", "fresh template")
  const base = join(root, "templates home")
  mkdirSync(base)
  const destination = join(base, "vibelang")
  if (previous !== "absent") {
    put("templates home/vibelang/package.json", JSON.stringify(previous === "unrelated" ? { name: "custom" } : { devDependencies: { vibelang: "old" } }))
    put("templates home/vibelang/keep.txt", "last working template")
    if (previous === "marker") {
      put("templates home/vibelang/package.json", "legacy malformed manifest")
      put("templates home/vibelang/.vibelang-template", "")
    }
  }
  return { root, base, destination, put }
}
function run(f) {
  return spawnSync(process.execPath, [join(f.root, "scripts/install-template.mjs")], {
    env: { ...process.env, BUN_CREATE_DIR: f.base }, encoding: "utf8", timeout: 10_000,
  })
}
function preserved(f) {
  assert.equal(readFileSync(join(f.destination, "keep.txt"), "utf8"), "last working template")
  assert.deepEqual(readdirSync(f.base), ["vibelang"], "staging/backup directories leaked")
}

for (const mode of ["owned", "marker", "absent"]) test("installs a complete local template: " + mode, t => {
  const f = fixture(t, mode)
  f.put("templates/app/node_modules/ignored", "dependency")
  f.put("templates/app/dist/ignored", "build")
  const result = run(f)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const pkg = JSON.parse(readFileSync(join(f.destination, "package.json"), "utf8"))
  assert.equal(pkg.dependencies["vibelang-runtime"], "file:" + join(f.root, "packages/runtime/vibelang-runtime.tgz"))
  assert.equal(pkg.devDependencies.vibelang, "file:" + join(f.root, "packages/compiler"))
  assert.equal(pkg.devDependencies["vibelang-vite"], "file:" + join(f.root, "packages/vite"))
  assert.equal(readFileSync(join(f.destination, "src/main.vibe"), "utf8"), "fresh template")
  for (const name of ["keep.txt", "node_modules", "dist"]) assert.ok(!existsSync(join(f.destination, name)), name)
  assert.deepEqual(readdirSync(f.base), ["vibelang"])
})

test("an unrelated template is preserved", t => {
  const f = fixture(t, "unrelated")
  const result = run(f)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /refusing to replace an unrelated template/)
  preserved(f)
})

const broken = [
  ["missing source", f => rmSync(join(f.root, "templates/app"), { recursive: true })],
  ["missing manifest", f => rmSync(join(f.root, "templates/app/package.json"))],
  ["invalid JSON", f => f.put("templates/app/package.json", "{broken")],
  ...[null, {}, { dependencies: {} }, { devDependencies: {} }, { dependencies: null, devDependencies: {} }, { dependencies: {}, devDependencies: null }].map((pkg, i) =>
    ["invalid manifest " + i, f => f.put("templates/app/package.json", JSON.stringify(pkg))]),
  ["copy failure after a regular file", f => {
    const fifo = spawnSync("mkfifo", [join(f.root, "templates/app/z-pipe")], { encoding: "utf8" })
    assert.equal(fifo.status, 0, fifo.stderr)
  }],
]
for (const [name, breakSource] of broken) test("failed refresh preserves the last working template: " + name, t => {
  const f = fixture(t)
  breakSource(f)
  const result = run(f)
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, /installed template/)
  preserved(f)
})

// Fault injection changes only the selected rename; all copies, manifests,
// directory moves and cleanup still use the real filesystem.
for (const mode of ["backup", "publish", "restore"]) test("rename failure retains the previous bytes: " + mode, t => {
  const f = fixture(t)
  const preload = join(f.root, "rename-fault.mjs")
  writeFileSync(preload, [
    'import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module"',
    'const original = fs.renameSync',
    'fs.renameSync = function(from, to) {',
    '  const name = String(from).split("/").at(-1)',
    '  if (' + JSON.stringify(mode) + ' === "backup" && from === ' + JSON.stringify(f.destination) + ') throw new Error("injected backup rename failure")',
    '  if (name === "next" || (' + JSON.stringify(mode) + ' === "restore" && name === "previous")) throw new Error("injected " + name + " rename failure")',
    '  return original(from, to)',
    '}; syncBuiltinESMExports()'
  ].join("\n"))
  const result = spawnSync(process.execPath, ["--import", preload, join(f.root, "scripts/install-template.mjs")], {
    env: { ...process.env, BUN_CREATE_DIR: f.base }, encoding: "utf8", timeout: 10_000,
  })
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stderr, /injected .* rename failure/)
  assert.doesNotMatch(result.stdout, /installed template/)
  if (mode !== "restore") preserved(f)
  else {
    const retained = /^AggregateError: setup: previous template retained at (.+)$/m.exec(result.stderr)?.[1]
    assert.ok(retained, result.stderr)
    assert.equal(readFileSync(join(retained, "keep.txt"), "utf8"), "last working template")
    assert.ok(!existsSync(f.destination))
  }
})

for (const mode of ["owned", "dangling"]) test("replaces a template symlink without changing its target: " + mode, t => {
  const f = fixture(t)
  const target = join(f.root, "original-template")
  renameSync(f.destination, target)
  symlinkSync(mode === "owned" ? target : join(f.root, "missing-template"), f.destination)
  const result = run(f)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(readFileSync(join(target, "keep.txt"), "utf8"), "last working template")
  assert.equal(readFileSync(join(f.destination, "src/main.vibe"), "utf8"), "fresh template")
  assert.deepEqual(readdirSync(f.base), ["vibelang"])
})
