#!/usr/bin/env node
// The language server an editor starts from the project's typescript package,
// against an installed project. argv[2] is the project.
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { Connection } from "../../typescript/vibelang/lsp-connection.mjs"

const root = process.argv[2]
const server = new Connection(join(root, "node_modules/.bin/tsc"), ["--lsp", "--stdio"], root)
const uri = pathToFileURL(join(root, "src/hello.ts")).href
const text = readFileSync(join(root, "src/hello.ts"), "utf8")
const opened = await server.request("initialize", {
  processId: process.pid, rootUri: pathToFileURL(root).href,
  workspaceFolders: [{ uri: pathToFileURL(root).href, name: "project" }],
  capabilities: { textDocument: { diagnostic: { dynamicRegistration: false } } }
})
assert.equal(opened.serverInfo.name, "vibelang")
server.notify("initialized", {})
server.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text } })
const diagnostics = async () => (await server.request("textDocument/diagnostic", { textDocument: { uri } })).items
assert.deepEqual(await diagnostics(), [])
server.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: text.replace("return `hello", "return nope + `hello") }] })
assert.deepEqual((await diagnostics()).map((item) => item.code), [2304])
await server.request("shutdown")
server.notify("exit")
process.exit(0)
