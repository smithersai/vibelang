import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { stripTypeScriptTypes } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { families, select } from "./fuzz-gate/select.mjs"

const label = name => "//scripts/fuzz-gate:" + name
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")

test("changed paths select the regression neighbourhood and no unrelated suite", () => {
  const controls = [
    ["typescript/tsc/internal/vibelangfmt/format.go", ["format"]],
    ["typescript/tsc/internal/parser/vibelang_match.go", ["syntax"]],
    ["docs/design/src/003-failures.md", ["failures"]],
    ["docs/design/src/001-functions.md", ["functions"]],
    ["docs/design/src/002-running.md", ["running"]],
    ["docs/design/src/004-match.md", ["data"]],
    ["docs/design/src/005-services.md", ["services"]],
    ["docs/design/src/006-data.md", ["data"]],
    ["docs/design/src/007-tooling.md", ["format"]],
    ["typescript/tsc/internal/vibelang/hover.go", ["editor"]],
    ["typescript/vibelang/lsp-smoke.mjs", ["editor"]],
    ["README.md", []],
    ["docs/design/src/003-failures.md.backup", []],
    ["some/typescript/tsc/internal/vibelangfmt/format.go", []]
  ]
  for (const [path, names] of controls) assert.deepEqual(select([path]), names.map(label), path)
})

test("selection is a stable union under path order, duplicates and slash spelling", () => {
  const paths = ["docs/design/src/003-failures.md", "typescript/tsc/internal/vibelangfmt/format.go", "README.md"]
  for (let seed = 0; seed < 128; seed++) {
    let state = seed + 1
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0)
    const varied = paths.flatMap(path => Array.from({ length: 1 + next() % 4 }, () =>
      (next() & 1 ? "./" : "") + (next() & 1 ? path.replaceAll("/", "\\") : path)))
    for (let i = varied.length - 1; i > 0; i--) {
      const j = next() % (i + 1)
      ;[varied[i], varied[j]] = [varied[j], varied[i]]
    }
    assert.deepEqual(select(varied), ["failures", "format"].map(label))
  }
  assert.deepEqual(select(["scripts/fuzz-gate/map.json"]), Object.keys(families).map(label).sort())
})

test("every mapped test exists in VibeLang's fuzz package", () => {
  const dir = new URL("../typescript/tsc/internal/vibelangfuzz/", import.meta.url)
  const text = readdirSync(dir).filter(name => name.endsWith("_test.go"))
    .map(name => readFileSync(new URL(name, dir), "utf8")).join("\n")
  for (const family of Object.values(families)) {
    assert.ok(family.tests.length)
    for (const name of family.tests) {
      assert.match(name, /^(?:Test|Fuzz)[A-Za-z0-9_]+$/)
      assert.match(text, new RegExp("^func " + name + "\\(", "m"), name)
    }
    for (const pattern of family.paths) assert.ok(pattern.startsWith("^"))
  }
})

test("real target declarations run exact saved seeds with bounded time and complete inputs", () => {
  let source = stripTypeScriptTypes(read("scripts/fuzz-gate/PACKAGE.ts"))
    .replace(/^import .*$/gm, "")
    .replace('JSON.parse(readFileSync(new URL("map.json", import.meta.url), "utf8"))', "map")
    .replace("export const Package", "globalThis.result")
  const group = prefix => new Proxy({}, { get: (_, name) => prefix + "." + name })
  const context = {
    map: families, Root: group("root"), Tsc: group("tsc"), Packages: group("packages"),
    S: { Shell: { Test: value => value, Run: value => value }, Host: { bin: value => value },
      file: value => value, Package: value => value }
  }
  runInNewContext(source, context)
  const targets = context.result.targets
  assert.deepEqual(Object.keys(targets).sort(), Object.keys(families).sort())
  for (const [name, target] of Object.entries(targets)) {
    assert.ok(target.shell.includes("-run '^(" + families[name].tests.join("|") + ")$'"))
    for (const flag of ["-short", "-count=1", "-timeout=90s", "-trimpath", "GOMAXPROCS=8", "GOFLAGS=-p=8"]) {
      assert.ok(target.shell.includes(flag), name + ": " + flag)
    }
    assert.ok(!target.shell.includes("-fuzz="), "campaigns stay post-merge")
    assert.equal(target.exclusive, true, "wildcards must not repeat the full seed suite")
    assert.equal(target.timeout, "30m", "admission/build budget is separate")
    for (const input of ["root.tree", "tsc.srcs", "tsc.vibelangfuzz-files", "packages.runtime-dist", "map.json"]) {
      assert.ok(target.data.includes(input), name + ": " + input)
    }
    assert.deepEqual(Array.from(target.tools), ["go", "node"])
  }
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibe-fuzz-gate-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, text, executable = false) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    if (executable) chmodSync(file, 0o755)
  }
  write("scripts/ci.sh", process.env.CI_SCRIPT_SOURCE ?
    readFileSync(process.env.CI_SCRIPT_SOURCE) : read("scripts/ci.sh"))
  for (const file of ["select.mjs", "map.json"]) write("scripts/fuzz-gate/" + file, read("scripts/fuzz-gate/" + file))
  write("scripts/check-effect-install.mjs", "process.exit(0)\n")
  write("scripts/share-effect.mjs", read("scripts/share-effect.mjs"))
  for (const dir of [".smithers", "packages/runtime", "packages/compiler", "experiments", "docs/tools"]) {
    mkdirSync(join(root, dir, "node_modules"), { recursive: true })
  }
  write("packages/ts-mapper/package.json", JSON.stringify({ devDependencies: { typescript: "fixture" } }))
  write("packages/ts-mapper/test/.cache/typescript-fixture/node_modules/.bin/tsc", "#!/bin/sh\nexit 0\n", true)
  write("bin/bun", "#!/bin/sh\nexit 0\n", true)
  write(".smithers/node_modules/.bin/smthrs",
    "#!" + process.execPath + "\nrequire('node:fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2)))\n", true)
  const env = { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH }
  delete env.CI_GATE_BASE
  delete env.CI_CHANGED_PATHS
  return { root, write, env, run(settings = {}) {
    return spawnSync("sh", ["scripts/ci.sh", "//packages:compiler-test", "--jobs", "8"], {
      cwd: root, env: { ...env, ...settings }, encoding: "utf8", timeout: 15000
    })
  }, args() { return JSON.parse(readFileSync(join(root, "args.json"), "utf8")) } }
}

test("the actual CI shell appends selected labels from a mirror's paths file", t => {
  const f = fixture(t)
  f.write("paths.txt", "docs/design/src/003-failures.md\r\ntypescript/tsc/internal/vibelangfmt/format.go\n")
  const run = f.run({ CI_CHANGED_PATHS: join(f.root, "paths.txt") })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(f.args().slice(0, 6), ["ci", "//packages:compiler-test", "--jobs", "8", label("failures"), label("format")])
})

test("the actual CI shell obtains changes from a real jj base revision", t => {
  const f = fixture(t)
  const jj = (...args) => execFileSync("jj", args, { cwd: f.root, env: f.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  jj("git", "init", "--colocate")
  jj("describe", "-m", "fixture base")
  jj("new")
  const base = jj("log", "--no-graph", "-r", "@-", "-T", "commit_id").trim()
  f.write("docs/design/src/003-failures.md", "fixture change\n")
  const run = f.run({ CI_GATE_BASE: base })
  assert.equal(run.status, 0, run.stderr)
  assert.ok(f.args().includes(label("failures")), JSON.stringify(f.args()))
  assert.ok(!f.args().includes(label("format")))
})

test("an unavailable base or paths file stops CI before a false passing graph", t => {
  const f = fixture(t)
  for (const setting of [{ CI_GATE_BASE: "not-a-revision" }, { CI_CHANGED_PATHS: join(f.root, "missing") }]) {
    const run = f.run(setting)
    assert.notEqual(run.status, 0)
    assert.throws(() => f.args())
  }
})

test("an empty paths file and ordinary CI preserve the requested selection", t => {
  const f = fixture(t)
  f.write("paths.txt", "")
  for (const setting of [{}, { CI_CHANGED_PATHS: join(f.root, "paths.txt") }]) {
    const run = f.run(setting)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(f.args().slice(0, 4), ["ci", "//packages:compiler-test", "--jobs", "8"])
    assert.ok(!f.args().some(arg => arg.startsWith("//scripts/fuzz-gate:")))
  }
})

test("hosted gates select changed paths against their tested base", () => {
  assert.match(read(".github/workflows/mq-pregate.yml"), /CI_GATE_BASE="\$PRE_BASE".*CI_RESULTS=/)
})
