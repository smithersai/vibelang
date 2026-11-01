import assert from "node:assert/strict"
import { execFile, spawnSync } from "node:child_process"
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { promisify } from "node:util"

const source = process.env.VIBELANG_THROWS_ROOT ?? fileURLToPath(new URL("../../", import.meta.url))
const parser = dirname(fileURLToPath(import.meta.resolve("typescript/package.json")))
const artifact = "docs/design/inventory/throws.json"
const receipt = ".cache/throws-inventory.json"
const reused = /inputs unchanged; verified saved inventory/
async function fixture(t, copyParser = false) {
  const root = mkdtempSync(join(tmpdir(), "throws receipt-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  for (const file of ["throws-inventory.mjs", "throws-source.mjs", "throws-receipt.mjs"]) {
    const path = join(source, "docs/tools", file)
    if (existsSync(path)) put("docs/tools/" + file, readFileSync(path))
  }
  const version = "4.1.0"
  put("docs/tools/package.json", JSON.stringify({ type: "module", devDependencies: { effect: version, typescript: "5.9.3" } }))
  put("packages/runtime/package.json", JSON.stringify({ peerDependencies: { effect: version } }))
  put("typescript/tsc/internal/core/version.go", 'package core\nvar version = "7.1.0-fixture"\n')
  put("typescript/tsc/internal/bundled/libs/lib.fixture.d.ts", "declare function parse(value: string): number;\n")
  put("docs/tools/node_modules/effect/package.json", JSON.stringify({ type: "module", version }))
  put("docs/tools/node_modules/effect/dist/Function.js", "export const dual = (arity, body) => body;\n")
  put("docs/tools/node_modules/effect/dist/Fixture.js", "export const identity = value => value;\n")
  put("docs/tools/node_modules/effect/dist/Fixture.d.ts", "export declare const identity: (value: number) => number;\n")
  const target = join(root, "docs/tools/node_modules/typescript")
  if (copyParser) cpSync(parser, target, { recursive: true })
  else symlinkSync(parser, target, "dir")
  const execute = (env, args) => spawnSync(process.execPath, [join(root, "docs/tools/throws-inventory.mjs"), ...args], {
    cwd: root, encoding: "utf8", timeout: 60_000, env: { ...process.env, ...env }
  })
  const cli = (...args) => execute({}, args)
  const inventory = await import(pathToFileURL(join(root, "docs/tools/throws-inventory.mjs")))
  const run = inventory.verifyThrowsInventory ? (...args) => {
    // Run the production verifier and real TypeScript/Effect analysis in-process
    // so this regression matrix does not pay for dozens of parser startups.
    const log = console.log, error = console.error
    let stdout = "", stderr = "", status
    console.log = message => { stdout += message + "\\n" }
    console.error = message => { stderr += message + "\\n" }
    try { status = inventory.verifyThrowsInventory(args.includes("--write")) === false ? 1 : 0 }
    catch (failure) { status = 1; stderr += failure.message }
    finally { console.log = log; console.error = error }
    return { status, stdout, stderr }
  } : cli
  const covered = directory => execute({ NODE_V8_COVERAGE: directory }, ["--check"])
  const ok = result => assert.equal(result.status, 0, result.stdout + result.stderr)
  ok(run("--write"))
  const expected = readFileSync(join(root, artifact), "utf8")
  return { root, put, run, cli, covered, ok, expected }
}

test("real inventory CLI writes and verifies a small declaration/source fixture", async t => {
  const { cli, ok, expected } = await fixture(t)
  ok(cli("--write"))
  ok(cli("--check"))
  const entries = JSON.parse(expected).entries
  assert.equal(entries.find(entry => entry.module === "effect/Fixture").ownThrows, "never")
  assert.ok(entries.some(entry => entry.module === "global"))
})

test("unchanged check and write reuse analysis with identical artifact bytes", async t => {
  const { root, run, ok, expected } = await fixture(t)
  for (const mode of ["--check", "--write", "--check"]) {
    const result = run(mode)
    ok(result)
    assert.match(result.stdout, reused)
    assert.equal(readFileSync(join(root, artifact), "utf8"), expected)
  }
})

// V8 measures actual function execution, independently of the cache-hit message.
test("warm Node verification does not execute the inventory generator", async t => {
  if (process.versions.bun) { t.skip("V8 function coverage is a Node check"); return }
  const { root, covered, ok } = await fixture(t)
  const directory = join(root, "coverage")
  const result = covered(directory)
  ok(result)
  const scripts = readdirSync(directory).flatMap(file => JSON.parse(readFileSync(join(directory, file), "utf8")).result)
  const inventory = scripts.find(script => script.url.endsWith("/docs/tools/throws-inventory.mjs"))
  const generator = inventory.functions.find(fn => fn.functionName === "generateThrowsInventory")
  assert.equal(generator.ranges[0].count, 0, "unchanged inputs must not repeat analysis")
})

for (const damage of ["edited", "missing"]) test("a receipt never hides an " + damage + " artifact", async t => {
  const { root, put, run, ok, expected } = await fixture(t)
  if (damage === "edited") put(artifact, expected.replace('"ownThrows":"never"', '"ownThrows":"unknown"'))
  else rmSync(join(root, artifact))
  const result = run("--check")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /Stale or missing/)
  assert.doesNotMatch(result.stdout, reused)
  ok(run("--write"))
  assert.equal(readFileSync(join(root, artifact), "utf8"), expected)
  assert.match(run("--check").stdout, reused)
})

for (const damage of ["missing", "invalid JSON", "wrong schema", "wrong key", "wrong artifact"]) {
  test("a " + damage + " receipt is safely regenerated by a real check", async t => {
    const { root, put, run, ok, expected } = await fixture(t)
    if (damage === "missing") rmSync(join(root, receipt), { force: true })
    else if (damage === "invalid JSON") put(receipt, "{")
    else {
      const saved = JSON.parse(readFileSync(join(root, receipt), "utf8"))
      saved[damage === "wrong schema" ? "schemaVersion" : damage === "wrong key" ? "key" : "artifact"] = "invalid"
      put(receipt, JSON.stringify(saved))
    }
    const result = run("--check")
    ok(result)
    assert.doesNotMatch(result.stdout, reused)
    assert.equal(readFileSync(join(root, artifact), "utf8"), expected)
    assert.match(run("--check").stdout, reused)
  })
}

const changes = [
  ["bundled declaration", "typescript/tsc/internal/bundled/libs/lib.fixture.d.ts", "declare function extra(): string;\n", 1],
  ["nested new lib", "typescript/tsc/internal/bundled/libs/nested/new.d.ts", "declare function nested(): string;\n", 1],
  ["Effect source", "docs/tools/node_modules/effect/dist/Fixture.js", 'export const identity = value => { throw new RangeError("fixture") };\n', 1, true],
  ["Effect declaration", "docs/tools/node_modules/effect/dist/Fixture.d.ts", "export declare function extra(): string;\n", 1],
  ["new Effect source", "docs/tools/node_modules/effect/dist/internal/new.js", "export const added = 1;\n", 1],
  ["dual source", "docs/tools/node_modules/effect/dist/Function.js", "// new implementation metadata\n", 1],
  ["Effect metadata", "docs/tools/node_modules/effect/package.json", '{"type":"module","version":"4.1.0","fixture":true}', 1, true],
  ["bundled version", "typescript/tsc/internal/core/version.go", 'package core\nvar version = "7.2.0-fixture"\n', 1, true],
  ["docs manifest", "docs/tools/package.json", "\n", 0],
  ["runtime manifest", "packages/runtime/package.json", "\n", 0],
  ["generator", "docs/tools/throws-inventory.mjs", "\n// fixture generator edit\n", 0],
  ["analyzer", "docs/tools/throws-source.mjs", "\n// fixture analyzer edit\n", 0],
  ["receipt implementation", "docs/tools/throws-receipt.mjs", "\n// fixture receipt edit\n", 0],
  ["parser implementation", "docs/tools/node_modules/typescript/lib/typescript.js", "\n// fixture parser edit\n", 0]
]
for (const [name, file, value, status, replace] of changes) test(name + " content invalidates a successful receipt", async t => {
  const { root, put, run, ok, expected } = await fixture(t, name === "parser implementation")
  if (replace || !existsSync(join(root, file))) put(file, value)
  else appendFileSync(join(root, file), value)
  const result = run("--check")
  assert.equal(result.status, status, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, reused)
  if (status === 1) {
    assert.match(result.stderr, /Stale or missing/)
    assert.equal(readFileSync(join(root, artifact), "utf8"), expected)
    // A failed check must not bless stale output on the next invocation.
    assert.equal(run("--check").status, 1)
    ok(run("--write"))
    assert.notEqual(readFileSync(join(root, artifact), "utf8"), expected)
  }
  assert.match(run("--check").stdout, reused)
})

test("removed input files invalidate the receipt and expose stale output", async t => {
  const { root, run, ok } = await fixture(t)
  rmSync(join(root, "docs/tools/node_modules/effect/dist/Fixture.d.ts"))
  const result = run("--check")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, reused)
  ok(run("--write"))
  assert.match(run("--check").stdout, reused)
})

test("a changed pin still fails before a receipt can be reused", async t => {
  const { root, put, run } = await fixture(t)
  const path = "packages/runtime/package.json"
  const manifest = JSON.parse(readFileSync(join(root, path), "utf8"))
  manifest.peerDependencies.effect = "4.2.0"
  put(path, JSON.stringify(manifest))
  const result = run("--check")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /Install the pinned Effect/)
  assert.doesNotMatch(result.stdout, reused)
})

test("an unwritable receipt path does not fail a valid inventory check", async t => {
  const { root, run, ok } = await fixture(t)
  rmSync(join(root, receipt), { force: true })
  mkdirSync(join(root, receipt))
  const result = run("--check")
  ok(result)
  assert.match(result.stderr, /receipt unavailable/)
  assert.doesNotMatch(result.stdout, reused)
  assert.deepEqual(readFileSync(join(root, artifact), "utf8").slice(0, 1), "{")
})

test("content edits invalidate receipts even when size and timestamps are preserved", async t => {
  const { root, run } = await fixture(t)
  const path = join(root, "typescript/tsc/internal/bundled/libs/lib.fixture.d.ts")
  utimesSync(path, 1_700_000_000, 1_700_000_000)
  assert.equal(run("--check").status, 0)
  const before = statSync(path)
  writeFileSync(path, readFileSync(path, "utf8").replace("number", "string"))
  utimesSync(path, before.atime, before.mtime)
  assert.equal(statSync(path).size, before.size)
  assert.equal(statSync(path).mtimeMs, before.mtimeMs)
  const result = run("--check")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, reused)
})

test("concurrent real CLI checks publish complete receipts without leftover temporary files", async t => {
  const { root, run, ok } = await fixture(t)
  rmSync(join(root, receipt))
  await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, [
    join(root, "docs/tools/throws-inventory.mjs"), "--check"
  ], { cwd: root, encoding: "utf8", timeout: 60_000 })))
  assert.equal(JSON.parse(readFileSync(join(root, receipt), "utf8")).schemaVersion, 1)
  assert.deepEqual(readdirSync(join(root, ".cache")), ["throws-inventory.json"])
  const result = run("--check")
  ok(result)
  assert.match(result.stdout, reused)
})
