// declarationMap: a consumer of a built package goes to definition from its
// import to the .vibe declaration, through the .d.ts.map beside the package's
// declarations, in VibeLang's language server and in stock TypeScript's.
import { strict as assert } from "node:assert"
import { spawn } from "node:child_process"
import { mkdirSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { Connection } from "../../../../typescript/vibelang/lsp-connection.mjs"
import { compiler, locate, project, succeed } from "./helpers.mjs"

const library = `// A header, so that lines differ from the declarations'.
export interface User { readonly id: string }

export function greet(user: User): string {
  return "hi " + user.id
}

export effect function load(id: string) {
  return { id }
}

export schema Point { x: number }
`

const consumer = `import { greet, load, Point } from "lib"
export const text = greet({ id: "1" })
export const program = load("1")
export const point = Point
`

async function built(t) {
  const root = project(t, {
    "lib/package.json": JSON.stringify({ name: "lib", type: "module", types: "./dist/users.d.ts", exports: { ".": { types: "./dist/users.d.ts", default: "./dist/users.js" } } }),
    "lib/tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], lib: ["ES2022"], declaration: true, declarationMap: true, outDir: "dist", rootDir: "src" },
      include: ["src"]
    }),
    "lib/src/users.vibe": library,
    "app/tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], lib: ["ES2022"], noEmit: true },
      include: ["src"]
    }),
    "app/src/use.ts": consumer
  })
  mkdirSync(join(root, "app/node_modules"), { recursive: true })
  symlinkSync(join(root, "lib"), join(root, "app/node_modules/lib"))
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: join(root, "lib") })
  return root
}

const names = [["greet(", "greet(user"], ["load(", "load(id"], ["Point\n", "Point {"]]

test("the language server goes from an import to the .vibe declaration", async (t) => {
  const root = await built(t)
  const app = join(root, "app")
  const connection = new Connection(compiler, ["--lsp", "--stdio"], app)
  t.after(() => connection.close())
  const rootUri = pathToFileURL(app).href
  await connection.request("initialize", {
    processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "app" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { definition: { linkSupport: false } } }
  })
  connection.notify("initialized", {})
  const uri = pathToFileURL(join(app, "src/use.ts")).href
  connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text: consumer } })
  for (const [use, declared] of names) {
    const from = locate(consumer, `= ${use}`, "use.ts")
    const result = await connection.request("textDocument/definition", { textDocument: { uri }, position: { line: from.line - 1, character: from.column + 2 } })
    const [location] = [result].flat()
    assert.ok(location, `no definition of ${use}`)
    assert.ok(location.uri.endsWith("/lib/src/users.vibe"), `${use} goes to ${location.uri}`)
    const want = locate(library, declared, "users.vibe")
    assert.deepEqual(location.range.start, { line: want.line - 1, character: want.column }, use)
  }
})

// tsserver, the process editors run. Its session maps a definition through a
// declaration map; the LanguageService API alone does not.
test("stock tsserver goes from an import to the .vibe declaration", async (t) => {
  const root = await built(t)
  const app = join(root, "app")
  const require = createRequire(join(process.env.EFFECT_NODE_MODULES ?? join(import.meta.dirname, "../../../../experiments/node_modules"), "package.json"))
  const server = spawn(process.execPath, [require.resolve("typescript/lib/tsserver.js"), "--disableAutomaticTypingAcquisition"], { cwd: app, stdio: ["pipe", "pipe", "inherit"] })
  t.after(() => server.kill())
  const waiting = new Map()
  let buffer = ""
  server.stdout.setEncoding("utf8").on("data", (chunk) => {
    buffer += chunk
    for (;;) {
      const header = /^Content-Length: (\d+)\r\n\r\n/.exec(buffer)
      if (header === null) return
      const start = header[0].length
      const body = Buffer.from(buffer.slice(start))
      const length = Number(header[1])
      if (body.length < length) return
      const message = JSON.parse(body.subarray(0, length).toString("utf8"))
      buffer = body.subarray(length).toString("utf8").replace(/^\r?\n/, "")
      if (message.type === "response") waiting.get(message.request_seq)?.(message)
    }
  })
  let seq = 0
  const request = (command, args) => new Promise((done) => {
    seq++
    waiting.set(seq, done)
    server.stdin.write(JSON.stringify({ seq, type: "request", command, arguments: args }) + "\n")
  })
  const file = join(app, "src/use.ts")
  server.stdin.write(JSON.stringify({ seq: ++seq, type: "request", command: "open", arguments: { file, fileContent: consumer, scriptKindName: "TS" } }) + "\n")
  for (const [use, declared] of names) {
    const from = locate(consumer, `= ${use}`, "use.ts")
    const response = await request("definition", { file, line: from.line, offset: from.column + 3 })
    assert.ok(response.success, JSON.stringify(response))
    const [definition] = response.body
    assert.ok(definition, `no definition of ${use}`)
    assert.ok(definition.file.endsWith("/lib/src/users.vibe"), `${use} goes to ${definition.file}`)
    const want = locate(library, declared, "users.vibe")
    assert.deepEqual({ line: definition.start.line, column: definition.start.offset - 1 }, want, use)
  }
})
