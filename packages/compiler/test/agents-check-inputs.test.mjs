import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const directory = fileURLToPath(new URL("..", import.meta.url))
const launcher = join(directory, "bin/vibelang")
const native = process.env.VIBELANG_BINARY || join(directory, "native/vibelang")
const skipNative = !existsSync(native) && "build the native compiler before checking mixed file inputs"
function scratch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-inputs-")))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true }, vibe: { effectGlobals: false, effectModules: false }, files: ["present.vibe"] }))
  writeFileSync(join(root, "present.vibe"), 'export const n: number = "wrong"\n')
  mkdirSync(join(root, "directory.vibe"))
  const binary = join(root, "compiler.cjs")
  writeFileSync(binary, "#!" + process.execPath + "\n" + [
    'const fs = require("node:fs"), path = require("node:path")',
    'fs.writeFileSync(path.join(path.dirname(__filename), "compiler-called"), "yes")'
  ].join("\n") + "\n")
  chmodSync(binary, 0o755)
  return { root, binary }
}
function run(root, binary, files, command = "check", input) {
  return spawnSync(process.execPath, [launcher, "agents", command, ...files], { cwd: root, encoding: "utf8", timeout: 20000, input, env: { ...process.env, VIBELANG_BINARY: binary } })
}
function rejected(root, binary, files) {
  const result = run(root, binary, files)
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null, result.stdout + result.stderr)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /cannot check/)
  assert.doesNotMatch(result.stdout + result.stderr, /vibelang: no errors\./)
  return result
}
test("agent checks reject missing explicit files instead of reporting a clean check", () => {
  const { root, binary } = scratch()
  try {
    for (const files of [["missing.vibe"], ["界 面.vibex", "another.vibe"], ["directory.vibe"]]) {
      const result = rejected(root, binary, files)
      for (const file of files) assert.ok(result.stderr.includes(file), result.stderr)
      assert.equal(existsSync(join(root, "compiler-called")), false)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("agent checks still check existing files when another input is missing", { skip: skipNative }, () => {
  const { root } = scratch()
  try {
    for (const files of [["missing.vibe", "present.vibe"], ["present.vibe", "界 面.vibex"]]) {
      const result = rejected(root, native, files)
      assert.match(result.stdout, /TS2322/)
      assert.match(result.stdout, /present\.vibe/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("missing-input checks cannot become clean with varied names and argument order", () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom("missing.vibe", "界 面.vibex", "a.b.vibe", "directory.vibe"), { minLength: 1, maxLength: 4 }),
    fc.boolean(), fc.boolean(),
    (missing, includePresent, reverse) => {
      const { root, binary } = scratch()
      try {
        const files = includePresent ? [...missing, "present.vibe"] : [...missing]
        if (reverse) files.reverse()
        const result = rejected(root, binary, files)
        for (const file of missing) assert.ok(result.stderr.includes(file), result.stderr)
        assert.equal(existsSync(join(root, "compiler-called")), includePresent)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { numRuns: 64 })
})
test("post-edit hooks continue to ignore deleted files", () => {
  const { root, binary } = scratch()
  try {
    const result = run(root, binary, [], "hook", JSON.stringify({ cwd: root, tool_input: { file_path: join(root, "deleted.vibe") } }))
    assert.deepEqual([result.status, result.stdout, result.stderr], [0, "", ""])
    assert.equal(existsSync(join(root, "compiler-called")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
