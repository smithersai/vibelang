import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test, { before, after } from "node:test"
import { checkProperty } from "./testing/property.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(new URL("../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const version = JSON.parse(readFileSync(join(root, "packages/ts-mapper/package.json"), "utf8")).devDependencies.typescript
const stock = join(root, "packages/ts-mapper/test/.cache/typescript-" + version, "node_modules/.bin/tsc")
// PARITY_TEST_MAPPER can point at the real locally built mapper. Invalid
// selections must exit before any compiler is used, including --version.
let mapper = process.env.PARITY_TEST_MAPPER ?? join(root, "packages/ts-mapper/bin/vibelang-mapper")

let ownedMapper
before(() => {
  if (existsSync(mapper)) return
  ownedMapper = mkdtempSync(join(tmpdir(), "vibelang-parity-selection-mapper-"))
  mapper = join(ownedMapper, "vibelang-mapper")
  const build = spawnSync("sh", [join(root, "scripts/native-output.sh"), "build", mapper,
    "-p", "8", "-trimpath", "-buildvcs=false", "-gcflags=all=-dwarf=false", "./cmd/vibelang-mapper"], {
    cwd: join(root, "typescript/tsc"), encoding: "utf8", timeout: 900_000,
    env: { ...process.env, CGO_ENABLED: "0" }
  })
  assert.ifError(build.error)
  assert.equal(build.status, 0, build.stdout + build.stderr)
})
after(() => { if (ownedMapper) rmSync(ownedMapper, { recursive: true, force: true }) })

function fixture(t, names = ["alpha-case", "beta-case"]) {
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-selection-"))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const harness = join(temp, "harness"), corpus = join(temp, "corpus"), scope = join(temp, "scope")
  cpSync(join(root, "packages/ts-mapper/test/parity"), harness, {
    recursive: true, filter: (src) => !src.split("/").includes("out")
  })
  if (process.env.PARITY_SELECTION_SOURCE) {
    cpSync(process.env.PARITY_SELECTION_SOURCE, join(harness, "parity.ts"))
  }
  for (const name of ["parity.ts", "docs.ts", "runtime.ts"]) {
    const file = join(harness, name)
    writeFileSync(file, readFileSync(file, "utf8").replace(
      '"../../../../docs/tools/check-snippets.ts"', JSON.stringify(join(root, "docs/tools/check-snippets.ts"))
    ).replace(
      '"../../../compiler/cache.mjs"', JSON.stringify(join(root, "packages/compiler/cache.mjs"))
    ))
  }
  for (const dir of ["typescript/vibelang/cases", "examples", "templates", "docs/user"]) {
    mkdirSync(join(corpus, dir), { recursive: true })
  }
  for (const name of names) {
    const dir = join(corpus, "typescript/vibelang/cases", name)
    mkdirSync(dir)
    writeFileSync(join(dir, "main.ts"), "export const value = 42\n")
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true, types: [], outDir: "out" },
      files: ["main.ts"]
    }))
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
  }
  mkdirSync(join(scope, "node_modules"), { recursive: true })
  for (const name of ["package.json", "prelude.d.ts"]) cpSync(join(root, "packages/ts-mapper", name), join(scope, name))
  const effect = realpathSync(join(root, "experiments/node_modules/effect"))
  symlinkSync(effect, join(scope, "node_modules/effect"))
  symlinkSync(join(root, "packages/runtime"), join(scope, "node_modules/vibelang-runtime"))
  const out = join(harness, "out")
  mkdirSync(out)
  const receipts = { "summary.json": '{"preserved":true}\n', "summary.md": "previous summary\n", "manifest.json": '{"preserved":true}\n' }
  for (const [name, text] of Object.entries(receipts)) writeFileSync(join(out, name), text)
  return { out, receipts, run: (args) => {
    const child = spawnSync("bun", [join(harness, "parity.ts"), ...args], {
      cwd: temp, encoding: "utf8", timeout: 45_000,
      env: { ...process.env, PARITY_ROOT: corpus,
        PARITY_FORK_TSC: join(root, "packages/compiler/native/vibelang"), PARITY_MAPPER: mapper,
        PARITY_STOCK_TSC: stock, PARITY_EFFECT_DIR: effect, PARITY_RUNTIME_DIR: join(root, "packages/runtime"),
        PARITY_MAPPER_PACKAGE: scope }
    })
    assert.ifError(child.error)
    return child
  }}
}
function unchanged(f) {
  for (const [name, text] of Object.entries(f.receipts)) assert.equal(readFileSync(join(f.out, name), "utf8"), text)
  assert.equal(existsSync(join(f.out, "nm")), false)
  assert.equal(existsSync(join(f.out, "snippet-dependencies")), false)
  assert.equal(existsSync(join(f.out, "work")), false)
}
for (const selectors of [["misspelled-case"], ["not-alpha", "not-beta"]]) {
  test("unmatched declaration selectors fail without replacing receipts: " + selectors.join(", "), (t) => {
    const f = fixture(t), child = f.run(selectors)
    assert.equal(child.status, 2, child.stdout + child.stderr)
    assert.match(child.stderr, /no declaration cases matched/i)
    for (const selector of selectors) assert.ok(child.stderr.includes(selector), child.stderr)
    unchanged(f)
  })
}
for (const args of [[], ["not-present"]]) {
  test("an empty declaration corpus fails before setup: " + JSON.stringify(args), (t) => {
    const f = fixture(t, []), child = f.run(args)
    assert.equal(child.status, 2, child.stdout + child.stderr)
    assert.match(child.stderr, /no declaration cases matched/i)
    unchanged(f)
  })
}
test("gate selectors retain their explicit whole-corpus error before setup", (t) => {
  const f = fixture(t), child = f.run(["--gate", "alpha-case"])
  assert.equal(child.status, 2, child.stdout + child.stderr)
  assert.match(child.stderr, /--gate measures the whole corpus/)
  unchanged(f)
})
test("generated unmatched selectors fail without creating a zero-case result", async (t) => {
  const f = fixture(t)
  await checkProperty(fc, {
    name: "mapper-parity-empty-declaration-selection", numRuns: 24,
    rule: "Harness invariant: a declaration measurement needs at least one selected case; an empty selection exits2 before replacing receipts or setting up modules.",
    command: "node --test scripts/mapper-parity-selection.test.mjs",
    arbitrary: fc.array(fc.stringMatching(/^absent-[a-z]{1,10}$/), { minLength: 1, maxLength: 3 }),
    check: (selectors) => {
      const child = f.run(selectors)
      assert.equal(child.status, 2, child.stdout + child.stderr)
      for (const selector of selectors) assert.ok(child.stderr.includes(selector), child.stderr)
      unchanged(f)
    }
  })
})

// Actual compiler controls use no process or compiler mocks. The default
// run also checks the empty docs corpus; --docs intentionally selects no cases.
for (const [args, names] of [
  [[], ["alpha-case", "beta-case"]],
  [["alpha-case"], ["alpha-case"]],
  [["beta-"], ["beta-case"]],
  [["alpha-case", "beta-case"], ["alpha-case", "beta-case"]]
]) {
  test("real compilers preserve selection: " + JSON.stringify(args), (t) => {
    const f = fixture(t), child = f.run(["--jobs", "1", ...args])
    assert.equal(child.status, 0, child.stdout + child.stderr)
    const manifest = JSON.parse(readFileSync(join(f.out, "manifest.json"), "utf8"))
    assert.deepEqual(manifest.cases.map((c) => c.id), names)
    for (const c of manifest.cases) {
      assert.equal(c.fork.exit, 0, JSON.stringify(c.fork))
      assert.ok(Object.keys(c.reference).length > 0)
    }
    const summary = JSON.parse(readFileSync(join(f.out, "summary.json"), "utf8"))
    for (const c of summary.cases) {
      assert.equal(c.mapper.exit, 0, JSON.stringify(c.mapper))
      assert.ok(c.declarations.fork > 0 && c.declarations.mapper > 0)
    }
  })
}
test("docs-only measurement remains independent of declaration selection", (t) => {
  const f = fixture(t, []), child = f.run(["--docs", "ignored-selector"])
  assert.equal(child.status, 0, child.stdout + child.stderr)
  assert.match(child.stdout, /docs:/)
  assert.equal(readFileSync(join(f.out, "manifest.json"), "utf8"), f.receipts["manifest.json"])
  assert.equal(JSON.parse(readFileSync(join(f.out, "summary.json"), "utf8")).preserved, true)
})
