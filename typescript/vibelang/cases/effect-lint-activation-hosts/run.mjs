// run-seconds: 300
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | The existing Effect language-service configuration in `compilerOptions.plugins` selects the imported `effecttsgo/*` rules.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | They run on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | Compiler builds, the language server and `vibelang lint` use the same activation and selection: a resolved plugin entry named `@effect/language-service` enables the rules; `diagnostics: false` or `diagnosticSeverity: null` disables its diagnostics.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | A `vibe.severities` entry never re-enables disabled diagnostics.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | Until the [severity-key activation migration](#severity-key-activation-migration) retires the legacy shortcut, an assigned `EK38xx` key in a config without a resolved plugin entry still activates the whole default plugin, as the legacy release did, and reports `EK3012`; after that retirement, such a key alone activates nothing.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | Once enabled, severity resolves from `vibe.severities`, then the repository's Effect language-service configuration, then the rule's default ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)).
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | An override can enable a default-off rule; every assigned imported code accepts all four severity values, even `"off"` for a default-error rule.
//
// Each scenario is one project with the same sources: a floating Effect
// (`floatingEffect`, EK3801, default "error") in main.vibe and main.ts, a
// `Date.now()` (`globalDate`, EK3846, default "off", a rule VibeLang answers
// itself on .vibe) and a declaration file. The compiler (`-p`), `vibelang lint`
// and the language server's pull diagnostics must report the same imported
// codes and categories for the source files; the compiler and `lint` also
// agree on the config's EK3012 legacy-activation warning.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../lsp-connection.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY
assert.ok(compiler, "VIBELANG_BINARY must name this workspace's compiler")

const source = 'import { Effect } from "effect"\nexport const stamp = () => Date.now()\nEffect.succeed(1)\n'
const declaration = 'import { Effect } from "effect"\nexport declare const task: Effect.Effect<number>\n'
const lsp = "@effect/language-service"
const both = (category) => [`main.ts:EK3801:${category}`, `main.vibe:EK3801:${category}`]

// [name, plugins (undefined: no key), vibe.severities, source diagnostics, config diagnostics]
const scenarios = [
  // The resolved entry selects the rules on .ts and .vibe; declarations are excluded.
  ["plugin-defaults", [{ name: lsp }], undefined, both("error"), []],
  // Disabled diagnostics stay disabled whatever vibe.severities says.
  ["diagnostics-false", [{ name: lsp, diagnostics: false }], { EK3801: "error", EK3846: "warning" }, [], []],
  ["severity-null", [{ name: lsp, diagnosticSeverity: null }], { EK3801: "error", EK3846: "warning" }, [], []],
  // Legacy shortcut: a key without a resolved entry activates the whole default plugin and reports EK3012.
  ["legacy-key", undefined, { EK3801: "warning" }, both("warning"), ["tsconfig.json:EK3012:warning"]],
  ["legacy-other-key", undefined, { EK3846: "warning" }, ["main.ts:EK3801:error", "main.ts:EK3846:warning", "main.vibe:EK3801:error"], ["tsconfig.json:EK3012:warning"]],
  ["legacy-off-key", [], { EK3801: "off" }, [], ["tsconfig.json:EK3012:warning"]],
  ["legacy-unrelated-plugin", [{ name: "other" }], { EK3801: "error" }, both("error"), ["tsconfig.json:EK3012:warning"]],
  // Precedence: vibe.severities, then the plugin's configuration, then the default.
  ["vibe-over-plugin", [{ name: lsp, diagnosticSeverity: { floatingEffect: "warning" } }], { EK3801: "error" }, both("error"), []],
  ["plugin-over-default", [{ name: lsp, diagnosticSeverity: { floatingEffect: "warning" } }], undefined, both("warning"), []],
  // All four values; a default-off rule enabled; a default-error rule turned off.
  ["default-off-enabled", [{ name: lsp }], { EK3846: "error" }, ["main.ts:EK3801:error", "main.ts:EK3846:error", "main.vibe:EK3801:error"], []],
  ["warning", [{ name: lsp }], { EK3801: "warning" }, both("warning"), []],
  ["suggestion", [{ name: lsp }], { EK3801: "suggestion" }, both("suggestion"), []],
  ["off", [{ name: lsp }], { EK3801: "off" }, [], []],
]

const line = /^(.+?)\((\d+),(\d+)\): (error|warning|suggestion|message) ([A-Z]+\d+): /
function cli(dir, args) {
  const r = spawnSync(compiler, [...args, "-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
  assert.equal(r.error, undefined, String(r.error))
  assert.equal(r.signal, null, r.stdout + r.stderr)
  const found = []
  for (const text of (r.stdout + r.stderr).split("\n")) {
    const m = line.exec(text)
    if (m && m[5].startsWith("EK38") || m && m[5] === "EK3012") found.push(`${path.basename(m[1])}:${m[5]}:${m[4]}`)
  }
  return { status: r.status, found: found.sort(), output: r.stdout + r.stderr }
}
const lspCategory = { 1: "error", 2: "warning", 3: "suggestion", 4: "suggestion" }

let failures = []
for (const [name, plugins, severities, want, config] of scenarios) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-hosts-"))
  let connection
  try {
    const compilerOptions = { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], noEmit: true }
    if (plugins !== undefined) compilerOptions.plugins = plugins
    const vibe = { effectGlobals: false, effectModules: false }
    if (severities !== undefined) vibe.severities = severities
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions, vibe, files: ["main.vibe", "main.ts", "decl.d.ts"] }, null, 2))
    fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}')
    fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir")
    fs.writeFileSync(path.join(dir, "main.vibe"), source)
    fs.writeFileSync(path.join(dir, "main.ts"), source)
    fs.writeFileSync(path.join(dir, "decl.d.ts"), declaration)
    const expected = [...want, ...config].sort()
    const build = cli(dir, [])
    const lint = cli(dir, ["lint"])
    if (build.found.join() !== expected.join()) failures.push(`${name}: compiler ${JSON.stringify(build.found)}, want ${JSON.stringify(expected)}\n${build.output}`)
    if (lint.found.join() !== expected.join()) failures.push(`${name}: lint ${JSON.stringify(lint.found)}, want ${JSON.stringify(expected)}\n${lint.output}`)
    connection = new Connection(compiler, ["--lsp", "--stdio"], dir, { requestTimeoutMs: 30000 })
    const rootUri = pathToFileURL(dir).href
    await connection.request("initialize", {
      processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name }],
      capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: { dynamicRegistration: false } }, workspace: { configuration: true } },
    })
    connection.notify("initialized", {})
    const editor = []
    for (const file of ["main.vibe", "main.ts", "decl.d.ts"]) {
      const uri = pathToFileURL(path.join(dir, file)).href
      const text = fs.readFileSync(path.join(dir, file), "utf8")
      connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: file.endsWith(".vibe") ? "vibe" : "typescript", version: 1, text } })
      const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
      for (const d of report.items) {
        const code = typeof d.code === "number" ? `EK${d.code}` : String(d.code)
        if (code.startsWith("EK38")) editor.push(`${file}:${code}:${lspCategory[d.severity]}`)
      }
    }
    editor.sort()
    const sorted = [...want].sort()
    if (editor.join() !== sorted.join()) failures.push(`${name}: language server ${JSON.stringify(editor)}, want ${JSON.stringify(sorted)}`)
  } finally {
    await connection?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
assert.deepEqual(failures, [], failures.join("\n"))
console.log(`imported lint activation agrees across compiler, lint and language server in ${scenarios.length} projects`)
