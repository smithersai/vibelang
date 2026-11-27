import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { Connection } from "../../../typescript/vibelang/lsp-connection.mjs"
import { createShimmedProject, nativeBinary, skipReason } from "./_helpers.mjs"

test("shim tsc --lsp --stdio provides diagnostics, hovers, definitions, and completions across mixed .vibe and .ts files", { skip: skipReason }, async (t) => {
  const modelVibe = `export error UserMissing { id: string }

export effect function findUser(id: string) {
  if (!id) throw new UserMissing({ id })
  return "Ada"
}
`
  const bridgeTs = `// @vibe
import { findUser } from "./model.vibe"

export effect function displayUser(id: string) {
  return try findUser(id)
}
`
  const plainTs = `import { displayUser } from "./bridge.js"

export const userEffect = displayUser("1")
`

  const root = createShimmedProject(t, {
    "src/model.vibe": modelVibe,
    "src/bridge.ts": bridgeTs,
    "src/plain.ts": plainTs,
  }, {
    compilerOptions: { allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true },
  })

  const server = new Connection(join(root, "node_modules/.bin/tsc"), ["--lsp", "--stdio"], root, {
    env: { ...process.env, VIBELANG_BINARY: nativeBinary },
    requestTimeoutMs: 15_000,
  })
  t.after(async () => {
    server.process.kill("SIGKILL")
    await server.exited
  })

  const rootUri = pathToFileURL(root).href
  const init = await server.request("initialize", {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "mixed" }],
    capabilities: {
      textDocument: {
        diagnostic: { dynamicRegistration: false },
        hover: { contentFormat: ["markdown", "plaintext"] },
        definition: { linkSupport: true },
        completion: { completionItem: { snippetSupport: false } },
      },
    },
  })
  assert.equal(init.serverInfo.name, "vibelang")
  server.notify("initialized", {})

  const modelUri = pathToFileURL(join(root, "src/model.vibe")).href
  const bridgeUri = pathToFileURL(join(root, "src/bridge.ts")).href
  const plainUri = pathToFileURL(join(root, "src/plain.ts")).href

  server.notify("textDocument/didOpen", { textDocument: { uri: modelUri, languageId: "vibe", version: 1, text: modelVibe } })
  server.notify("textDocument/didOpen", { textDocument: { uri: bridgeUri, languageId: "typescript", version: 1, text: bridgeTs } })
  server.notify("textDocument/didOpen", { textDocument: { uri: plainUri, languageId: "typescript", version: 1, text: plainTs } })

  // 1. Clean diagnostics across all three files
  for (const uri of [modelUri, bridgeUri, plainUri]) {
    const report = await server.request("textDocument/diagnostic", { textDocument: { uri } })
    assert.deepEqual(report.items, [], `expected zero diagnostics for ${uri}`)
  }

  // 2. Hover on displayUser in plain.ts surfaces inferred Effect contract with UserMissing
  const hover = await server.request("textDocument/hover", {
    textDocument: { uri: plainUri },
    position: { line: 2, character: 28 },
  })
  assert.ok(hover?.contents?.value, "expected hover content on displayUser call")
  assert.match(hover.contents.value, /UserMissing/)

  // 3. Go-to-definition from plain.ts jumps to src/bridge.ts
  const def = await server.request("textDocument/definition", {
    textDocument: { uri: plainUri },
    position: { line: 2, character: 28 },
  })
  const targets = Array.isArray(def) ? def : def ? [def] : []
  assert.ok(targets.length > 0, "expected definition target")
  const targetUri = targets[0].targetUri ?? targets[0].uri
  assert.equal(targetUri, bridgeUri)

  // 4. Completions inside // @vibe .ts include imported symbol findUser
  const completion = await server.request("textDocument/completion", {
    textDocument: { uri: bridgeUri },
    position: { line: 4, character: 15 },
  })
  const items = Array.isArray(completion) ? completion : completion?.items ?? []
  assert.ok(items.some((i) => i.label === "findUser"), "expected findUser in completions")

  // 5. Introducing an EK0401 violation in bridge.ts surfaces live EK diagnostic
  server.notify("textDocument/didChange", {
    textDocument: { uri: bridgeUri, version: 2 },
    contentChanges: [{
      text: "// @vibe\nexport function bad() { throw new Error('raw') }\n",
    }],
  })
  const badDiag = await server.request("textDocument/diagnostic", { textDocument: { uri: bridgeUri } })
  assert.ok(badDiag.items.some((d) => String(d.code).includes("401") || String(d.message).includes("EK0401") || d.code === 401),
    `expected EK0401 diagnostic, got ${JSON.stringify(badDiag.items)}`)

  await server.close()
})
