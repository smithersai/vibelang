import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { Connection } from "../../../typescript/vibelang/lsp-connection.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const source = 'import { Effect } from "effect"\nexport const pause = () => Effect.sleep(0)\n'

function project(t, extension, severity) {
  const root = mkdtempSync(join(tmpdir(), "chapter007-lint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(modules, "effect"), join(root, "node_modules/effect"))
  symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "main." + extension), source)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, noEmit: true },
    vibe: { severities: { EK3833: severity } }, files: ["main." + extension],
  }))
  return root
}

// Chapter 007 / imported lint runs on selected native and Vibe inputs: docs/design/src/007-tooling.md#416e2837bc304291
// Chapter 007 / repository severity selection reaches both file kinds: docs/design/src/007-tooling.md#79efd1361f124b49
for (const extension of ["ts", "vibe"]) {
  for (const severity of ["error", "warning", "suggestion", "off"]) {
    test("Chapter 007 / imported lint category " + severity + " on ." + extension, t => {
      const root = project(t, extension, severity)
      for (const prefix of [[], ["lint"]]) {
        const result = spawnSync(binary, [...prefix, "-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
        assert.ifError(result.error)
        assert.equal(result.status === 0, severity !== "error", result.stdout + result.stderr)
        if (severity === "error" || severity === "warning") assert.match(result.stdout, new RegExp(severity + " EK3833: effectSleepZeroToYieldNow:"))
        else assert.doesNotMatch(result.stdout, /EK3833/)
      }
    })
  }
}

// Chapter 007 / printed lint code includes its rule name: docs/design/src/007-tooling.md#64ef24e57d6160ff
// Chapter 007 / language server runs imported lint, like CLI and lint: docs/design/src/007-tooling.md#bcf4c79d381dd639
test("Chapter 007 / language server reports imported lint on both file kinds", async t => {
  for (const extension of ["ts", "vibe"]) {
    const root = project(t, extension, "warning")
    const client = new Connection(binary, ["--lsp", "--stdio"], root)
    try {
      await client.request("initialize", {
        processId: process.pid, rootUri: pathToFileURL(root + "/").href,
        capabilities: { textDocument: { diagnostic: { dynamicRegistration: false } }, workspace: { configuration: true } },
      })
      client.notify("initialized", {})
      const uri = pathToFileURL(join(root, "main." + extension)).href
      client.notify("textDocument/didOpen", { textDocument: { uri, languageId: extension === "vibe" ? "vibe" : "typescript", version: 1, text: source } })
      const report = await client.request("textDocument/diagnostic", { textDocument: { uri } })
      assert.ok(report.items.some(d => d.source === "EK" && d.code === 3833 && d.severity === 2 && d.message.includes("effectSleepZeroToYieldNow")), JSON.stringify(report))
    } finally { await client.close() }
  }
})

// Chapter 007 / Vibe-specific teaching checks stay off native TypeScript: docs/design/src/007-tooling.md#f0a05c7889055c19
test("Chapter 007 / a native Effect type gets no Vibe teaching diagnostic", t => {
  for (const extension of ["ts", "vibe"]) {
    const root = project(t, extension, "off")
    writeFileSync(join(root, "main." + extension), 'import { Effect } from "effect"\nexport type Value = Effect.Effect<number>\n')
    const result = spawnSync(binary, ["-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(/EK4833/.test(result.stdout), extension === "vibe", result.stdout)
  }
})

// Chapter 007 / LSP source identity ignores stale adjacent or mapped sidecars: docs/design/src/007-tooling.md#6173ed61ce7113e9
test("Chapter 007 / LSP resolves stale sidecars to source in both layouts", async t => {
  for (const output of ["", ".vibe/declarations"]) {
    const root = project(t, "ts", "off")
    const text = 'import { answer } from "./data.vibe"\nexport const checked: number = answer\n'
    writeFileSync(join(root, "main.ts"), text)
    writeFileSync(join(root, "data.vibe"), "export const answer: number = 42\n")
    const sidecar = join(root, output, "data.d.vibe.ts")
    mkdirSync(dirname(sidecar), { recursive: true })
    writeFileSync(sidecar, 'export declare const answer: "stale"\n')
    const config = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
    config.compilerOptions.allowArbitraryExtensions = true
    config.compilerOptions.allowImportingTsExtensions = true
    if (output) config.vibe.sidecarDir = output
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
    const client = new Connection(binary, ["--lsp", "--stdio"], root)
    try {
      await client.request("initialize", {
        processId: process.pid, rootUri: pathToFileURL(root + "/").href,
        capabilities: { textDocument: { diagnostic: { dynamicRegistration: false } } },
      })
      client.notify("initialized", {})
      const uri = pathToFileURL(join(root, "main.ts")).href
      client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text } })
      const report = await client.request("textDocument/diagnostic", { textDocument: { uri } })
      assert.deepEqual(report.items.filter(d => d.severity === 1), [], JSON.stringify(report))
      const definitions = await client.request("textDocument/definition", { textDocument: { uri }, position: { line: 0, character: 11 } })
      assert.ok((Array.isArray(definitions) ? definitions : [definitions]).some(d => (d?.uri || d?.targetUri) === pathToFileURL(join(root, "data.vibe")).href), JSON.stringify(definitions))
    } finally { await client.close() }
  }
})
