// VIP-30, clarified 2026-11-11: the built-in set (open VIPs 55 to 72) compiles
// only with "vibe": { "experimental": ["builtins"] }. Every loader reads the
// opt-in from the config the compiler reads, so the Node register hook, the Bun
// preload and the Vite plugin agree with tsc on the same project, and an edit
// of the opt-in invalidates a cached compile. The formatter never reads it.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../../typescript/vibelang/lsp-connection.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const hasBun = spawnSync("bun", ["--version"]).status === 0
const settle = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120)
const compilerOptions = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true }
const OPT = { experimental: ["builtins"] }
const source = [
  "task Count { effect call(repo: string): number!string { return repo.length } }",
  "export workflow Total { effect call(repo: string) { return try Count(repo) } }",
  "export const kind = typeof Experimental.Fuzz.run",
  ""
].join("\n")

// where: "tsconfig" puts the opt-in in tsconfig.json; "vibe.config" in a
// vibe.config.json beside a tsconfig.json without it; "none" nowhere.
function project(t, where) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-gate-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  symlinkSync(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const config = { compilerOptions, include: ["*.vibe"] }
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(where === "tsconfig" ? { ...config, vibe: OPT } : config))
  if (where === "vibe.config") writeFileSync(join(root, "vibe.config.json"), JSON.stringify({ ...config, vibe: OPT }))
  writeFileSync(join(root, "main.vibe"), source)
  writeFileSync(join(root, "entry.mjs"), 'import { kind } from "./main.vibe"\nconsole.log("gate " + kind)\n')
  settle()
  return root
}

function run(root, command, args) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_DISABLE_CACHE: "", VIBELANG_CACHE_DIR: join(root, ".cache-" + command.replaceAll("/", "_")) }
  })
  assert.ifError(result.error)
  return { ok: result.status === 0, out: result.stdout + result.stderr }
}

const tsc = root => run(root, compiler, ["--noEmit", "--pretty", "false", "-p", join(root, existsVibeConfig(root) ? "vibe.config.json" : "tsconfig.json")])
const existsVibeConfig = root => { try { readFileSync(join(root, "vibe.config.json")); return true } catch { return false } }
const loaders = [
  ["node register", root => run(root, process.execPath, ["--import", join(repo, "packages/compiler/register.mjs"), "entry.mjs"])],
  ...(hasBun ? [["bun preload", root => run(root, "bun", ["--preload", join(repo, "packages/compiler/bun.mjs"), "entry.mjs"])]] : [])
]

for (const [name, load] of loaders) {
  for (const where of ["tsconfig", "vibe.config"]) {
    test(`${name} compiles the built-in set with the opt-in in ${where}, as tsc does`, t => {
      const root = project(t, where)
      assert.ok(tsc(root).ok, tsc(root).out)
      const loaded = load(root)
      assert.ok(loaded.ok, loaded.out)
      assert.match(loaded.out, /gate function/)
    })
  }
  test(`${name} refuses the built-in set without the opt-in with EK3013, as tsc does`, t => {
    const root = project(t, "none")
    const checked = tsc(root)
    assert.ok(!checked.ok)
    assert.equal(checked.out.match(/EK3013/g)?.length, 1, checked.out)
    const loaded = load(root)
    assert.ok(!loaded.ok, loaded.out)
    assert.match(loaded.out, /EK3013/)
    assert.match(loaded.out, /"experimental": \["builtins"\]/)
  })
  test(`${name}: removing the opt-in invalidates the cached compile`, t => {
    const root = project(t, "tsconfig")
    assert.ok(load(root).ok)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions, include: ["*.vibe"] }))
    settle()
    const again = load(root)
    assert.ok(!again.ok, again.out)
    assert.match(again.out, /EK3013/)
  })
}

test("Vite builds the built-in set only with the opt-in, as tsc does", async t => {
  const { build } = await import(join(repo, "packages/vite/node_modules/vite/dist/node/index.js"))
  const { default: vibelang } = await import(join(repo, "packages/vite/src/index.js"))
  for (const where of ["tsconfig", "vibe.config", "none"]) {
    const root = project(t, where)
    const attempt = build({ root, configFile: false, logLevel: "silent", plugins: [vibelang()],
      build: { write: false, minify: false, lib: { entry: join(root, "main.vibe"), formats: ["es"] } } })
    if (where === "none") await assert.rejects(attempt, /EK3013/)
    else await attempt.catch(error => { throw new Error(where + ": " + error.message) })
  }
})

test("the formatter reads no opt-in: a task file formats the same with and without it", t => {
  const outputs = ["tsconfig", "none"].map(where => {
    const root = project(t, where)
    writeFileSync(join(root, "main.vibe"), "task  Count {effect call(repo: string): number!string { return repo.length }}\nconst task = 1\n")
    const formatted = run(root, process.execPath, [join(repo, "packages/compiler/bin/vibelang"), "format", "main.vibe"])
    assert.ok(formatted.ok, formatted.out)
    return readFileSync(join(root, "main.vibe"), "utf8")
  })
  assert.equal(outputs[0], outputs[1])
  assert.match(outputs[0], /^task Count \{/)
})

test("the language server reports EK3013 only without the opt-in, once, with the parse unchanged", async t => {
  for (const [where, want] of [["none", 1], ["tsconfig", 0], ["vibe.config", 0]]) {
    const root = project(t, where)
    const connection = new Connection(compiler, ["--lsp", "--stdio"], root)
    try {
      const rootUri = pathToFileURL(root).href
      await connection.request("initialize", {
        processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "gate" }],
        capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: {} }, workspace: { configuration: true } }
      })
      connection.notify("initialized", {})
      const uri = pathToFileURL(join(root, "main.vibe")).href
      const text = source.replace("typeof Experimental.Fuzz.run", "Experimental.Fuzz")
      writeFileSync(join(root, "main.vibe"), text)
      connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibelang", version: 1, text } })
      const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
      const items = report?.items ?? []
      const gate = items.filter(d => String(d.code).includes("3013"))
      assert.equal(gate.length, want, where + ": " + JSON.stringify(items))
      assert.deepEqual(items.filter(d => !String(d.code).includes("3013")), [], where + ": no other diagnostics")
      if (want) assert.match(gate[0].message, /"experimental": \["builtins"\]/)
      const symbols = await connection.request("textDocument/documentSymbol", { textDocument: { uri } })
      assert.ok(JSON.stringify(symbols).includes("Count"), where + ": the task still parses as a declaration: " + JSON.stringify(symbols))
    } finally {
      await connection.close?.()
    }
  }
})

// The gate decides by what a reference resolves to, so an alias of the
// namespace is refused by every entry as tsc refuses it (VIP-30, clarified
// 2026-11-12).
test("every entry refuses a gated module reached through an alias of Experimental", async t => {
  const root = project(t, "none")
  const text = "const E = Experimental\nexport const kind = typeof E.Durable.memory\n"
  writeFileSync(join(root, "main.vibe"), text)
  settle()
  const checked = tsc(root)
  assert.ok(!checked.ok, checked.out)
  assert.equal(checked.out.match(/EK3013/g)?.length, 1, checked.out)
  for (const [name, load] of loaders) {
    const loaded = load(root)
    assert.ok(!loaded.ok, name + ": " + loaded.out)
    assert.match(loaded.out, /EK3013/, name)
  }
  const { build } = await import(join(repo, "packages/vite/node_modules/vite/dist/node/index.js"))
  const { default: vibelang } = await import(join(repo, "packages/vite/src/index.js"))
  await assert.rejects(build({ root, configFile: false, logLevel: "silent", plugins: [vibelang()],
    build: { write: false, minify: false, lib: { entry: join(root, "main.vibe"), formats: ["es"] } } }), /EK3013/)
  const connection = new Connection(compiler, ["--lsp", "--stdio"], root)
  try {
    const rootUri = pathToFileURL(root).href
    await connection.request("initialize", {
      processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "gate" }],
      capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: {} }, workspace: { configuration: true } }
    })
    connection.notify("initialized", {})
    const uri = pathToFileURL(join(root, "main.vibe")).href
    connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibelang", version: 1, text } })
    const items = (await connection.request("textDocument/diagnostic", { textDocument: { uri } }))?.items ?? []
    assert.deepEqual(items.map(d => String(d.code)), ["3013"], JSON.stringify(items))
    assert.match(items[0].message, /`Experimental\.Durable`/)
  } finally {
    await connection.close?.()
  }
})
