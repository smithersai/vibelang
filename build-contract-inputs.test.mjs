import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createRequire } from "node:module"

const repo = fileURLToPath(new URL("./", import.meta.url))
const cli = join(repo, ".smithers/node_modules/.bin/smthrs")
const ts = createRequire(new URL("./docs/tools/package.json", import.meta.url))("typescript")
let sequence = 0
function invoke(root, ...args) {
  const id = ++sequence
  const started = performance.now()
  console.error("BUILD_CONTRACT_COMMAND_BEGIN", id, args[0])
  const result = spawnSync(process.execPath, [cli, ...args, "--workspace", root, "--ui", "plain"], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  })
  console.error("BUILD_CONTRACT_COMMAND_END", id, Math.round(performance.now() - started),
    result.status, result.signal ?? "none", result.error?.code ?? "none")
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return result
}
const output = result => result.stdout + result.stderr
function put(root, file, source) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), source)
}
function copyTree(t) {
  const root = mkdtempSync(join(tmpdir(), "build-contract-inputs-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const omitted = new Set([".jj", ".git", ".cache", ".flows", "node_modules"])
  for (const name of readdirSync(repo)) {
    if (omitted.has(name)) continue
    cpSync(join(repo, name), join(root, name), { recursive: true, filter(source) {
      const path = relative(repo, source)
      return !path.split("/").some(part => omitted.has(part)) &&
        !["typescript/built", "site/dist", "site/.astro", "packages/compiler/native"].some(dir =>
          path === dir || path.startsWith(dir + "/"))
    } })
  }
  for (const dir of [".smithers", "docs/tools"]) {
    mkdirSync(join(root, dir), { recursive: true })
    symlinkSync(join(repo, dir, "node_modules"), join(root, dir, "node_modules"), "dir")
  }
  return root
}
function key(root) {
  const result = invoke(root, "explain", "//:build-contracts", "--format", "json")
  assert.equal(result.status, 0, output(result))
  return JSON.parse(result.stdout).cache.key
}
function run(root, expected) {
  const receipt = join(root, ".cache/contract-results-" + (sequence + 1) + ".json")
  mkdirSync(dirname(receipt), { recursive: true })
  const result = invoke(root, "ci", "//:build-contracts", "--jobs", "4", "--results-file", receipt)
  const parsed = JSON.parse(readFileSync(receipt, "utf8"))
  const target = parsed.results.find(row => row.label === "//:build-contracts")
  assert.ok(target, output(result))
  assert.equal(target.status, expected, output(result))
  assert.equal(result.status === 0, expected !== "failed", output(result))
  console.error("BUILD_CONTRACT_RESULT", JSON.stringify(target))
  return target
}
function unrelated(root) {
  for (const file of [
    "typescript/vibelang/cases/schema-grouped-codec-upgrade/main.vibe",
    "typescript/tsc/internal/vibelang/fibers.go",
    "docs/user/src/setup/release-notes.md",
  ]) appendFileSync(join(root, file), "\n")
  for (let i = 0; i < 64; i++) {
    const [dir, ext] = [
      ["typescript/vibelang/cases/cache-neighbours/deep", ".vibe"],
      ["typescript/tsc/internal/vibelang", ".go"],
      ["docs/user/src", ".md"],
      ["site/src/pages", ".mdx"],
    ][i % 4]
    put(root, dir + "/build-contract-neighbour-" + i + ext, "// unrelated input\n")
  }
}

test("actual build contracts reuse unrelated changes and still reject a changed budget", t => {
  const root = copyTree(t)
  const before = key(root)
  const cold = run(root, "ran")
  unrelated(root)
  assert.equal(key(root), before, "acceptance cases, compiler implementations, user prose and site output do not invalidate command contracts")
  const warm = run(root, "hit")
  assert.equal(warm.key, cold.key)
  const file = "packages/runtime/tests/main.test.ts"
  const original = readFileSync(join(root, file), "utf8")
  const broken = original.replace(/timeout: [\d_]+/, "timeout: undefined")
  assert.notEqual(broken, original, "mutate a real bounded runtime child")
  put(root, file, broken)
  assert.notEqual(key(root), before, "runtime child budgets remain inputs")
  run(root, "failed")
  put(root, file, original)
  assert.equal(key(root), before)
  run(root, "hit")
})

test("actual SDK keys retain static read inputs and new inventory members", async t => {
  const root = copyTree(t)
  // Exercise the production input factory in a small real SDK package. The
  // preceding test checks its wiring and actual command in the complete graph.
  put(root, "PACKAGE.ts", [
    'import { Smithers as S } from "@smthrs/targets"',
    'import { createBuildContractInputs } from "./build-contract-inputs.ts"',
    'export const Package = S.Package({ targets: { "build-contracts": S.Shell.Test({',
    'shell: "node --version", data: [createBuildContractInputs(S)],',
    'tools: [S.Host.bin("node")], sandbox: "none",',
    '}) } })',
    "",
  ].join("\n"))
  // Other package declarations import targets from the complete root package.
  // This fixture has one target, so discover only that declaration; explicit
  // file inputs and their plan-time inventories still cross these directories.
  const workspace = readFileSync(join(root, ".smithers/WORKSPACE.ts"), "utf8")
  assert.ok(workspace.includes("discovery: { prune: ["))
  put(root, ".smithers/WORKSPACE.ts", workspace.replace("discovery: { prune: [",
    'discovery: { prune: ["packages", "typescript", "scripts", '))

  const { buildContractFiles } = await import("./build-contract-inputs.ts")
  const before = key(root)
  for (const file of new Set(buildContractFiles)) {
    console.error("BUILD_CONTRACT_SELECTED", file)
    const original = readFileSync(join(root, file))
    appendFileSync(join(root, file), "\n")
    assert.notEqual(key(root), before, "retain inspected input " + file)
    writeFileSync(join(root, file), original)
  }
  for (const file of [
    "packages/compiler/test/new-contract-reader.mjs",
    "typescript/tsc/internal/project/vibelang_new_test.go",
    "typescript/tsc/internal/new-contract-package/nested/vibelang_new_test.go",
  ]) {
    put(root, file, "// new inventory member\n")
    assert.notEqual(key(root), before, "new directory membership retains " + file)
    rmSync(join(root, file))
  }
  assert.equal(key(root), before, "restoring selected bytes restores the original key")
})

// Existing file literals catch new direct readers and relative helper imports.
// Dynamic membership is checked separately with real SDK addition controls.
function literalFiles(file, source, base = repo) {
  const found = new Set()
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(ast.parseDiagnostics.length, 0, "the inspected suite must parse")
  const visit = node => {
    if (ts.isStringLiteralLike(node)) {
      for (const candidate of [resolve(base, node.text), resolve(base, dirname(file), node.text)]) {
        const path = relative(base, candidate)
        if (!path.startsWith("..") && existsSync(candidate) && statSync(candidate).isFile()) found.add(path)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return [...found]
}

test("suite file literals and imported helpers stay inside the inspected input closure", async t => {
  const { buildContractFiles } = await import("./build-contract-inputs.ts")
  const inputs = new Set([...buildContractFiles, ...globSync([
    "packages/compiler/test/*.mjs", "typescript/tsc/internal/**/vibelang*_test.go",
  ], { cwd: repo })])
  const missing = buildContractFiles.filter(file => file.endsWith(".mjs")).flatMap(file =>
    literalFiles(file, readFileSync(join(repo, file), "utf8"))
      .filter(path => !inputs.has(path)).map(path => file + " reads " + path))
  assert.deepEqual(missing, [], "add newly inspected files or helpers to the contract inputs")
  const root = mkdtempSync(join(tmpdir(), "contract-read-closure-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  put(root, "scripts/helper.mjs", "export const value = 1")
  for (const source of [
    'import { value } from "./helper.mjs"',
    'read("scripts/helper.mjs")',
    'new URL("./helper.mjs", import.meta.url)',
  ]) assert.deepEqual(literalFiles("scripts/check.mjs", source, root), ["scripts/helper.mjs"])
  assert.deepEqual(literalFiles("scripts/check.mjs", '// read("scripts/helper.mjs")', root), [])
})
