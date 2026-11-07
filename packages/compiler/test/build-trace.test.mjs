import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
function fixture(names, broken = false) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-build-trace-"))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: [], references: names.map(path => ({ path })) }))
  for (const [i, name] of names.entries()) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "main.ts"), `export interface Marker${i} { value: number }\nexport const value: Marker${i} = { value: ${broken && i === 0 ? '"bad"' : i} }\n`)
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { composite: true, types: [], skipLibCheck: true }, files: ["main.ts"] }))
  }
  return root
}
function run(root, extra = []) {
  return spawnSync(native, ["--build", "--generateTrace", resolve(root, "traces"), "--force", "--builders", "2", "--checkers", "1", ...extra], { cwd: root, encoding: "utf8", timeout: 30000 })
}
function jsonFiles(root, result = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) jsonFiles(path, result)
    else if (entry.name.endsWith(".json")) result.push(path)
  }
  return result
}
function verify(root, names) {
  const files = jsonFiles(join(root, "traces"))
  const legends = files.filter(path => path.endsWith("legend.json")).flatMap(path => JSON.parse(readFileSync(path, "utf8")))
  assert.ok(legends.length >= names.length)
  for (const name of names) {
    const entries = legends.filter(entry => entry.configFilePath === join(root, name, "tsconfig.json"))
    assert.ok(entries.length, name + " is missing from the trace legend")
    for (const entry of entries) {
      const trace = JSON.parse(readFileSync(entry.tracePath, "utf8"))
      const types = JSON.parse(readFileSync(entry.typesPath, "utf8"))
      assert.ok(trace.some(event => event.cat === "check" || event.cat === "checkTypes"))
      assert.ok(types.length > 0)
    }
  }
  assert.equal(new Set(legends.map(entry => entry.typesPath)).size, legends.length, "parallel projects must not overwrite type files")
}
test("build emits trace and type data for every concurrently compiled project", () => {
  const names = ["lib", "app"]
  const root = fixture(names)
  try {
    const result = run(root)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    verify(root, names)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("build finalizes traces when source diagnostics fail the build", () => {
  const names = ["broken", "valid"]
  const root = fixture(names, true)
  try {
    const result = run(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /TS2322/)
    verify(root, names)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("generated nested project names keep independent build traces", () => {
  fc.assert(fc.property(fc.constantFrom("with space", "深い", "nested/one", "a-b"), name => {
    const names = [name, "other"]
    const root = fixture(names)
    try {
      const result = run(root)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      verify(root, names)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { numRuns: 12 })
})
