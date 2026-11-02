// Drives the stock TypeScript 7 language server over stdio and checks that it
// answers hovers and diagnostics at positions in a .vibe file through the
// vibelang-ts-mapper content mapper. No editor and no dependencies.
//
//   node lsp-hover.mjs <tsc> <project dir>
//
// Exits 0 when every expectation holds, 1 otherwise.

import { client } from "./protocol-client.mjs"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const [tsc, projectDir] = process.argv.slice(2)
if (!tsc || !projectDir) {
  console.error("usage: node lsp-hover.mjs <tsc> <project dir>")
  process.exit(2)
}

const greetPath = join(projectDir, "src", "greet.vibe")
const greetText = readFileSync(greetPath, "utf8")
const greetUri = pathToFileURL(greetPath).href

// Each expectation names a token in greet.vibe by the text around it, and
// the text the hover must contain.
const hovers = [
  // Inferred: greet's Effect type comes from its projected generator.
  { at: "export function greet", token: "greet", expect: "function greet(name: string): Effect.Effect<string, EmptyName, never>" },
  // A call runs: loud is shout's success type, not an Effect.
  { at: "const loud", token: "loud", expect: "const loud: string" },
  // Annotated with the contract string!!.
  { at: "function shout", token: "shout", expect: "function shout(text: string): Effect.Effect<string, never, never>" },
]

// position returns the LSP position of token inside the first occurrence of at.
function position(at, token) {
  const offset = greetText.indexOf(at)
  if (offset < 0) throw new Error(`fixture has no ${JSON.stringify(at)}`)
  const target = offset + at.indexOf(token)
  const before = greetText.slice(0, target).split("\n")
  return { line: before.length - 1, character: before.at(-1).length }
}

// Share framing, request deadlines and owned-server teardown with the mapper's
// protocol tests. The runner still owns the whole check's 60-second deadline.
const rpc = client(tsc, ["--lsp", "--stdio"], projectDir)
const request = (method, params) => rpc.request(method, params)
const send = message => rpc.notify(message.method, message.params)
let failures = 0
const timeout = setTimeout(() => {
  failures++
  console.error(`lsp-hover: timed out after 60s; server log:\n${rpc.log()}`)
  void rpc.close()
}, 60_000)

try {
  await request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(projectDir).href,
    workspaceFolders: [{ uri: pathToFileURL(projectDir).href, name: "fixture" }],
    capabilities: {
      textDocument: {
        synchronization: { dynamicRegistration: true },
        hover: { dynamicRegistration: true, contentFormat: ["plaintext", "markdown"] },
        diagnostic: { dynamicRegistration: true },
      },
      workspace: { configuration: true },
    },
    initializationOptions: { runExternalCode: true },
  })
  send({ method: "initialized", params: {} })
  send({ method: "textDocument/didOpen", params: { textDocument: { uri: greetUri, languageId: "vibe", version: 1, text: greetText } } })

  for (const hover of hovers) {
    const at = position(hover.at, hover.token)
    const result = await request("textDocument/hover", { textDocument: { uri: greetUri }, position: at })
    const contents = result?.contents?.value ?? JSON.stringify(result)
    const ok = contents.includes(hover.expect)
    if (!ok) failures++
    console.log(`${ok ? "ok  " : "FAIL"} hover greet.vibe:${at.line + 1}:${at.character + 1} ${hover.token}`)
    console.log(`     ${contents.replace(/\n/g, "\n     ")}`)
  }

  const report = await request("textDocument/diagnostic", { textDocument: { uri: greetUri } })
  const diagnostics = (report?.items ?? []).filter((d) => d.severity === 1).map((d) => `greet.vibe:${d.range.start.line + 1}:${d.range.start.character + 1} TS${d.code}: ${d.message}`)
  const expected = "greet.vibe:11:9 TS2322: Type 'string' is not assignable to type 'number'."
  const ok = diagnostics.length === 1 && diagnostics[0] === expected
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} diagnostics greet.vibe`)
  for (const line of diagnostics) console.log(`     ${line}`)

  await request("shutdown")
  send({ method: "exit" })
} catch (error) {
  failures++
  console.error("lsp-hover:", error.message)
} finally {
  clearTimeout(timeout)
  await rpc.close()
}
if (failures > 0) console.error(`lsp-hover: ${failures} check(s) failed; server log:\n${rpc.log()}`)
process.exitCode = failures === 0 ? 0 : 1
