import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkFiles } from "../agents.mjs"

const directory = fileURLToPath(new URL("..", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(directory, "native/vibelang")
const skipNative = !existsSync(native) && "build the native compiler before checking agent project discovery"
const primary = ["vibe.config.json", "tsconfig.json", "jsconfig.json"]
function scratch() {
  return realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-projects-")))
}
function put(root, name, value) {
  mkdirSync(dirname(join(root, name)), { recursive: true })
  writeFileSync(join(root, name), value)
}
const config = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true }, vibe: { effectGlobals: false, effectModules: false }, include: ["src"] })
function compiler(root) {
  const executable = join(root, "compiler.cjs")
  put(root, "compiler.cjs", "#!" + process.execPath + "\n" + [
    'const fs = require("node:fs"), path = require("node:path")',
    'const project = process.argv[process.argv.indexOf("-p") + 1]',
    'if (process.argv.includes("--listFilesOnly")) console.log(path.join(path.dirname(project), "src", "main.vibe"))',
    'else fs.appendFileSync(path.join(path.dirname(__filename), "selected.jsonl"), JSON.stringify(project) + "\\n")'
  ].join("\n") + "\n")
  chmodSync(executable, 0o755)
  return executable
}
function selected(root, binary, file, expected) {
  put(root, "selected.jsonl", "")
  const result = checkFiles([file], binary, root)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.failures, [])
  assert.deepEqual(result.errors, [])
  const actual = readFileSync(join(root, "selected.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
  assert.deepEqual(actual, [expected])
}
test("agent project discovery follows the accepted configuration precedence", () => {
  const vip = readFileSync(new URL("../../../docs/design/vips/0030-config-files.md", import.meta.url), "utf8")
  assert.ok(vip.includes("VibeLang reads the first that exists:"))
  assert.ok(vip.includes("then " + String.fromCharCode(96) + "tsconfig.json"))
})
test("agent checks find native errors with each primary configuration name", { skip: skipNative }, () => {
  const root = scratch()
  try {
    for (const name of primary) {
      const project = join(root, name.slice(0, -5))
      put(project, name, config)
      put(project, "src/main.vibe", 'export const value: number = "wrong"\n')
      const result = spawnSync(process.execPath, [join(directory, "bin/vibelang"), "agents", "check", "src/main.vibe"], { cwd: project, encoding: "utf8", timeout: 20000, env: { ...process.env, VIBELANG_BINARY: native } })
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null, result.stdout + result.stderr)
      assert.equal(result.status, 1, name + "\n" + result.stdout + result.stderr)
      assert.match(result.stdout, /TS2322/)
      assert.doesNotMatch(result.stdout, /not checked|no errors/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("agent primary configuration precedence covers every nonempty subset", () => {
  const root = scratch()
  try {
    const binary = compiler(root)
    for (let mask = 1; mask < 8; mask++) {
      const project = join(root, String(mask))
      const names = primary.filter((_, i) => mask & (1 << i))
      for (const name of names) put(project, name, config)
      put(project, "src/main.vibe", "export const value = 1\n")
      selected(root, binary, join(project, "src/main.vibe"), join(project, names[0]))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("agent discovery chooses the nearest directory before parent config priority", () => {
  const root = scratch()
  try {
    put(root, "vibe.config.json", config)
    put(root, "tsconfig.json", config)
    put(root, "packages/child/jsconfig.json", config)
    put(root, "packages/child/src/main.vibe", "export const value = 1\n")
    const binary = compiler(root)
    selected(root, binary, join(root, "packages/child/src/main.vibe"), join(root, "packages/child/jsconfig.json"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("agent config discovery preserves alternate projects across mutated directory names", () => {
  fc.assert(fc.property(
    fc.subarray(primary, { minLength: 1 }),
    fc.array(fc.constantFrom("src", "界 面", "a.b", "nested"), { minLength: 0, maxLength: 3 }),
    fc.boolean(),
    (names, segments, alternate) => {
      const root = scratch()
      try {
        const project = join(root, ...segments)
        for (const name of names) put(project, name, config)
        if (alternate) put(project, "tsconfig.test.json", config)
        put(project, "src/main.vibe", "export const value = 1\n")
        selected(root, compiler(root), join(project, "src/main.vibe"), join(project, names[0]))
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { numRuns: 48 })
})
test("agent discovery retains alternate tsconfig membership and repository boundaries", () => {
  const root = scratch()
  try {
    put(root, "tsconfig.test.json", config)
    put(root, "src/main.vibe", "export const value = 1\n")
    const binary = compiler(root)
    selected(root, binary, join(root, "src/main.vibe"), join(root, "tsconfig.test.json"))
    mkdirSync(join(root, "isolated/.jj"), { recursive: true })
    put(root, "isolated/src/main.vibe", "export const value = 1\n")
    const file = join(root, "isolated/src/main.vibe")
    assert.deepEqual(checkFiles([file], binary, root).missing, [file])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
