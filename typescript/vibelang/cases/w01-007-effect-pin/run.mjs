// run-seconds: 240
// rule-evidence: docs/design/src/007-tooling.md#the-effect-version | VibeLang supports any stable Effect release in the `^4.1.0` semver range (`>=4.1.0 <5.0.0`), with the repository's tested baseline at `effect@4.1.6` (VIP-32, amended 2026-11-27).
// rule-evidence: docs/design/src/007-tooling.md#the-effect-version | The compiler reads the resolved `effect/package.json`; any version outside the stable `^4.1.0` range (`>=4.1.0 <5.0.0`), including `4.0.x`, `5.x`, and prereleases such as `4.1.6-next.1`, is `EK3201` in the CLI and editor ([VIP-32](../vips/0032-effect-version.md#decision)).
//
// The published packages declare peerDependencies.effect = "^4.1.0" with tested
// baseline 4.1.6. Any version outside >=4.1.0 <5.0.0 (4.0.x, 5.x, prereleases)
// reports one EK3201 on its config in the CLI build and in the language server;
// stable ^4.1.0 versions report nothing.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { compiler, repo, run } from "../../tests/coverage-tooling.mjs"
import { Connection } from "../../lsp-connection.mjs"

const range = "^4.1.0"
const baseline = "4.1.6"
for (const manifest of ["packages/runtime/package.json", "packages/compiler/package.json"]) {
  const json = JSON.parse(fs.readFileSync(path.join(repo, manifest), "utf8"))
  assert.equal(json.peerDependencies.effect, range, manifest + " peer range")
}
const versionSrc = fs.readFileSync(path.join(repo, "packages/runtime/src/version.ts"), "utf8")
assert.match(versionSrc, /PINNED_EFFECT_VERSION = "4\.1\.6"/)
assert.match(versionSrc, /SUPPORTED_EFFECT_RANGE = "\^4\.1\.0"/)
console.log("manifests support effect", range, "baseline", baseline)

const here = path.dirname(fileURLToPath(import.meta.url))
function project(version) {
  const dir = path.join(here, "out", "pin-" + version)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, "node_modules", "effect"), { recursive: true })
  fs.writeFileSync(path.join(dir, "node_modules", "effect", "package.json"), JSON.stringify({ name: "effect", version, type: "module", types: "index.d.ts" }))
  fs.writeFileSync(path.join(dir, "node_modules", "effect", "index.d.ts"), "export {}\n")
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "pin-" + version, type: "module", private: true }))
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: [] }, include: ["*.vibe"] }))
  fs.writeFileSync(path.join(dir, "main.vibe"), "export const n = 1\n")
  fs.writeFileSync(path.join(dir, "other.vibe"), "export const m = 2\n")
  return dir
}

async function editor(dir) {
  const connection = new Connection(compiler, ["--lsp", "--stdio"], dir, { requestTimeoutMs: 30000 })
  const published = []
  const dispatch = connection.dispatch.bind(connection)
  connection.dispatch = (message) => {
    if (message.method === "textDocument/publishDiagnostics") published.push(message.params)
    return dispatch(message)
  }
  try {
    const rootUri = pathToFileURL(dir).href
    await connection.request("initialize", { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: path.basename(dir) }],
      capabilities: { textDocument: { diagnostic: { dynamicRegistration: false }, publishDiagnostics: {} }, workspace: { configuration: true } } })
    connection.notify("initialized", {})
    const uri = pathToFileURL(path.join(dir, "main.vibe")).href
    connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text: "export const n = 1\n" } })
    await connection.request("textDocument/diagnostic", { textDocument: { uri } })
    // Project diagnostics arrive as a notification on the config.
    for (let waited = 0; waited < 10000 && !published.some(p => p.uri.endsWith("/tsconfig.json")); waited += 100) await new Promise(r => setTimeout(r, 100))
  } finally {
    await connection.close()
  }
  return published.filter(p => p.uri.endsWith("/tsconfig.json")).at(-1)?.diagnostics.map(d => d.source + String(d.code).padStart(4, "0")) ?? []
}

for (const version of ["4.0.3", "5.0.0", "4.1.6-next.1", "4.1.0", "4.2.0", baseline]) {
  const dir = project(version)
  const built = run(compiler, ["--pretty", "false", "-p", dir], dir)
  const cli = [...built.output.matchAll(/^tsconfig\.json\(1,1\): error (EK\d+): The resolved effect is ([^;]+);/gm)].map(m => m[1] + " " + m[2])
  const lsp = version === baseline || version === "4.0.3" ? await editor(dir) : null
  console.log([version.padEnd(12), "cli", JSON.stringify(cli), ...(lsp ? ["editor", JSON.stringify(lsp)] : [])].join(" "))
}
