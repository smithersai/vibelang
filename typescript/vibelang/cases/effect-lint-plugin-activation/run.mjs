// VIP-38 compiler activation: the resolved `@effect/language-service` plugin
// entry selects the imported rules, identically in compiler builds, `vibelang
// lint` and the language server, for `.ts` and `.vibe` inputs.
// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { Connection } from "../../lsp-connection.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const server = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const root = fs.mkdtempSync(path.join(os.tmpdir(), "effect-lint-plugin-activation-"))
const options = { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true }
const plugin = (settings = {}) => ({ name: "@effect/language-service", ...settings })
// promiseInEffectSuccess (EK3897) is a default-on warning; globalConsole
// (EK3844) is default-off.
const sources = {
  "main.ts": 'import { Effect } from "effect"\nexport const value = Effect.succeed(Promise.resolve(1))\nconsole.log("x")\n',
  "witness.vibe": "export const vibeValue = Effect.succeed(Promise.resolve(2))\n",
}
const scenarios = [
  ["no-plugin", { compilerOptions: options }],
  ["plugin", { compilerOptions: { ...options, plugins: [plugin()] } }],
  ["inherited-plugin", { extends: "./base.json", compilerOptions: options }, { compilerOptions: { plugins: [plugin()] } }],
  ["unrelated-plugin", { compilerOptions: { ...options, plugins: [{ name: "other" }] } }],
  ["diagnostics-false", { compilerOptions: { ...options, plugins: [plugin({ diagnostics: false })] }, vibe: { severities: { EK3897: "error", EK3844: "warning" } } }],
  ["diagnosticSeverity-null", { compilerOptions: { ...options, plugins: [plugin({ diagnosticSeverity: null })] }, vibe: { severities: { EK3897: "error", EK3844: "warning" } } }],
  ["inherited-disable", { extends: "./base.json", compilerOptions: options, vibe: { severities: { EK3897: "error" } } }, { compilerOptions: { plugins: [plugin({ diagnostics: false })] } }],
  ["native-rule-off", { compilerOptions: { ...options, plugins: [plugin({ diagnosticSeverity: { promiseInEffectSuccess: "off" } })] } }],
  ["native-default-off-on", { compilerOptions: { ...options, plugins: [plugin({ diagnosticSeverity: { globalConsole: "warning" } })] } }],
  ["severity-overrides", { compilerOptions: { ...options, plugins: [plugin({ diagnosticSeverity: { promiseInEffectSuccess: "off" } })] }, vibe: { severities: { EK3897: "error", EK3844: "warning" } } }],
  ["severity-only", { compilerOptions: options, vibe: { severities: { EK3897: "error" } } }],
]
const category = { 1: "error", 2: "warning", 3: "suggestion", 4: "suggestion" }
const cli = (dir, args) => {
  const result = spawnSync(server, [...args, "-p", dir, "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
  assert.equal(result.error, undefined, String(result.error))
  const lines = result.stdout.split("\n").filter(Boolean)
  const parsed = lines.flatMap((line) => {
    const m = /^(.+)\((\d+),(\d+)\): (error|warning|suggestion|message) EK(\d+):/.exec(line)
    return m ? [`${m[1]}(${m[2]},${m[3]}) ${m[4]} EK${m[5]}`] : []
  })
  return { status: result.status, diagnostics: parsed.sort(), output: result.stdout + result.stderr }
}
const lsp = async (dir) => {
  const connection = new Connection(server, ["--lsp", "--stdio"], dir, { requestTimeoutMs: 30000 })
  try {
    const rootUri = pathToFileURL(dir).href
    await connection.request("initialize", {
      processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "activation" }],
      capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: { dynamicRegistration: false } }, workspace: { configuration: true } },
    })
    connection.notify("initialized", {})
    const found = []
    for (const [name, text] of Object.entries(sources)) {
      const uri = pathToFileURL(path.join(dir, name)).href
      connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: name.endsWith(".vibe") ? "vibe" : "typescript", version: 1, text } })
      const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
      for (const d of report.items) {
        if (d.source !== "EK") continue
        found.push(`${name}(${d.range.start.line + 1},${d.range.start.character + 1}) ${category[d.severity]} EK${String(d.code).padStart(4, "0")}`)
      }
    }
    return found.sort()
  } finally {
    await connection.close()
  }
}
try {
  for (const [name, config, base] of scenarios) {
    const dir = path.join(root, name)
    fs.mkdirSync(dir)
    fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir")
    fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n')
    for (const [file, text] of Object.entries(sources)) fs.writeFileSync(path.join(dir, file), text)
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ ...config, files: Object.keys(sources) }))
    if (base) fs.writeFileSync(path.join(dir, "base.json"), JSON.stringify(base))
    // Lint runs first: ordinary --noEmit may still refresh compatibility
    // sidecars, whereas lint must create no files.
    const lint = cli(dir, ["lint"])
    assert.deepEqual(fs.readdirSync(dir).sort(), ["base.json", "main.ts", "node_modules", "package.json", "tsconfig.json", "witness.vibe"].filter((f) => base || f !== "base.json"), name + ": lint wrote files")
    const compiler = cli(dir, ["--noEmit"])
    const editor = await lsp(dir)
    const sourceOnly = compiler.diagnostics.filter((d) => !d.startsWith("tsconfig.json"))
    // rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | **Amended 2026-11-03: compiler activation follows the pinned native plugin.** In compiler builds, the language server and `vibelang lint`, the resolved `compilerOptions.plugins` entry named `@effect/language-service` activates the imported rules.
    assert.deepEqual(lint.diagnostics, compiler.diagnostics, name + ": lint differs from the compiler\n" + compiler.output + "\n" + lint.output)
    assert.deepEqual(editor, sourceOnly, name + ": the language server differs from the compiler\n" + compiler.output)
    // rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Parse inheritance, options, native disable settings and file eligibility as the pinned upstream does; `diagnostics: false` or `diagnosticSeverity: null` disables its diagnostics.
    // rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | A `vibe.severities` entry does not re-enable disabled diagnostics.
    // rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Once the plugin's diagnostics are enabled, it overrides rule categories and may enable a default-off rule.
    console.log(`${name}: compiler ${compiler.status}, lint ${lint.status}: ${compiler.diagnostics.join("; ") || "none"}`)
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
