import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vibelang-pprof-"))
  writeFileSync(join(root, "main.ts"), "export const value: number = 42\n")
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", noEmit: true, types: [], skipLibCheck: true }, files: ["main.ts"] }))
  writeFileSync(join(root, "blocker"), "preserve")
  return root
}
function run(root, args) {
  return spawnSync(native, args, { cwd: root, encoding: "utf8", timeout: 20000 })
}
test("an invalid native profiler destination reports a diagnostic without crashing", () => {
  const root = fixture()
  try {
    for (const build of [false, true]) {
      const destination = build ? join(root, "blocker/child").replaceAll("\\", "/") : "blocker/child"
      const result = run(root, [...(build ? ["-b"] : []), "--pprofDir", destination])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /--pprofDir.*cannot start profiling/)
      assert.doesNotMatch(result.stdout + result.stderr, /panic:|goroutine \d/)
      assert.equal(readFileSync(join(root, "blocker"), "utf8"), "preserve")
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("native profile failures stay actionable across nested path and build-mode mutations", () => {
  const root = fixture()
  try {
    fc.assert(fc.property(fc.constantFrom("child", "with space", "café", "深い/分析"), fc.boolean(), (tail, build) => {
      const result = run(root, [...(build ? ["-b"] : []), "--pprofDir", join(root, "blocker", tail).replaceAll("\\", "/")])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /--pprofDir.*cannot start profiling/)
      assert.doesNotMatch(result.stdout + result.stderr, /panic:|goroutine \d/)
    }), { numRuns: 16 })
    for (const build of [false, true]) {
      const directory = build ? "build-profiles" : "profiles"
      const destination = build ? join(root, directory).replaceAll("\\", "/") : directory
      const result = run(root, [...(build ? ["-b"] : []), "--pprofDir", destination])
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const files = readdirSync(join(root, directory))
      assert.ok(files.some(file => file.endsWith("-cpuprofile.pb.gz")))
      assert.ok(files.some(file => file.endsWith("-memprofile.pb.gz")))
      for (const file of files) assert.deepEqual([...readFileSync(join(root, directory, file)).subarray(0, 2)], [31, 139])
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test("language-server profiling reports an invalid destination before opening the protocol", () => {
  const root = fixture()
  try {
    const result = run(root, ["--lsp", "--stdio", "--pprofDir", "blocker/child"])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--pprofDir.*cannot start profiling/)
    assert.doesNotMatch(result.stderr, /panic:|goroutine [0-9]/)
    assert.equal(result.stdout, "")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
