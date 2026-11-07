import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vibelang-cpu-profile-"))
  writeFileSync(join(root, "main.ts"), "export const value: number = 42\n")
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", noEmit: true, types: [], skipLibCheck: true }, files: ["main.ts"] }))
  return root
}
function run(root, args) {
  return spawnSync(native, args, { cwd: root, encoding: "utf8", timeout: 20000 })
}
function profile(root, name) {
  assert.ok(existsSync(join(root, name)), "requested CPU profile was not written")
  const data = JSON.parse(readFileSync(join(root, name), "utf8"))
  assert.ok(Array.isArray(data.nodes) && data.nodes.length > 0)
  assert.equal(data.nodes[0].callFrame.functionName, "(root)")
  assert.ok(data.endTime >= data.startTime)
  const ids = new Set(data.nodes.map(node => node.id))
  assert.equal(ids.size, data.nodes.length)
  for (const node of data.nodes) {
    assert.equal(typeof node.callFrame.functionName, "string")
    assert.ok(Number.isSafeInteger(node.hitCount) && node.hitCount >= 0)
    for (const child of node.children ?? []) assert.ok(ids.has(child))
  }
}
for (const build of [false, true]) {
  test("CPU profile output is written after " + (build ? "a project build" : "compilation"), () => {
    const root = fixture()
    try {
      const destination = build ? join(root, "nested/compiler.cpuprofile").replaceAll("\\", "/") : "nested/compiler.cpuprofile"
      const result = run(root, [...(build ? ["-b"] : []), "--generateCpuProfile", destination])
      assert.equal(result.status, 0, result.stdout + result.stderr)
      profile(root, "nested/compiler.cpuprofile")
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}
test("CPU profile output survives source diagnostics and filename mutations", () => {
  const root = fixture()
  try {
    fc.assert(fc.property(fc.constantFrom("profile", "with space", "café", "深い/分析"), fc.boolean(), (stem, bad) => {
      writeFileSync(join(root, "main.ts"), bad ? 'export const value: number = "wrong"\n' : "export const value: number = 42\n")
      const name = stem + ".cpuprofile"
      const result = run(root, ["--generateCpuProfile", name])
      assert.equal(result.status === 0, !bad, result.stdout + result.stderr)
      profile(root, name)
    }), { numRuns: 12 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("invalid CPU profile destinations and competing profilers report actionable failures", () => {
  const root = fixture()
  try {
    writeFileSync(join(root, "blocker"), "preserve")
    for (const args of [["--generateCpuProfile", "blocker/profile.cpuprofile"], ["--generateCpuProfile", "cpu.json", "--pprofDir", "profiles"]]) {
      const result = run(root, args)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /--generateCpuProfile/)
      assert.doesNotMatch(result.stderr, /panic:|goroutine \d/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test("CPU profile directory targets match TypeScript", () => {
  const root = fixture()
  try {
    mkdirSync(join(root, "profiles"))
    const result = run(root, ["--generateCpuProfile", "profiles"])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const files = readdirSync(join(root, "profiles"))
    assert.equal(files.length, 1)
    assert.match(files[0], /[+]P[0-9]+[.]cpuprofile$/)
    profile(root, "profiles/" + files[0])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
