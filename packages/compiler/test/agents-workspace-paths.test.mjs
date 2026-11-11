import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { init, invocation } from "../agents.mjs"

test("the tool integration requirement is quoted from VIP-34", () => {
  const vip = readFileSync(new URL("../../../docs/design/vips/0034-compiler-and-tooling.md", import.meta.url), "utf8")
  assert.ok(vip.includes("linters, Knip, bundlers and test runners each read " + String.fromCharCode(96) + ".vibe" + String.fromCharCode(96)))
})

const read = (root, file) => readFileSync(join(root, file), "utf8")
const json = (root, file) => JSON.parse(read(root, file))

function setup(t, prefix) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-paths-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  const packageRoot = join(root, prefix)
  mkdirSync(join(packageRoot, "node_modules/.bin"), { recursive: true })
  writeFileSync(join(packageRoot, "package.json"), '{"name":"workspace-command-test","private":true}')
  const compiler = join(packageRoot, "node_modules/.bin/vibelang")
  writeFileSync(compiler, "#!" + process.execPath + "\nconsole.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }))\n")
  chmodSync(compiler, 0o755)
  const cwd = join(packageRoot, "src")
  mkdirSync(cwd, { recursive: true })
  mkdirSync(join(root, "bin"))
  const npx = join(root, "bin/npx")
  writeFileSync(npx, "#!" + process.execPath + "\nconsole.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }))\n")
  chmodSync(npx, 0o755)
  const previousCwd = process.cwd()
  const log = console.log
  process.chdir(cwd)
  console.log = () => {}
  try { assert.equal(init(root), 0) }
  finally { process.chdir(previousCwd); console.log = log }
  return { root, cwd, env: { ...process.env, PATH: join(root, "bin") + delimiter + process.env.PATH } }
}

function execute(command, args, fixture, expected) {
  const result = spawnSync(command, args, { cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 10000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { args: expected, cwd: fixture.root })
}

for (const prefix of ["--no", "--", "packages/core", "packages/core app", "packages/O'Reilly", "packages/app (node)", "packages/pkg -- tools", "packages/ui $cache", 'packages/say "hi"', "packages/jobs;queue", "packages/workers & jobs"]) {
  test("agent workspace commands retain the path " + JSON.stringify(prefix), (t) => {
    const fixture = setup(t, prefix)
    const packageArgument = prefix.startsWith("-") ? "./" + prefix : prefix
    const expected = ["--no", "--prefix", packageArgument, "--", "vibelang"]
    const hook = json(fixture.root, ".claude/settings.json").hooks.PostToolUse[0].hooks[0].command
    const codex = json(fixture.root, ".codex/hooks.json").hooks.PostToolUse[0].hooks[0].command
    execute("/bin/sh", ["-c", hook], fixture, [...expected, "agents", "hook"])
    execute("/bin/sh", ["-c", codex], fixture, [...expected, "agents", "hook"])
    const lsp = json(fixture.root, ".claude/skills/vibelang-lsp/.claude-plugin/plugin.json").lspServers.vibelang
    execute(lsp.command, lsp.args, fixture, [...expected, "--lsp", "--stdio"])
    const [command, ...args] = json(fixture.root, "opencode.json").lsp.vibelang.command
    execute(command, args, fixture, [...expected, "--lsp", "--stdio"])
    execute("/bin/sh", ["-c", invocation(fixture.root, fixture.cwd)], fixture, expected)
    const proseCommand = /\x60([^\x60]+) agents check <file>\.\.\.\x60/.exec(read(fixture.root, "AGENTS.md"))[1]
    execute("/bin/sh", ["-c", proseCommand], fixture, ["--prefix", packageArgument, "vibelang"])
  })
}

test("the generated opencode plugin preserves workspace arguments", async (t) => {
  const prefix = "packages/O'Reilly app"
  const fixture = setup(t, prefix)
  const { VibeLang } = await import(pathToFileURL(join(fixture.root, ".opencode/plugins/vibelang.js")).href)
  const previousPath = process.env.PATH
  process.env.PATH = fixture.env.PATH
  try {
    const plugin = await VibeLang({ directory: fixture.root })
    const output = { output: "edited" }
    await plugin["tool.execute.after"]({ tool: "edit", args: { filePath: "src/a.vibe" } }, output)
    assert.deepEqual(JSON.parse(output.output.slice("edited\n\n".length)), {
      args: ["--no", "--prefix", prefix, "--", "vibelang", "agents", "check", "src/a.vibe"], cwd: fixture.root
    })
  } finally { process.env.PATH = previousPath }
})

test("workspace command quoting survives filename mutations", (t) => {
  // VIP-34 requires each existing tool to read VibeLang. The observable
  // argument vector must retain the selected package path byte for byte.
  fc.assert(fc.property(fc.array(fc.constantFrom("a", "é", " ", "'", '"', "$", "&", ";", "(", ")", "-"), { minLength: 1, maxLength: 10 }), (letters) => {
    const prefix = "packages/p" + letters.join("")
    const fixture = setup(t, prefix)
    execute("/bin/sh", ["-c", invocation(fixture.root, fixture.cwd)], fixture, ["--no", "--prefix", prefix, "--", "vibelang"])
    const lsp = json(fixture.root, "opencode.json").lsp.vibelang.command
    execute(lsp[0], lsp.slice(1), fixture, ["--no", "--prefix", prefix, "--", "vibelang", "--lsp", "--stdio"])
  }), { seed: 34, numRuns: 48 })
})

test("real npx resolves workspace package paths without downloading", (t) => {
  for (const prefix of ["packages/core app", "packages/O'Reilly", "--no", "--"]) {
    const fixture = setup(t, prefix)
    const hook = json(fixture.root, ".claude/settings.json").hooks.PostToolUse[0].hooks[0].command
    execute("/bin/sh", ["-c", hook], {
      ...fixture, env: { ...process.env, npm_config_offline: "true", npm_config_update_notifier: "false" }
    }, ["agents", "hook"])
  }
})

test("the ordinary root invocation retains its command", (t) => {
  const fixture = setup(t, "packages/core app")
  assert.equal(invocation(fixture.root, fixture.root), "npx --no -- vibelang")
  execute("/bin/sh", ["-c", invocation(fixture.root, fixture.root)], fixture, ["--no", "--", "vibelang"])
})

