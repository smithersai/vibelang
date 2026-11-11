import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { init } from "../agents.mjs"

const directory = fileURLToPath(new URL("..", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(directory, "native/vibelang")
const skipNative = !existsSync(native) && "build the native compiler before checking generated lint commands"
const configs = ["vibe.config.json", "tsconfig.json", "jsconfig.json"]
function scratch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-lint-")))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "AGENTS.md"), "# Project\n\nKeep the project instructions.\n")
  return root
}
function setup(root) {
  const log = console.log
  console.log = () => {}
  try { assert.equal(init(root), 0) } finally { console.log = log }
  const text = readFileSync(join(root, "AGENTS.md"), "utf8")
  const line = text.split("\n").find(line => line.includes("vibelang lint"))
  assert.ok(line, text)
  return { text, line }
}
function verify(root, name, segments) {
  const { line } = setup(root)
  // Execute the option actually offered to the reader, including the old
  // option on an unfixed generator; do not reconstruct it in this test.
  const option = /pass .(-{1,2}[a-z]+) <config>./i.exec(line)?.[1]
  assert.ok(option, line)
  const project = join(root, ...segments, name)
  mkdirSync(dirname(project), { recursive: true })
  writeFileSync(project, JSON.stringify({ compilerOptions: { strict: true, types: [], skipLibCheck: true }, vibe: { effectGlobals: false, effectModules: false }, files: ["main.ts"] }))
  writeFileSync(join(dirname(project), "main.ts"), "export const value = 1\n")
  const result = spawnSync(native, ["lint", option, project], { cwd: root, encoding: "utf8", timeout: 20000 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null, result.stdout + result.stderr)
  assert.equal(result.status, 0, line + "\n" + result.stdout + result.stderr)
  assert.equal(existsSync(join(dirname(project), "main.js")), false)
  assert.equal(existsSync(join(dirname(project), "main.d.ts")), false)
  assert.equal(existsSync(join(dirname(project), "main.tsbuildinfo")), false)
}
test("generated lint guidance follows the compiler-options-only contract", () => {
  const vip = readFileSync(new URL("../../../docs/design/vips/0038-effect-lint-built-in.md", import.meta.url), "utf8")
  assert.ok(vip.includes("takes the compiler's options"))
  assert.ok(vip.includes("it emits no files"))
})
test("the lint command in generated instructions accepts a selected compiler project", { skip: skipNative }, () => {
  const root = scratch()
  try { for (const config of configs) verify(root, config, ["界 面", config.split(".")[0]]) }
  finally { rmSync(root, { recursive: true, force: true }) }
})
test("generated lint commands accept supported config kinds and mutated paths", { skip: skipNative }, () => {
  fc.assert(fc.property(fc.constantFrom(...configs), fc.array(fc.constantFrom("src", "a b", "界面", "nested.one"), { minLength: 0, maxLength: 4 }), (config, segments) => {
    const root = scratch()
    try { verify(root, config, segments) }
    finally { rmSync(root, { recursive: true, force: true }) }
  }), { numRuns: 24 })
})
test("refreshing lint guidance preserves project instructions and remains idempotent", () => {
  const root = scratch()
  try {
    const first = setup(root)
    assert.ok(first.text.startsWith("# Project\n\nKeep the project instructions.\n"))
    assert.doesNotMatch(first.line, /Oxlint/)
    assert.deepEqual(setup(root), first)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
