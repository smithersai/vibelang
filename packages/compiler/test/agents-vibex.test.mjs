import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import fc from "fast-check"
import { init } from "../agents.mjs"

const directory = fileURLToPath(new URL("..", import.meta.url))
const launcher = join(directory, "bin/vibelang")
const native = process.env.VIBELANG_BINARY || join(directory, "native/vibelang")
const skipNative = !existsSync(native) && "build the native compiler before checking agent hooks"
function scratch(files = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-kinds-")))
  for (const [name, text] of Object.entries({ "package.json": '{"type":"module"}', ...files })) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}
const read = (root, name) => readFileSync(join(root, name), "utf8")
const json = (root, name) => JSON.parse(read(root, name))
function setup(root) {
  const log = console.log
  const lines = []
  console.log = (...args) => lines.push(args.join(" "))
  try { assert.equal(init(root), 0) } finally { console.log = log }
  return lines
}
function brokenProject() {
  const root = scratch({
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true, jsx: "preserve" }, vibe: { effectGlobals: false, effectModules: false }, include: ["src"] }),
    "src/plain.vibe": 'export const n: number = "wrong"',
    "src/界 面.vibex": 'export const n: number = "wrong"',
    "src/ignored.ts": "export const native = 1",
    "src/ignored.vibexx": "ignored"
  })
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  symlinkSync(directory, join(root, "node_modules/vibelang"))
  symlinkSync(launcher, join(root, "node_modules/.bin/vibelang"))
  return root
}
test("agent source-kind coverage follows the accepted JSX rule", () => {
  const vip = readFileSync(new URL("../../../docs/design/vips/0039-vibex.md", import.meta.url), "utf8")
  assert.ok(vip.includes("**Every `.vibe` rule applies.**"))
})
test("agent LSP setup includes both VibeLang source kinds and replays unchanged", () => {
  const root = scratch()
  try {
    setup(root)
    assert.deepEqual(json(root, ".claude/skills/vibelang-lsp/.claude-plugin/plugin.json").lspServers.vibelang.extensionToLanguage, { ".vibe": "vibe", ".vibex": "vibex" })
    assert.deepEqual(json(root, "opencode.json").lsp.vibelang.extensions, [".vibe", ".vibex"])
    const paths = ["AGENTS.md", "opencode.json", ".claude/settings.json", ".claude/skills/vibelang-lsp/.claude-plugin/plugin.json", ".opencode/plugins/vibelang.js"]
    const before = paths.map(name => read(root, name))
    setup(root)
    assert.deepEqual(paths.map(name => read(root, name)), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("agent source-kind setup preserves unrelated and disabled LSP configuration", () => {
  fc.assert(fc.property(fc.string({ maxLength: 20 }), fc.constantFrom("enabled", "disabled", "jsonc"), (value, mode) => {
    const files = mode === "jsonc" ? { "opencode.jsonc": "{ // retain comments\n}\n" } : { "opencode.json": JSON.stringify({ model: value, lsp: mode === "disabled" ? false : { other: { command: ["other"], extensions: [".other"] } } }) }
    const root = scratch(files)
    try {
      const lines = setup(root)
      assert.deepEqual(json(root, ".claude/skills/vibelang-lsp/.claude-plugin/plugin.json").lspServers.vibelang.extensionToLanguage, { ".vibe": "vibe", ".vibex": "vibex" })
      if (mode === "jsonc") {
        assert.equal(existsSync(join(root, "opencode.json")), false)
        assert.equal(read(root, "opencode.jsonc"), files["opencode.jsonc"])
        const note = lines.find(line => line.includes("skipped opencode.jsonc"))
        assert.ok(note.includes('".vibex"'), note)
      } else {
        const result = json(root, "opencode.json")
        assert.equal(result.model, value)
        if (mode === "disabled") assert.equal(result.lsp, false)
        else {
          assert.deepEqual(result.lsp.other, { command: ["other"], extensions: [".other"] })
          assert.deepEqual(result.lsp.vibelang.extensions, [".vibe", ".vibex"])
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { numRuns: 48 })
})
test("post-edit hooks check JSX VibeLang through every supported event shape", { skip: skipNative }, () => {
  const root = brokenProject()
  try {
    for (const name of ["src/plain.vibe", "src/界 面.vibex"]) {
      for (const input of [
        { tool_input: { file_path: join(root, name) } },
        { file_path: join(root, name) },
        { tool_input: { command: "*** Begin Patch\n*** Update File: " + name + "\n*** End Patch" } }
      ]) {
        const result = spawnSync(process.execPath, [launcher, "agents", "hook"], { cwd: root, encoding: "utf8", input: JSON.stringify({ cwd: root, hook_event_name: "PostToolUse", ...input }), env: { ...process.env, VIBELANG_BINARY: native }, timeout: 20000 })
        assert.equal(result.status, 2, result.stdout + result.stderr)
        assert.ok(result.stderr.includes(name), result.stderr)
        assert.match(result.stderr, /TS2322/)
      }
    }
    for (const name of ["src/ignored.ts", "src/ignored.vibexx"]) {
      const result = spawnSync(process.execPath, [launcher, "agents", "hook"], { cwd: root, encoding: "utf8", input: JSON.stringify({ cwd: root, tool_input: { file_path: join(root, name) } }), env: { ...process.env, VIBELANG_BINARY: native }, timeout: 20000 })
      assert.deepEqual([result.status, result.stdout, result.stderr], [0, "", ""])
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("the generated agent plugin checks JSX edits and patch destinations", { skip: skipNative }, async () => {
  const root = brokenProject()
  const previous = process.env.VIBELANG_BINARY
  process.env.VIBELANG_BINARY = native
  try {
    setup(root)
    const { VibeLang } = await import(pathToFileURL(join(root, ".opencode/plugins/vibelang.js")).href)
    const hooks = await VibeLang({ directory: root })
    for (const input of [
      { tool: "edit", args: { filePath: join(root, "src/界 面.vibex") } },
      { tool: "apply_patch", args: { patchText: "*** Begin Patch\n*** Update File: src/ignored.ts\n*** Move to: src/界 面.vibex\n*** End Patch" } }
    ]) {
      const output = { output: "Edit applied." }
      await hooks["tool.execute.after"](input, output)
      assert.match(output.output, /TS2322/)
      assert.match(output.output, /界 面\.vibex/)
    }
    const output = { output: "Contents" }
    await hooks["tool.execute.after"]({ tool: "read", args: { filePath: join(root, "src/界 面.vibex") } }, output)
    assert.equal(output.output, "Contents")
  } finally {
    if (previous === undefined) delete process.env.VIBELANG_BINARY
    else process.env.VIBELANG_BINARY = previous
    rmSync(root, { recursive: true, force: true })
  }
})
