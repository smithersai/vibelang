import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { editedFiles, init, invocation, withHook, withSection } from "../agents.mjs"

// `vibelang agents`: init writes each coding agent's own configuration, and
// check and hook run `vibelang --fix` and report what is left, end to end
// through the native compiler.
const packageDirectory = fileURLToPath(new URL("..", import.meta.url))
const launcher = join(packageDirectory, "bin/vibelang")
const native = process.env.VIBELANG_BINARY || join(packageDirectory, "native/vibelang")
const skipNative = !existsSync(native) && `run sh scripts/build-vibelang.sh first; missing ${native}`

function scratch(t, files = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries({ "package.json": '{"type":"module"}', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

function quietly(body) {
  const log = console.log
  const lines = []
  console.log = (...args) => lines.push(args.join(" "))
  try {
    return { status: body(), lines }
  } finally {
    console.log = log
  }
}

const read = (root, path) => readFileSync(join(root, path), "utf8")
const readJson = (root, path) => JSON.parse(read(root, path))

test("init wires each agent through its own configuration", (t) => {
  const root = scratch(t)
  const { status } = quietly(() => init(root))
  assert.equal(status, 0)

  const skill = readFileSync(join(packageDirectory, "skills/vibelang/SKILL.md"), "utf8")
  assert.equal(read(root, ".agents/skills/vibelang/SKILL.md"), skill)
  assert.equal(read(root, ".claude/skills/vibelang/SKILL.md"), skill)
  assert.match(read(root, "AGENTS.md"), /## VibeLang[\s\S]*`npx vibelang agents check <file>\.\.\.`/)

  assert.match(read(root, "AGENTS.md"), /`npx vibelang lint`/)

  const claudeHook = readJson(root, ".claude/settings.json").hooks.PostToolUse
  assert.deepEqual(claudeHook.map((group) => [group.matcher, group.hooks[0].command]), [["Edit|Write|MultiEdit", "npx --no -- vibelang agents hook"]])
  const codexHook = readJson(root, ".codex/hooks.json").hooks.PostToolUse
  assert.deepEqual(codexHook.map((group) => [group.matcher, group.hooks[0].command]), [["apply_patch", "npx --no -- vibelang agents hook"]])

  const plugin = readJson(root, ".claude/skills/vibelang-lsp/.claude-plugin/plugin.json")
  assert.deepEqual(plugin.lspServers.vibelang, {
    command: "npx", args: ["--no", "--", "vibelang", "--lsp", "--stdio"], extensionToLanguage: { ".vibe": "vibe" }
  })
  assert.deepEqual(readJson(root, "opencode.json").lsp, {
    vibelang: { command: ["npx", "--no", "--", "vibelang", "--lsp", "--stdio"], extensions: [".vibe"] }
  })
  assert.match(read(root, ".opencode/plugins/vibelang.js"), /"tool\.execute\.after"/)
})

test("init a second time changes nothing", (t) => {
  const root = scratch(t)
  quietly(() => init(root))
  const before = Object.fromEntries([".claude/settings.json", ".codex/hooks.json", "AGENTS.md", "opencode.json"].map((path) => [path, read(root, path)]))
  const { lines } = quietly(() => init(root))
  assert.ok(lines.includes("vibelang agents init: every agent is already set up."), lines.join("\n"))
  for (const [path, text] of Object.entries(before)) assert.equal(read(root, path), text, path)
})

test("init keeps what the repository already configured", (t) => {
  const root = scratch(t, {
    "AGENTS.md": "# Project\n\nRun the tests.\n",
    "CLAUDE.md": "# Claude\n",
    ".claude/settings.json": JSON.stringify({
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "prettier --write" }] }] }
    }),
    "opencode.json": JSON.stringify({ model: "anthropic/claude", lsp: { typescript: { disabled: true } } })
  })
  quietly(() => init(root))
  assert.match(read(root, "AGENTS.md"), /^# Project\n\nRun the tests\.\n\n<!-- vibelang agents: start/)
  assert.match(read(root, "CLAUDE.md"), /^# Claude\n\n<!-- vibelang agents: start[\s\S]*## VibeLang/)
  const settings = readJson(root, ".claude/settings.json")
  assert.deepEqual(settings.permissions, { allow: ["Bash(npm test)"] })
  assert.deepEqual(settings.hooks.PostToolUse.map((group) => group.hooks[0].command), ["prettier --write", "npx --no -- vibelang agents hook"])
  const opencode = readJson(root, "opencode.json")
  assert.equal(opencode.model, "anthropic/claude")
  assert.deepEqual(Object.keys(opencode.lsp), ["typescript", "vibelang"])
})

test("init leaves a JSONC opencode config, and one that turns LSP off", (t) => {
  const jsonc = scratch(t, { "opencode.jsonc": "{ // comments\n}\n" })
  const { lines } = quietly(() => init(jsonc))
  assert.ok(lines.some((line) => line.includes("skipped opencode.jsonc")), lines.join("\n"))
  assert.equal(existsSync(join(jsonc, "opencode.json")), false)
  const off = scratch(t, { "opencode.json": '{"lsp":false}' })
  quietly(() => init(off))
  assert.deepEqual(readJson(off, "opencode.json"), { lsp: false })
})

test("init refuses a directory without package.json", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const error = console.error
  console.error = () => {}
  try {
    assert.equal(init(root), 1)
  } finally {
    console.error = error
  }
})

test("a workspace package's vibelang runs through npx --prefix", (t) => {
  const root = scratch(t, { "packages/core/node_modules/.bin/vibelang": "" })
  assert.equal(invocation(root, join(root, "packages/core/src")), "npx --no --prefix packages/core -- vibelang")
  assert.equal(invocation(root, root), "npx --no -- vibelang")
})

test("withSection replaces its section and keeps the rest", () => {
  const once = withSection("# A\n", "<!-- vibelang agents: start. x -->\none\n<!-- vibelang agents: end -->")
  const twice = withSection(`${once}\n# B\n`, "<!-- vibelang agents: start. x -->\ntwo\n<!-- vibelang agents: end -->")
  assert.equal(twice, "# A\n\n<!-- vibelang agents: start. x -->\ntwo\n<!-- vibelang agents: end -->\n\n# B\n")
})

test("withHook replaces the group an earlier init wrote", () => {
  const first = withHook({}, "Edit", "npx vibelang agents hook")
  const second = withHook(first, "Edit|Write", "npx --no -- vibelang agents hook")
  assert.deepEqual(second.hooks.PostToolUse.map((group) => group.matcher), ["Edit|Write"])
})

test("editedFiles reads Claude Code, Codex and Cursor events", () => {
  assert.deepEqual(editedFiles({ tool_name: "Edit", tool_input: { file_path: "/r/src/a.vibe" } }, "/r"), ["/r/src/a.vibe"])
  assert.deepEqual(editedFiles({ file_path: "/r/b.vibe" }, "/r"), ["/r/b.vibe"])
  const patch = "*** Begin Patch\n*** Update File: src/a.vibe\n@@\n-x\n+y\n*** Add File: src/b.vibe\n+z\n*** Update File: src/c.ts\n*** Move to: src/d.vibe\n*** End Patch\n"
  assert.deepEqual(editedFiles({ tool_name: "apply_patch", tool_input: { command: patch } }, "/r"), ["/r/src/a.vibe", "/r/src/b.vibe", "/r/src/c.ts", "/r/src/d.vibe"])
  assert.deepEqual(editedFiles({ tool_name: "apply_patch", tool_input: { command: ["apply_patch", patch] } }, "/r").length, 4)
  assert.deepEqual(editedFiles({ tool_name: "Read", tool_input: {} }, "/r"), [])
})

// A project the native compiler checks: one .vibe file with a type error,
// without Effect installed, so only TS2322 is about the file.
function brokenProject(t) {
  const root = scratch(t, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true }, include: ["src"] }),
    "src/a.vibe": 'export const n: number = "one"\n',
    "src/b.vibe": "export const m: number = 1\n"
  })
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  symlinkSync(packageDirectory, join(root, "node_modules/vibelang"))
  symlinkSync(launcher, join(root, "node_modules/.bin/vibelang"))
  return root
}

function vibelang(root, args, input) {
  return spawnSync(process.execPath, [launcher, ...args], {
    cwd: root, input, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native }
  })
}

test("check prints the error left in a file and exits 1", { skip: skipNative }, (t) => {
  const root = brokenProject(t)
  const broken = vibelang(root, ["agents", "check", "src/a.vibe"])
  assert.equal(broken.status, 1, broken.stderr)
  assert.match(broken.stdout, /^src\/a\.vibe\(1,14\): error TS2322: Type 'string' is not assignable to type 'number'\./m)
  assert.match(broken.stdout, /vibelang: 1 error left in the files you edited\. Fix it before you finish\./)
  const clean = vibelang(root, ["agents", "check", "src/b.vibe"])
  assert.equal(clean.status, 0, clean.stdout)
  assert.match(clean.stdout, /vibelang: 1 error in other files of the project/)
})

test("hook returns an edited file's error to the agent with exit status 2", { skip: skipNative }, (t) => {
  const root = brokenProject(t)
  const claude = vibelang(root, ["agents", "hook"], JSON.stringify({
    hook_event_name: "PostToolUse", cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "src/a.vibe") }
  }))
  assert.equal(claude.status, 2)
  assert.match(claude.stderr, /src\/a\.vibe\(1,14\): error TS2322/)
  const codex = vibelang(root, ["agents", "hook"], JSON.stringify({
    hook_event_name: "PostToolUse", cwd: root, tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: src/a.vibe\n*** End Patch" }
  }))
  assert.equal(codex.status, 2)
  assert.match(codex.stderr, /error TS2322/)
})

test("hook says nothing about a file that isn't .vibe, and context about other files' errors", { skip: skipNative }, (t) => {
  const root = brokenProject(t)
  const other = vibelang(root, ["agents", "hook"], JSON.stringify({ cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "package.json") } }))
  assert.deepEqual([other.status, other.stdout, other.stderr], [0, "", ""])
  const clean = vibelang(root, ["agents", "hook"], JSON.stringify({ hook_event_name: "PostToolUse", cwd: root, tool_name: "Write", tool_input: { file_path: join(root, "src/b.vibe") } }))
  assert.equal(clean.status, 0, clean.stderr)
  assert.deepEqual(JSON.parse(clean.stdout).hookSpecificOutput.hookEventName, "PostToolUse")
  assert.match(JSON.parse(clean.stdout).hookSpecificOutput.additionalContext, /1 error in other files/)
})

test("the opencode plugin appends check's report to an edit's result", { skip: skipNative }, async (t) => {
  const root = brokenProject(t)
  quietly(() => init(root))
  process.env.VIBELANG_BINARY = native
  t.after(() => { if (native === join(packageDirectory, "native/vibelang")) delete process.env.VIBELANG_BINARY })
  const { VibeLang } = await import(pathToFileURL(join(root, ".opencode/plugins/vibelang.js")).href)
  const hooks = await VibeLang({ directory: root })
  const edit = { title: "", output: "Edit applied successfully.", metadata: {} }
  await hooks["tool.execute.after"]({ tool: "edit", sessionID: "s", callID: "c", args: { filePath: join(root, "src/a.vibe") } }, edit)
  assert.match(edit.output, /^Edit applied successfully\.\n\nsrc\/a\.vibe\(1,14\): error TS2322/)
  const read = { title: "", output: "contents", metadata: {} }
  await hooks["tool.execute.after"]({ tool: "read", sessionID: "s", callID: "c", args: { filePath: join(root, "src/a.vibe") } }, read)
  assert.equal(read.output, "contents")
})
