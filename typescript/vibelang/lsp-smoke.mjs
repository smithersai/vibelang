#!/usr/bin/env node
// Headless language server test. Starts `vibelang --lsp --stdio` on
// vibelang/lsp-fixture, a project with .vibe and .ts files, and checks
// what an editor shows: pulled (and, for a client that cannot pull, pushed) diagnostics, hovers with inferred contracts,
// definitions, references, rename, completions, and file watching across
// .vibe and .ts files.
//
// Usage: node vibelang/lsp-smoke.mjs [vibelang]
//
// vibelang defaults to built/local/vibelang. vibelang/lsp-smoke.sh builds it and
// links the fixture's node_modules first. Each check prints "ok" or "FAIL";
// the exit status is 1 when any check fails.
import { spawn } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, "lsp-fixture")
const server = path.resolve(process.argv[2] ?? path.join(here, "..", "built", "local", "vibelang"))
const requestTimeoutMs = 60_000

// A JSON-RPC connection to a language server over stdio.
class Connection {
  constructor(command, args, cwd) {
    this.process = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
    this.buffer = Buffer.alloc(0)
    this.nextId = 1
    this.pending = new Map()
    this.registrations = []
    this.log = []
    this.exited = new Promise((resolve) => this.process.on("exit", (code, signal) => resolve({ code, signal })))
    this.process.on("error", (error) => {
      for (const { reject } of this.pending.values()) reject(error)
    })
    this.process.stderr.on("data", (chunk) => this.remember(`stderr: ${chunk}`))
    this.process.stdout.on("data", (chunk) => this.receive(chunk))
  }

  remember(line) {
    this.log.push(line.trimEnd())
    if (this.log.length > 40) this.log.shift()
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const end = this.buffer.indexOf("\r\n\r\n")
      if (end < 0) return
      const length = Number(/Content-Length: *(\d+)/i.exec(this.buffer.subarray(0, end).toString())?.[1])
      if (this.buffer.length < end + 4 + length) return
      const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString())
      this.buffer = this.buffer.subarray(end + 4 + length)
      this.dispatch(message)
    }
  }

  dispatch(message) {
    if (message.method === undefined) {
      const waiter = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) waiter?.reject(new Error(`${waiter.method}: ${message.error.message}`))
      else waiter?.resolve(message.result)
      return
    }
    if (message.method === "window/logMessage") this.remember(message.params.message)
    if (message.id === undefined) return
    // A request from the server. Answer the ones a minimal editor answers.
    let result = null
    if (message.method === "workspace/configuration") result = message.params.items.map(() => null)
    if (message.method === "client/registerCapability") this.registrations.push(...message.params.registrations)
    this.send({ jsonrpc: "2.0", id: message.id, result })
  }

  send(message) {
    const body = Buffer.from(JSON.stringify(message))
    this.process.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.process.stdin.write(body)
  }

  request(method, params) {
    const id = this.nextId++
    this.send({ jsonrpc: "2.0", id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method}: no response in ${requestTimeoutMs} ms`)), requestTimeoutMs)
      this.pending.set(id, {
        method,
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error))
      })
    })
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params })
  }

  // close asks the server to shut down and exit, and returns how it exited.
  async close() {
    try {
      await this.request("shutdown")
      this.notify("exit")
    } finally {
      this.process.stdin.end()
      const timer = setTimeout(() => this.process.kill("SIGKILL"), 5_000)
      const exit = await this.exited
      clearTimeout(timer)
      return exit
    }
  }
}

const fileUri = (relative) => pathToFileURL(path.join(fixture, relative)).href
const texts = new Map()
const text = (relative) => {
  if (!texts.has(relative)) texts.set(relative, readFileSync(path.join(fixture, relative), "utf8"))
  return texts.get(relative)
}

// at returns the LSP position of the nth occurrence (from 0) of needle in a
// fixture file, moved right by offset characters.
function at(relative, needle, { nth = 0, offset = 0 } = {}) {
  const source = text(relative)
  let index = -1
  for (let i = 0; i <= nth; i++) {
    index = source.indexOf(needle, index + 1)
    if (index < 0) throw new Error(`${relative} has no occurrence ${nth} of ${JSON.stringify(needle)}`)
  }
  index += offset
  const before = source.slice(0, index)
  return { line: before.split("\n").length - 1, character: index - before.lastIndexOf("\n") - 1 }
}

const position = (relative, needle, options) => ({ textDocument: { uri: fileUri(relative) }, position: at(relative, needle, options) })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function lineOf(relative, needle) {
  return at(relative, needle).line
}

// globMatches reports whether an LSP glob pattern (with **, *, ?, and {a,b})
// matches an absolute path.
function globMatches(glob, file) {
  let pattern = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*" && glob[i + 1] === "*") {
      pattern += glob[i + 2] === "/" ? "(?:.*/)?" : ".*"
      i += glob[i + 2] === "/" ? 2 : 1
    } else if (c === "*") pattern += "[^/]*"
    else if (c === "?") pattern += "[^/]"
    else if (c === "{") pattern += "(?:"
    else if (c === "}") pattern += ")"
    else if (c === ",") pattern += "|"
    else pattern += c.replace(/[.+^$()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${pattern}$`).test(file)
}

function watcherGlob(watcher) {
  const pattern = watcher.globPattern
  if (typeof pattern === "string") return pattern.startsWith("file://") ? fileURLToPath(pattern) : pattern
  const base = typeof pattern.baseUri === "string" ? pattern.baseUri : pattern.baseUri.uri
  return `${fileURLToPath(base)}/${pattern.pattern}`
}

function hoverText(hover) {
  const contents = hover?.contents
  if (contents === undefined) return ""
  if (typeof contents === "string") return contents
  if (Array.isArray(contents)) return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n")
  return contents.value
}

function workspaceEditFiles(edit) {
  const files = new Map()
  for (const [uri, edits] of Object.entries(edit?.changes ?? {})) files.set(uri, edits)
  for (const change of edit?.documentChanges ?? []) if (change.textDocument) files.set(change.textDocument.uri, change.edits)
  return files
}

let failures = 0
async function check(name, body) {
  try {
    await body()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures++
    console.log(`FAIL ${name}: ${error.message}`)
  }
}

console.log(`server: ${server} --lsp --stdio`)
const connection = new Connection(server, ["--lsp", "--stdio"], fixture)
const extraFile = path.join(fixture, "src", "extra.vibe")
try {
  const rootUri = pathToFileURL(fixture).href
  const initialized = await connection.request("initialize", {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "lsp-fixture" }],
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      textDocument: {
        synchronization: { didSave: true },
        hover: { contentFormat: ["markdown", "plaintext"] },
        diagnostic: { dynamicRegistration: false },
        definition: { linkSupport: false },
        references: {},
        rename: { prepareSupport: true },
        completion: { completionItem: { snippetSupport: false } }
      },
      workspace: {
        workspaceFolders: true,
        configuration: true,
        workspaceEdit: { documentChanges: true },
        didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
        symbol: {}
      }
    }
  })
  connection.notify("initialized", {})

  await check("initialize: the server pulls diagnostics and serves hover, definition, references, rename, and completion", () => {
    const caps = initialized.capabilities
    assert(caps.diagnosticProvider, "no diagnosticProvider")
    for (const provider of ["hoverProvider", "definitionProvider", "referencesProvider", "renameProvider", "completionProvider"]) {
      assert(caps[provider], `no ${provider}`)
    }
  })

  await check("initialize: the server names itself vibelang, with its version and the TypeScript it is built on", () => {
    const info = initialized.serverInfo
    assert(info?.name === "vibelang" && /^\d+\.\d+\.\d+.* \(TypeScript .+\)$/.test(info.version ?? ""), `serverInfo ${JSON.stringify(info)}`)
  })

  await check("initialize: renaming a .vibe file asks the server to update its importers", () => {
    const filters = initialized.capabilities.workspace?.fileOperations?.willRename?.filters ?? []
    assert(filters.some((f) => globMatches(f.pattern.glob, extraFile)), `filters ${JSON.stringify(filters)}`)
  })

  const open = (relative, languageId) =>
    connection.notify("textDocument/didOpen", {
      textDocument: { uri: fileUri(relative), languageId, version: 1, text: text(relative) }
    })
  open("src/main.vibe", "vibe")
  open("src/users.ts", "typescript")
  open("src/broken.vibe", "typescript")

  const diagnostics = async (relative) =>
    (await connection.request("textDocument/diagnostic", { textDocument: { uri: fileUri(relative) } })).items

  await check("formatting: a match uses the reversible dprint syntax mapping", async () => {
    const relative = "src/format-match.vibe"
    open(relative, "vibe")
    const source = text(relative)
    const edits = await connection.request("textDocument/formatting", {
      textDocument: { uri: fileUri(relative) },
      options: { tabSize: 2, insertSpaces: true }
    })
    const offset = (p) => source.split("\n").slice(0, p.line).reduce((n, line) => n + line.length + 1, 0) + p.character
    let formatted = source
    for (const edit of [...(edits ?? [])].sort((a, b) => offset(b.range.start) - offset(a.range.start))) {
      formatted = formatted.slice(0, offset(edit.range.start)) + edit.newText + formatted.slice(offset(edit.range.end))
    }
    const expected = 'error Timeout\nexport function h(e: Timeout) {\n  return match (e) {\n    when Timeout: "same";\n  }\n}\n'
    assert(formatted === expected, `formatted ${JSON.stringify(formatted)}`)
  })

  await check("diagnostics: a missing pipe operand reports TS1109 while editing", async () => {
    open("src/malformed-pipe.vibe", "vibe")
    const items = await diagnostics("src/malformed-pipe.vibe")
    assert(items.some((d) => d.code === 1109), `diagnostics ${JSON.stringify(items)}`)
  })

  await check("diagnostics: self-referential service shapes report EK9207", async () => {
    open("src/service-self.vibe", "vibe")
    const items = await diagnostics("src/service-self.vibe")
    assert(items.filter((d) => d.source === "EK" && d.code === 9207).length === 4, `diagnostics ${JSON.stringify(items)}`)
  })

  await check("diagnostics: main.vibe, opened as vibe, checks clean", async () => {
    const items = await diagnostics("src/main.vibe")
    assert(items.length === 0, `expected none, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("diagnostics: users.ts checks clean", async () => {
    const items = await diagnostics("src/users.ts")
    assert(items.length === 0, `expected none, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("diagnostics: broken.vibe, opened as typescript, reports TS2322 at its .vibe span", async () => {
    const items = await diagnostics("src/broken.vibe")
    assert(items.length === 1, `expected one diagnostic, got ${JSON.stringify(items.map((d) => d.message))}`)
    const [item] = items
    assert(item.code === 2322, `expected code 2322, got ${JSON.stringify(item.code)}`)
    const start = at("src/broken.vibe", "count")
    assert(item.range.start.line === start.line && item.range.start.character === start.character, `range ${JSON.stringify(item.range)}`)
  })

  await check("diagnostics: wait.vibe accepts ordinary async and shows a Promise result", async () => {
    open("src/wait.vibe", "vibe")
    const items = await diagnostics("src/wait.vibe")
    assert(items.length === 0, "ordinary async diagnostics: " + JSON.stringify(items.map(d => d.message)))
    const shown = hoverText(await connection.request("textDocument/hover", {
      textDocument: { uri: fileUri("src/wait.vibe") },
      position: at("src/wait.vibe", "wait()")
    }))
    assert(shown.includes("Promise<number>"), "ordinary async hover: " + JSON.stringify(shown))
  })

  await check("code action: await on a fiber is EK4609, and its quick fix writes join; on a Deferred, EK4610 writes d.await()", async () => {
    open("src/old-await.vibe", "vibe")
    const items = await diagnostics("src/old-await.vibe")
    const codes = items.map((d) => `${d.source}${d.code}`).sort()
    assert(JSON.stringify(codes) === JSON.stringify(["EK4609", "EK4610"]), `codes ${JSON.stringify(codes)}`)
    const uri = fileUri("src/old-await.vibe")
    const fixFor = async (item, title) => {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      const fix = actions.find((a) => a.title === title)
      assert(fix, `no quick fix ${title} among ${JSON.stringify(actions.map((a) => a.title))}`)
      return fix.edit?.changes?.[uri] ?? []
    }
    const fiber = items.find((d) => d.code === 4609)
    const fiberEdits = await fixFor(fiber, "Join the fiber with join")
    assert(fiberEdits.length === 1 && fiberEdits[0].newText === "join" && JSON.stringify(fiberEdits[0].range) === JSON.stringify(fiber.range), `edits ${JSON.stringify(fiberEdits)}`)
    const deferred = items.find((d) => d.code === 4610)
    const deferredEdits = await fixFor(deferred, "Wait for the Deferred with .await()")
    const start = at("src/old-await.vibe", "await d")
    assert(deferredEdits.length === 1 && deferredEdits[0].newText === "d.await()" && deferredEdits[0].range.start.line === start.line && deferredEdits[0].range.start.character === start.character && deferredEdits[0].range.end.character === start.character + "await d".length, `edits ${JSON.stringify(deferredEdits)}`)
  })

  await check("code action: EK2120 and EK2121 warn at the old service and layer spellings, and their quick fixes write the current ones", async () => {
    const file = "src/old-declarations.vibe"
    open(file, "vibe")
    const items = await diagnostics(file)
    const codes = items.map((d) => `${d.source} ${d.code} ${d.severity}`).sort()
    assert(JSON.stringify(codes) === JSON.stringify(["EK 2120 2", "EK 2121 2"]), `diagnostics ${JSON.stringify(codes)}`)
    const uri = fileUri(file)
    const service = items.find((d) => d.code === 2120)
    const serviceStart = at(file, "service class Greeting")
    assert(service.range.start.line === serviceStart.line && service.range.start.character === serviceStart.character, `EK2120 range ${JSON.stringify(service.range)}`)
    const serviceActions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: service.range, context: { diagnostics: [service], only: ["quickfix"] } })) ?? []
    const serviceFix = serviceActions.find((a) => a.title === "Write service without class")
    assert(serviceFix, `no EK2120 quick fix among ${JSON.stringify(serviceActions.map((a) => a.title))}`)
    const serviceEdits = serviceFix.edit?.changes?.[uri] ?? []
    assert(serviceEdits.length === 1 && serviceEdits[0].newText === "service" && JSON.stringify(serviceEdits[0].range) === JSON.stringify(service.range), `EK2120 edits ${JSON.stringify(serviceEdits)}`)
    const layer = items.find((d) => d.code === 2121)
    const layerStart = at(file, "layer GreetingLive")
    assert(layer.range.start.line === layerStart.line && layer.range.start.character === layerStart.character, `EK2121 range ${JSON.stringify(layer.range)}`)
    const layerActions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: layer.range, context: { diagnostics: [layer], only: ["quickfix"] } })) ?? []
    const layerFix = layerActions.find((a) => a.title === "Rewrite the layer declaration as a Layer call")
    assert(layerFix, `no EK2121 quick fix among ${JSON.stringify(layerActions.map((a) => a.title))}`)
    const layerEdits = layerFix.edit?.changes?.[uri] ?? []
    const want = "const GreetingLive = Layer.effect(Greeting) {\n  const word = \"hi\"\n  return {\n    text() { return word }\n  }\n}"
    assert(layerEdits.length === 1 && layerEdits[0].newText === want, `EK2121 edits ${JSON.stringify(layerEdits)}`)
    assert(layerEdits[0].range.start.line === layerStart.line && layerEdits[0].range.end.line === lineOf(file, "text() { return word }") + 1, `EK2121 edit range ${JSON.stringify(layerEdits[0].range)}`)
  })

  await check("code action: TypeScript-style forms warn as EK4830 and EK4833, and their quick fixes write an error declaration and A!E", async () => {
    const file = "src/ts-forms.vibe"
    open(file, "vibe")
    const items = await diagnostics(file)
    const codes = items.map((d) => `${d.source} ${d.code} ${d.severity}`).sort()
    assert(JSON.stringify(codes) === JSON.stringify(["EK 4830 2", "EK 4833 2"]), `diagnostics ${JSON.stringify(codes)}`)
    const uri = fileUri(file)
    const fixOf = async (item, title) => {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      const fix = actions.find((a) => a.title === title)
      assert(fix, `no quick fix ${JSON.stringify(title)} among ${JSON.stringify(actions.map((a) => a.title))}`)
      return fix.edit?.changes?.[uri] ?? []
    }
    const error = items.find((d) => d.code === 4830)
    const errorEdits = await fixOf(error, "Write error NotFound { id: string }")
    const classAt = at(file, "class NotFound")
    assert(errorEdits.length === 1 && errorEdits[0].newText === "error NotFound { id: string }", `EK4830 edits ${JSON.stringify(errorEdits)}`)
    assert(errorEdits[0].range.start.line === classAt.line && errorEdits[0].range.start.character === classAt.character, `EK4830 edit range ${JSON.stringify(errorEdits[0].range)}`)
    const type = items.find((d) => d.code === 4833)
    const typeEdits = await fixOf(type, "Write string!NotFound")
    const typeAt = at(file, "Effect.Effect<string")
    assert(typeEdits.length === 1 && typeEdits[0].newText === "string!NotFound", `EK4833 edits ${JSON.stringify(typeEdits)}`)
    assert(typeEdits[0].range.start.line === typeAt.line && typeEdits[0].range.start.character === typeAt.character, `EK4833 edit range ${JSON.stringify(typeEdits[0].range)}`)
  })

  await check("code action: EK2112 warns at a typed catch clause, and its quick fix writes a match", async () => {
    open("src/old-catch.vibe", "vibe")
    const items = (await diagnostics("src/old-catch.vibe")).filter((d) => d.code === 2112)
    assert(items.length === 2, `expected two EK2112 warnings, got ${JSON.stringify(items.map((d) => d.message))}`)
    const [item] = items
    assert(item.source === "EK" && item.severity === 2, `expected warning EK 2112, got ${item.source} severity ${item.severity}`)
    const start = at("src/old-catch.vibe", "Missing) {")
    assert(item.range.start.line === start.line && item.range.start.character === start.character, `range ${JSON.stringify(item.range)}`)
    const uri = fileUri("src/old-catch.vibe")
    const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
    const fix = actions.find((a) => a.title === "Test the failure with match")
    assert(fix, `no quick fix among ${JSON.stringify(actions.map((a) => a.title))}`)
    const edits = fix.edit?.changes?.[uri] ?? []
    const want = "catch (e) {\n    return match (e) {\n      when Missing: `missing ${e.id}`;\n      when Late: \"late\";\n      default: throw e;\n    }\n  }"
    assert(edits.length === 1 && edits[0].newText === want, `edits ${JSON.stringify(edits)}`)
    const catchAt = at("src/old-catch.vibe", "catch (e: Missing)")
    assert(edits[0].range.start.line === catchAt.line && edits[0].range.start.character === catchAt.character, `edit range ${JSON.stringify(edits[0].range)}`)
  })

  await check("code action: EK2113 warns at a Cause clause, and its quick fix matches on exit", async () => {
    const items = (await diagnostics("src/old-catch.vibe")).filter((d) => d.code === 2113)
    assert(items.length === 1, `expected one EK2113 warning, got ${JSON.stringify(items.map((d) => d.message))}`)
    const [item] = items
    const uri = fileUri("src/old-catch.vibe")
    const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
    const fix = actions.find((a) => a.title === "Match on exit(…)")
    assert(fix, `no quick fix among ${JSON.stringify(actions.map((a) => a.title))}`)
    const edits = fix.edit?.changes?.[uri] ?? []
    const want = "return match (exit(lookupUser(id))) {\n    when Exit.Success(let value): value;\n    when Exit.Failure(let cause): \"fallback\";\n  }"
    assert(edits.length === 1 && edits[0].newText === want, `edits ${JSON.stringify(edits)}`)
  })

  await check("diagnostics: catch-expression.vibe, with a fallback and a handler, checks clean", async () => {
    open("src/catch-expression.vibe", "vibe")
    const items = await diagnostics("src/catch-expression.vibe")
    assert(items.length === 0, `expected no diagnostics, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("code action: EK4405 reports a hatch reading a parameter, and its quick fix passes it as an input", async () => {
    open("src/hatch-outside.vibe", "vibe")
    const items = await diagnostics("src/hatch-outside.vibe")
    assert(items.length === 1, `expected one diagnostic, got ${JSON.stringify(items.map((d) => d.message))}`)
    const [item] = items
    assert(item.source === "EK" && item.code === 4405, `expected EK 4405, got ${item.source} ${JSON.stringify(item.code)}`)
    const start = at("src/hatch-outside.vibe", "text.length")
    assert(item.range.start.line === start.line && item.range.start.character === start.character, `range ${JSON.stringify(item.range)}`)
    const uri = fileUri("src/hatch-outside.vibe")
    const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
    const fix = actions.find((a) => a.title === "Pass text as an input")
    assert(fix, `no quick fix among ${JSON.stringify(actions.map((a) => a.title))}`)
    const edits = fix.edit?.changes?.[uri] ?? []
    const lines = text("src/hatch-outside.vibe").split("\n")
    const offset = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character
    let fixed = text("src/hatch-outside.vibe")
    for (const e of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start))) {
      fixed = fixed.slice(0, offset(e.range.start)) + e.newText + fixed.slice(offset(e.range.end))
    }
    assert(fixed.includes("return sync((text: string) => text.length, text)"), `fixed text: ${fixed}`)
  })

  await check("code action: Effect's language service rules report in .vibe, and their quick fixes call and rename", async () => {
    open("src/lsrules.vibe", "vibe")
    const items = await diagnostics("src/lsrules.vibe")
    const codes = items.map((d) => `${d.source}${d.code}:${d.severity}`).sort()
    // EK4833 is the TypeScript spelling of discard's parameter type (D287).
    assert(JSON.stringify(codes) === JSON.stringify(["EK4801:1", "EK4808:2", "EK4813:1", "EK4833:2"]), `codes ${JSON.stringify(codes)}`)
    const uri = fileUri("src/lsrules.vibe")
    const fixFor = async (item, title) => {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      const fix = actions.find((a) => a.title === title)
      assert(fix, `no quick fix ${title} among ${JSON.stringify(actions.map((a) => a.title))}`)
      return fix.edit?.changes?.[uri] ?? []
    }
    const floating = items.find((d) => d.code === 4801)
    const start = at("src/lsrules.vibe", "program\n  //")
    assert(floating.range.start.line === start.line && floating.range.start.character === start.character, `range ${JSON.stringify(floating.range)}`)
    const callEdits = await fixFor(floating, "Call it to run it")
    assert(callEdits.length === 1 && callEdits[0].newText === "()" && callEdits[0].range.start.character === start.character + "program".length, `edits ${JSON.stringify(callEdits)}`)
    const nested = items.find((d) => d.code === 4808)
    const nestedActions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: nested.range, context: { diagnostics: [nested], only: ["quickfix"] } })) ?? []
    assert(!nestedActions.some((a) => a.title === "Provide both layers in one block"), `unsafe nested provide merge: ${JSON.stringify(nestedActions)}`)
    const renameEdits = await fixFor(items.find((d) => d.code === 4813), "Write Effect.catch")
    assert(renameEdits.length === 1 && renameEdits[0].newText === "catch", `edits ${JSON.stringify(renameEdits)}`)
  })

  // D266: a .ts file keeps TypeScript's verdict, so yield without * draws no
  // EK4819 there; TS2339 on an Effect 3 name still offers EK4813's rename.
  await check("code action: in a .ts file, yield without * draws no EK diagnostic (D266), and TS2339 on an Effect 3 name renames it", async () => {
    open("src/lsrules-gen.ts", "typescript")
    const items = await diagnostics("src/lsrules-gen.ts")
    const codes = items.map((d) => `${d.source ?? "ts"}${d.code}`).sort()
    assert(JSON.stringify(codes) === JSON.stringify(["ts2339"]), `codes ${JSON.stringify(codes)}`)
    const uri = fileUri("src/lsrules-gen.ts")
    const fixFor = async (item, title) => {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      const fix = actions.find((a) => a.title === title)
      assert(fix, `no quick fix ${title} among ${JSON.stringify(actions.map((a) => a.title))}`)
      return fix.edit?.changes?.[uri] ?? []
    }
    const renameEdits = await fixFor(items.find((d) => d.code === 2339), "Write Effect.catch")
    assert(renameEdits.length === 1 && renameEdits[0].newText === "catch", `edits ${JSON.stringify(renameEdits)}`)
  })

  // apply returns a file's text after edits, which do not overlap.
  const apply = (relative, edits) => {
    const lines = text(relative).split("\n")
    const offset = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character
    let result = text(relative)
    for (const e of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start))) {
      result = result.slice(0, offset(e.range.start)) + e.newText + result.slice(offset(e.range.end))
    }
    return result
  }

  await check("refactor: Effect's language service refactors write a contract, a schema, a VibeLang function, pipes, and a pipe style", async () => {
    open("src/lsrules-editor.vibe", "vibe")
    const relative = "src/lsrules-editor.vibe"
    const uri = fileUri(relative)
    const refactor = async (needle, title, options) => {
      const start = at(relative, needle, options)
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: { start, end: start }, context: { diagnostics: [], only: ["refactor"] } })) ?? []
      const action = actions.find((a) => a.title === title)
      assert(action, `no refactor ${title} at ${needle} among ${JSON.stringify(actions.map((a) => a.title))}`)
      assert(action.kind === "refactor.rewrite", `kind ${action.kind}`)
      return apply(relative, action.edit?.changes?.[uri] ?? [])
    }
    const contract = await refactor("greet()", "Write the inferred contract")
    assert(contract.includes("export function greet(): string!!Greeting {"), `contract: ${contract.split("\n").find((l) => l.includes("greet("))}`)
    const schema = await refactor("interface Point", "Convert to a schema declaration")
    assert(schema.includes("schema Point {\n  x: number\n  y: number\n}"), "schema not written")
    const plain = await refactor("async function", "Convert to a VibeLang function")
    assert(plain.includes("export function size(text: string) {\n  const length = try Effect.tryPromise(() => Promise.resolve(text.length))"), `async: ${plain.split("\n").filter((l) => l.includes("size") || l.includes("length =")).join(" / ")}`)
    const mapped = await refactor("async function", "Convert to a VibeLang function with an error per await")
    assert(mapped.includes("error ResolveFailed { cause: unknown }\nexport function size(") && mapped.includes("try Effect.tryPromise({ try: () => Promise.resolve(text.length), catch: (cause) => new ResolveFailed({ cause }) })"), "errors not written")
    const toPipe = await refactor("inc(double(1))", "Convert to a pipe")
    assert(toPipe.includes("export const piped = 1 |> double(%) |> inc(%)"), "pipe not written")
    const toCalls = await refactor("1 |> double", "Convert the pipe to calls", { offset: 2 })
    assert(toCalls.includes("export const unpiped = inc(double(1))"), "calls not written")
    const style = await refactor(".pipe(Option.map", "Write pipe(x, …)", { offset: 1 })
    assert(style.includes("export const styled = pipe(Option.some(1), Option.map((n: number) => n + 1))"), "pipe style not toggled")
  })

  await check("hover: a layer shows what it provides and needs, and wire the order it builds in", async () => {
    const relative = "src/lsrules-editor.vibe"
    const layer = hoverText(await connection.request("textDocument/hover", position(relative, "AppLive =")))
    assert(/Layer: provides `(Greeting|Name)` and `(Greeting|Name)`; needs nothing\./.test(layer), `layer hover: ${layer}`)
    const wire = hoverText(await connection.request("textDocument/hover", position(relative, "wire(GreetingLive")))
    assert(wire.includes("wire builds its layers in this order:\n1. `NameLive` provides `Name`\n2. `GreetingLive` provides `Greeting`, using `NameLive`"), `wire hover: ${wire}`)
  })

  await check("completion: Duration strings, a brand's name, and @vibelang-diagnostics codes", async () => {
    const relative = "src/lsrules-editor.vibe"
    const labels = async (needle, offset) => {
      const result = await connection.request("textDocument/completion", position(relative, needle, { offset }))
      return (Array.isArray(result) ? result : result?.items ?? []).map((item) => item.label)
    }
    const durations = await labels("\"2 seconds\"", 4)
    assert(durations.includes("2 seconds") && durations.includes("2 millis"), `durations ${JSON.stringify(durations)}`)
    const brands = await labels("brand(\"UserId\")", 7)
    assert(JSON.stringify(brands) === JSON.stringify(["UserId"]), `brands ${JSON.stringify(brands)}`)
    const codes = await labels("EK4823:warning", 4)
    assert(codes.includes("EK4801:off") && codes.includes("*:off"), `codes ${JSON.stringify(codes.slice(0, 5))}`)
  })

  await check("code action: a comment turns EK4823 on, and its quick fix writes the value as the body", async () => {
    const relative = "src/lsrules-editor.vibe"
    const items = (await diagnostics(relative)).filter((d) => d.code === 4823)
    assert(items.length === 1 && items[0].severity === 2, `EK4823 ${JSON.stringify(items)}`)
    const uri = fileUri(relative)
    const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: items[0].range, context: { diagnostics: items, only: ["quickfix"] } })) ?? []
    const fix = actions.find((a) => a.title === "Write the value as the body")
    assert(fix, `no quick fix among ${JSON.stringify(actions.map((a) => a.title))}`)
    assert(apply(relative, fix.edit.changes[uri]).includes("export const increment = (n: number) => n + 1\n"), "body not written")
  })

  await check("diagnostics: an edit to main.vibe is checked with VibeLang types", async () => {
    // name is the success value of lookup(1), a string, so toFixed does not exist.
    const broken = text("src/main.vibe").replace("name.toUpperCase()", "name.toFixed()")
    const uri = fileUri("src/main.vibe")
    connection.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: broken }] })
    const items = await diagnostics("src/main.vibe")
    connection.notify("textDocument/didChange", { textDocument: { uri, version: 3 }, contentChanges: [{ text: text("src/main.vibe") }] })
    assert(items.some((d) => d.code === 2339 || d.code === 2551), `expected TS2339 on toFixed, got ${JSON.stringify(items.map((d) => d.message))}`)
    assert((await diagnostics("src/main.vibe")).length === 0, "the reverted file still has diagnostics")
  })

  const hover = async (relative, needle, options) => hoverText(await connection.request("textDocument/hover", position(relative, needle, options)))

  await check("hover: a .vibe function shows its inferred contract", async () => {
    const shown = await hover("src/main.vibe", "lookup(id")
    assert(shown.includes("function lookup(id: number): string!NotFound!"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a contract written Effect<...> shows in the ! form, as one written in the ! form does", async () => {
    const spelled = await hover("src/spellings.vibe", "spelled(id: string)")
    assert(spelled.includes("function spelled(id: string): string!Missing!"), `got ${JSON.stringify(spelled)}`)
    const terse = await hover("src/spellings.vibe", "terse(id: string)")
    assert(terse.includes("function terse(id: string): string!Missing!"), `got ${JSON.stringify(terse)}`)
    assert((await diagnostics("src/spellings.vibe")).length === 0, "both spellings check without diagnostics")
  })

  await check("hover: a hatch's callee says its TypeScript is self-contained and lists its inputs", async () => {
    const shown = await hover("src/hatch-outside.vibe", "sync((t)")
    assert(shown.includes("self-contained TypeScript (D229)") && shown.includes("Inputs, which fill its first parameters: `text`."), `hover ${shown}`)
  })

  await check("hover: an exported .vibe function shows the contract its callee's failure flows into", async () => {
    const shown = await hover("src/main.vibe", "main()", { offset: 1 })
    assert(shown.includes("function main(): void!NotFound!"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a call that runs shows the callee's contract and the success value", async () => {
    const shown = await hover("src/main.vibe", "lookup(1)")
    assert(shown.includes("function lookup(id: number): string!NotFound!"), `got ${JSON.stringify(shown)}`)
    assert(/Runs here and returns `string`/.test(shown), `no success value in ${JSON.stringify(shown)}`)
  })

  await check("hover: VibeLang's notes come first, then a rule, then the JSDoc", async () => {
    const documented = await hover("src/hover-notes.vibe", "greet(\"Ada\")")
    const notes = documented.indexOf("Runs here and returns `string`")
    const rule = documented.indexOf("\n\n---\n\n")
    const jsdoc = documented.indexOf("Greets someone by name.")
    assert(notes >= 0 && rule > notes && jsdoc > rule, `expected notes, then ---, then JSDoc in ${JSON.stringify(documented)}`)
    const undocumented = await hover("src/hover-notes.vibe", "shout(\"Ada\")")
    assert(/Runs here and returns `string`/.test(undocumented), `no note in ${JSON.stringify(undocumented)}`)
    assert(!undocumented.includes("\n---\n"), `a hover without JSDoc has a rule: ${JSON.stringify(undocumented)}`)
  })

  await check("hover: a TypeScript call that runs shows its success value", async () => {
    const shown = await hover("src/main.vibe", "findName(id)")
    assert(/Runs here and returns `string`/.test(shown), `no success value in ${JSON.stringify(shown)}`)
  })

  await check("hover: a variable holding a call's result has the success type", async () => {
    const shown = await hover("src/main.vibe", "name = ")
    assert(shown.includes("const name: string"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a call to Effect.fail in a .vibe body runs and fails", async () => {
    const shown = await hover("src/main.vibe", "Effect.fail", { offset: 7 })
    assert(/Runs here and returns `never`/.test(shown), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a call passed by name says it runs as a program", async () => {
    const shown = await hover("src/main.vibe", "greeting(), ")
    assert(/Passed by name to `Effect\.timeout` as a program: it runs when that program runs, not here, and returns `string`/.test(shown), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a call in a .ts file does not run", async () => {
    const shown = await hover("src/users.ts", "Effect.succeed", { offset: 7 })
    assert(shown.includes("succeed") && !shown.includes("Runs here"), `got ${JSON.stringify(shown)}`)
  })

  const definition = async (relative, needle, options) => {
    const result = await connection.request("textDocument/definition", position(relative, needle, options))
    return Array.isArray(result) ? result : result ? [result] : []
  }

  await check("definition: a .ts function called from .vibe goes to users.ts", async () => {
    const [location, ...rest] = await definition("src/main.vibe", "findName(id)")
    assert(location && rest.length === 0, `expected one location, got ${JSON.stringify([location, ...rest])}`)
    assert(location.uri === fileUri("src/users.ts"), `went to ${location.uri}`)
    assert(location.range.start.line === lineOf("src/users.ts", "export function findName"), `line ${location.range.start.line}`)
  })

  await check("definition: a .vibe call goes to the .vibe declaration", async () => {
    const [location] = await definition("src/main.vibe", "lookup(1)")
    assert(location?.uri === fileUri("src/main.vibe"), `went to ${location?.uri}`)
    assert(location.range.start.line === lineOf("src/main.vibe", "function lookup"), `line ${location.range.start.line}`)
  })

  await check("diagnostics: data.vibe, with a data declaration, checks clean", async () => {
    open("src/data.vibe", "vibe")
    const items = await diagnostics("src/data.vibe")
    assert(items.length === 0, `expected none, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("hover: a data type shows its declaration, and a variant its fields", async () => {
    const declaration = await hover("src/data.vibe", "delivery: Delivery", { offset: 10 })
    assert(declaration.includes("data Delivery {\n  Waiting\n  Sent { tracking: string }\n  Rejected { reason: string }\n}"), `got ${JSON.stringify(declaration)}`)
    const variant = await hover("src/data.vibe", "Sent({", {})
    assert(variant.includes("(variant) Delivery.Sent { tracking: string }"), `got ${JSON.stringify(variant)}`)
    const pattern = await hover("src/data.vibe", "Waiting:", {})
    assert(pattern.includes("(variant) Delivery.Waiting"), `got ${JSON.stringify(pattern)}`)
  })

  await check("definition: a data variant goes to the variant in its declaration", async () => {
    for (const needle of ["Sent({", "Sent { let"]) {
      const [location, ...rest] = await definition("src/data.vibe", needle)
      assert(location && rest.length === 0, `${needle}: expected one location, got ${JSON.stringify([location, ...rest])}`)
      const want = at("src/data.vibe", "Sent { tracking")
      assert(location.uri === fileUri("src/data.vibe") && location.range.start.line === want.line && location.range.start.character === want.character, `${needle}: range ${JSON.stringify(location.range)}`)
    }
  })

  await check("diagnostics: module.vibe, with a module declaration, checks clean", async () => {
    open("src/module.vibe", "vibe")
    const items = await diagnostics("src/module.vibe")
    assert(items.length === 0, `expected none, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("hover: a parameter inside a module declaration's body has its TypeScript type", async () => {
    const shown = await hover("src/module.vibe", "value.trim")
    assert(shown.includes("value: string"), `got ${JSON.stringify(shown)}`)
  })

  await check("definition: a call to a module's export goes into the module's body", async () => {
    const [location, ...rest] = await definition("src/module.vibe", "clean(input)")
    assert(location && rest.length === 0, `expected one location, got ${JSON.stringify([location, ...rest])}`)
    assert(location.uri === fileUri("src/module.vibe"), `went to ${location.uri}`)
    const want = at("src/module.vibe", "clean(value", {})
    assert(location.range.start.line === want.line && location.range.start.character === want.character, `range ${JSON.stringify(location.range)}`)
  })

  await check("diagnostics: an edit inside a module's body is checked as TypeScript, at its .vibe position", async () => {
    const broken = text("src/module.vibe").replace("return value.trim()", "return value.length")
    const uri = fileUri("src/module.vibe")
    connection.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: broken }] })
    const items = await diagnostics("src/module.vibe")
    connection.notify("textDocument/didChange", { textDocument: { uri, version: 3 }, contentChanges: [{ text: text("src/module.vibe") }] })
    const error = items.find((d) => d.code === 2322)
    assert(error, `expected TS2322, got ${JSON.stringify(items.map((d) => d.message))}`)
    assert(error.range.start.line === lineOf("src/module.vibe", "return value.trim()"), `range ${JSON.stringify(error.range)}`)
    assert((await diagnostics("src/module.vibe")).length === 0, "the reverted file still has diagnostics")
  })

  await check("references: a .ts function's references include its .vibe callers", async () => {
    const locations = await connection.request("textDocument/references", {
      ...position("src/users.ts", "findName"),
      context: { includeDeclaration: true }
    })
    const lines = locations.filter((l) => l.uri === fileUri("src/main.vibe")).map((l) => l.range.start.line)
    assert(lines.includes(lineOf("src/main.vibe", "findName(id)")), `main.vibe lines ${JSON.stringify(lines)}`)
    assert(locations.some((l) => l.uri === fileUri("src/users.ts")), "no users.ts location")
  })

  await check("rename: renaming a .ts function edits its .vibe callers", async () => {
    const edit = await connection.request("textDocument/rename", { ...position("src/users.ts", "findName"), newName: "nameOf" })
    const files = workspaceEditFiles(edit)
    const lines = (relative) => (files.get(fileUri(relative)) ?? []).map((e) => e.range.start.line).sort((a, b) => a - b)
    const expected = [lineOf("src/main.vibe", "import { findName"), lineOf("src/main.vibe", "findName(id)")]
    assert(JSON.stringify(lines("src/main.vibe")) === JSON.stringify(expected), `main.vibe edit lines ${JSON.stringify(lines("src/main.vibe"))}, want ${JSON.stringify(expected)}`)
    assert(lines("src/users.ts").length === 1, `users.ts edits: ${JSON.stringify(files.get(fileUri("src/users.ts")))}`)
  })

  await check("rename: renaming a .vibe function edits its declaration and calls", async () => {
    const edit = await connection.request("textDocument/rename", { ...position("src/main.vibe", "lookup(1)"), newName: "find" })
    const lines = (workspaceEditFiles(edit).get(fileUri("src/main.vibe")) ?? []).map((e) => e.range.start.line).sort((a, b) => a - b)
    const expected = [lineOf("src/main.vibe", "function lookup"), lineOf("src/main.vibe", "lookup(1)")]
    assert(JSON.stringify(lines) === JSON.stringify(expected), `edit lines ${JSON.stringify(lines)}, want ${JSON.stringify(expected)}`)
  })

  const completionLabels = async (relative, needle, options) => {
    const result = await connection.request("textDocument/completion", position(relative, needle, options))
    return (Array.isArray(result) ? result : result.items).map((item) => item.label)
  }

  await check("completion: members of an imported Effect module in .vibe", async () => {
    const labels = await completionLabels("src/main.vibe", "Console.log", { offset: 8 })
    assert(labels.includes("log") && labels.includes("error"), `labels ${JSON.stringify(labels.slice(0, 20))}`)
  })

  await check("completion: module service members after a dot and a partial name", async () => {
    for (const [needle, offsets, expected] of [
      ["FileSystem.readFileString", [11, 14], ["readFileString", "exists", "FileSystem", "makeNoop"]],
      ["Experimental.Process.hostname", [21, 24], ["hostname", "pid", "Process", "layerTest"]]
    ]) {
      for (const offset of offsets) {
        const labels = await completionLabels("src/services.vibe", needle, { offset })
        for (const name of expected) assert(labels.includes(name), `${needle} at ${offset}: no ${name} in ${JSON.stringify(labels)}`)
        assert(new Set(labels).size === labels.length, `${needle}: duplicate completions`)
      }
    }
  })

  await check("completion: a data type's variants after its name", async () => {
    const labels = await completionLabels("src/data.vibe", "Delivery.Sent({", { offset: 9 })
    for (const variant of ["Waiting", "Sent", "Rejected"]) assert(labels.includes(variant), `labels ${JSON.stringify(labels)}`)
  })

  await check("hover: a method of an Effect data type names the function it calls", async () => {
    const shown = await hover("src/main.vibe", "getOrElse(() =>")
    assert(/Method syntax: calls `Option\.getOrElse\(/.test(shown), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a topic passed by name names the program's receiver", async () => {
    const shown = await hover("src/main.vibe", "%, \"1 second\") |>")
    assert(shown.includes("Passed by name to `Effect.timeout` as a program: `greeting()` runs when that program runs"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a topic used as a value shows its type and left side", async () => {
    const shown = await hover("src/main.vibe", "${%}!", { offset: 2 })
    assert(shown.includes("(topic) %: string") && shown.includes("runs once, before the pipe's body"), `got ${JSON.stringify(shown)}`)
  })

  await check("formatting: a pipe keeps |> together", async () => {
    const edits = await connection.request("textDocument/formatting", { textDocument: { uri: fileUri("src/main.vibe") }, options: { tabSize: 2, insertSpaces: true } })
    const lines = text("src/main.vibe").split("\n")
    for (const edit of [...(edits ?? [])].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character)) {
      const { start, end } = edit.range
      const head = lines[start.line].slice(0, start.character), tail = lines[end.line].slice(end.character)
      lines.splice(start.line, end.line - start.line + 1, ...(head + edit.newText + tail).split("\n"))
    }
    const formatted = lines.join("\n")
    assert(formatted.includes('greeting() |> Effect.timeout(%, "1 second") |> `${%}!`'), `formatted to ${JSON.stringify(formatted.split("\n").filter((l) => l.includes("greeting()")))}`)
  })

  await check("formatting: throw, do, and a program arrow keep their shape", async () => {
    const edits = await connection.request("textDocument/formatting", { textDocument: { uri: fileUri("src/main.vibe") }, options: { tabSize: 2, insertSpaces: true } })
    const lines = text("src/main.vibe").split("\n")
    for (const edit of [...(edits ?? [])].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character)) {
      const { start, end } = edit.range
      const head = lines[start.line].slice(0, start.character), tail = lines[end.line].slice(end.character)
      lines.splice(start.line, end.line - start.line + 1, ...(head + edit.newText + tail).split("\n"))
    }
    const formatted = lines.join("\n")
    assert(formatted.includes("return names[id] ?? throw new NotFound({ id })"), `formatted to ${JSON.stringify(formatted.split("\n").filter((l) => l.includes("throw")))}`)
    assert(formatted.includes("return do {") && formatted.includes("    word.toUpperCase()"), `formatted to ${JSON.stringify(formatted.split("\n").filter((l) => l.includes("do {") || l.includes("toUpperCase")))}`)
    assert(formatted.includes("return withSpan(() => {") && formatted.includes("    return greeting()") && formatted.includes('}, "load")'), `formatted to ${JSON.stringify(formatted.split("\n").filter((l) => l.includes("withSpan") || l.includes("return greeting") || l.includes('"load"')))}`)
  })

  await check("completion: an Effect data type lists its module's functions as methods", async () => {
    const labels = await completionLabels("src/main.vibe", "map((n) =>", { offset: 0 })
    for (const label of ["map", "getOrElse", "flatMap", "pipe"]) assert(labels.includes(label), `no ${label} in ${JSON.stringify(labels.slice(0, 30))}`)
  })

  await check("completion: .vibe declarations in scope", async () => {
    const labels = await completionLabels("src/main.vibe", "name.toUpperCase", { offset: 0 })
    for (const label of ["lookup", "name", "NotFound", "findName"]) assert(labels.includes(label), `no ${label} in completions`)
  })

  await check("completion: a match arm offers no name the compiler writes, such as the const that holds its subject", async () => {
    for (const [needle, names] of [["tracking;", ["tracking", "delivery"]], ["tracking}`;", ["tracking", "deliveries"]]]) {
      const labels = await completionLabels("src/data.vibe", needle, { offset: 0 })
      assert(names.every((name) => labels.includes(name)), `${needle}: no ${names.join(" or ")} in ${JSON.stringify(labels.slice(0, 30))}`)
      const written = labels.filter((label) => label.startsWith("$"))
      assert(written.length === 0, `${needle}: compiler names in completions: ${JSON.stringify(written)}`)
    }
  })

  open("src/services.vibe", "vibe")
  open("src/report.ts", "typescript")

  await check("diagnostics: services.vibe, with the prelude and a service, checks clean", async () => {
    const items = await diagnostics("src/services.vibe")
    assert(items.length === 0, `expected none, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("diagnostics: declarations.vibe, with an error declaration and a ! contract, checks clean", async () => {
    const items = await diagnostics("src/declarations.vibe")
    assert(items.length === 0, `expected none, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("hover: a function with a ! contract shows it in the ! form", async () => {
    const shown = await hover("src/declarations.vibe", "findUser(id: string)")
    assert(shown.includes("function findUser(id: string): string!MissingUser!"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: an error declaration's name is a class", async () => {
    const shown = await hover("src/declarations.vibe", "MissingUser {")
    assert(shown.includes("class MissingUser"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a field inside an error declaration", async () => {
    const shown = await hover("src/declarations.vibe", "id: string }")
    assert(shown.includes("id: string"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a service member call shows its contract in the ! form", async () => {
    const shown = await hover("src/declarations.vibe", "balance(id)")
    assert(shown.includes("balance(id: string): number!MissingUser!"), `got ${JSON.stringify(shown)}`)
  })

  await check("definition: a service member call goes to the member in the service declaration", async () => {
    const [location] = await definition("src/declarations.vibe", "balance(id)")
    assert(location?.uri === fileUri("src/declarations.vibe"), `went to ${location?.uri}`)
    assert(location.range.start.line === lineOf("src/declarations.vibe", "balance(id: string)"), `line ${location.range.start.line}`)
  })

  await check("hover: a layer method's parameter has the service member's parameter type", async () => {
    const shown = await hover("src/declarations.vibe", "id.length")
    assert(shown.includes("id: string"), `got ${JSON.stringify(shown)}`)
  })

  await check("definition: a layer's setup local, used in a member, goes to the setup statement", async () => {
    const [location] = await definition("src/declarations.vibe", "rate\n")
    assert(location?.uri === fileUri("src/declarations.vibe"), `went to ${location?.uri}`)
    assert(location.range.start.line === lineOf("src/declarations.vibe", "const rate = 2"), `line ${location.range.start.line}`)
  })

  await check("hover: a provide block removes the services its layer provides", async () => {
    const shown = await hover("src/declarations.vibe", "balanceWith(id: string)")
    assert(shown.includes("function balanceWith(id: string): number!MissingUser!"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a provider's key names the service the provide block receives", async () => {
    const shown = await hover("src/provide-services.vibe", "Random = seeded")
    assert(shown.includes("Provides the service `Random.Random`"), `got ${JSON.stringify(shown)}`)
  })

  await check("diagnostics: provide-services.vibe, with a module key, checks clean", async () => {
    open("src/provide-services.vibe", "vibe")
    const items = await diagnostics("src/provide-services.vibe")
    assert(items.length === 0, `expected no diagnostics, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("hover: a match arm in a catch clause narrows the caught failure", async () => {
    const shown = await hover("src/declarations.vibe", "e.id")
    assert(shown.includes("e: MissingUser"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a catch expression removes the failures its fallback replaces", async () => {
    const shown = await hover("src/catch-expression.vibe", "userOrGuest(id: string)")
    assert(shown.includes("function userOrGuest(id: string): string!!"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: the catch keyword names the Effect function and the value", async () => {
    const fallback = await hover("src/catch-expression.vibe", "catch \"guest\"")
    assert(fallback.includes("Effect.orElseSucceed") && fallback.includes("Returns `string`") && /`(Late \| Missing|Missing \| Late)`/.test(fallback), `got ${JSON.stringify(fallback)}`)
    const handler = await hover("src/catch-expression.vibe", "catch (failure)")
    assert(handler.includes("Effect.catch") && !handler.includes("propagate"), `got ${JSON.stringify(handler)}`)
  })

  await check("hover: a catch expression's handler parameter has the caught failure's type, narrowed in each arm", async () => {
    const parameter = await hover("src/catch-expression.vibe", "failure) =>")
    assert(/failure: (Late \| Missing|Missing \| Late)/.test(parameter), `got ${JSON.stringify(parameter)}`)
    const narrowed = await hover("src/catch-expression.vibe", "failure.id")
    assert(narrowed.includes("failure: Missing"), `got ${JSON.stringify(narrowed)}`)
  })

  await check("definition: a thrown error goes to its error declaration", async () => {
    const [location] = await definition("src/declarations.vibe", "MissingUser({ id })")
    assert(location?.uri === fileUri("src/declarations.vibe"), `went to ${location?.uri}`)
    assert(location.range.start.line === lineOf("src/declarations.vibe", "export error MissingUser"), `line ${location.range.start.line}`)
  })

  await check("hover: a handle statement removes the control it handles", async () => {
    const shown = await hover("src/declarations.vibe", "approved(version: string)")
    assert(/function approved\(version: string\): [^!\n]+!!/.test(shown), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a handle clause's parameter has the operation's parameter type", async () => {
    const shown = await hover("src/declarations.vibe", "request.startsWith")
    assert(shown.includes("request: string"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a handle clause's operation shows its contract in the ! form", async () => {
    const shown = await hover("src/declarations.vibe", "approve(request) {")
    assert(shown.includes("approve(request: string): boolean!!"), `got ${JSON.stringify(shown)}`)
  })

  await check("definition: a handle clause's operation goes to the member in the control declaration", async () => {
    const [location] = await definition("src/declarations.vibe", "approve(request) {")
    assert(location?.uri === fileUri("src/declarations.vibe"), `went to ${location?.uri}`)
    assert(location.range.start.line === lineOf("src/declarations.vibe", "approve(request: string)"), `line ${location.range.start.line}`)
  })

  await check("hover: a schema field shows its decoded type", async () => {
    const shown = await hover("src/declarations.vibe", "tier\n")
    assert(shown.includes('tier: "free" | "pro"'), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a schema declaration's name is its decoded type", async () => {
    const shown = await hover("src/declarations.vibe", "Profile) {")
    // VIP-15 declares `type User = typeof User.Type` for the decoded type.
    assert(shown.includes("type Profile = {"), `got ${JSON.stringify(shown)}`)
    for (const member of ["name: string", 'tier: "free" | "pro"', "home:"]) {
      assert(shown.includes(member), `decoded type lacks ${member}: ${JSON.stringify(shown)}`)
    }
  })

  await check("definition: a schema field that names another schema goes to its declaration", async () => {
    const [location] = await definition("src/declarations.vibe", "Place\n")
    assert(location?.uri === fileUri("src/declarations.vibe"), `went to ${location?.uri}`)
    assert(location.range.start.line === lineOf("src/declarations.vibe", "export schema Place"), `line ${location.range.start.line}`)
  })

  await check("diagnostics: report.ts, which imports a .vibe function, checks clean", async () => {
    const items = await diagnostics("src/report.ts")
    assert(items.length === 0, `expected none, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  // An entry is in scope when it is not an auto-import, which names its module.
  const inScope = async (relative, needle, options) => {
    const result = await connection.request("textDocument/completion", position(relative, needle, options))
    const items = Array.isArray(result) ? result : result.items
    return (label) => items.some((item) => item.label === label && item.labelDetails?.description === undefined)
  }

  await check("completion: prelude names are in scope in a .vibe file", async () => {
    const has = await inScope("src/services.vibe", "users.find", { offset: 0 })
    for (const label of ["Effect", "Layer", "Schema", "Scope", "TaggedError", "pipe", "wire", "fork", "Users", "double"]) {
      assert(has(label), `no ${label} in scope`)
    }
  })

  await check("completion: resolving a prelude entry gives its declaration", async () => {
    const result = await connection.request("textDocument/completion", position("src/services.vibe", "users.find", { offset: 0 }))
    const item = (Array.isArray(result) ? result : result.items).find((i) => i.label === "wire" && i.labelDetails?.description === undefined)
    assert(item, "no wire entry")
    const resolved = await connection.request("completionItem/resolve", item)
    assert(/wire/.test(resolved.detail ?? ""), `detail ${JSON.stringify(resolved.detail)}`)
  })

  await check("completion: prelude names are in scope in a .vibe file that uses none yet", async () => {
    const has = await inScope("src/main.vibe", "name.toUpperCase", { offset: 0 })
    for (const label of ["Effect", "Layer", "TaggedError", "pipe", "wire"]) assert(has(label), `no ${label} in scope`)
  })

  await check("completion: prelude names are not in scope in a .ts file", async () => {
    const has = await inScope("src/users.ts", "names[id]", { offset: 0 })
    assert(has("names"), "no names in scope")
    for (const label of ["TaggedError", "wire", "fork", "Layer"]) assert(!has(label), `${label} in scope`)
  })

  await check("completion: a service's members after users. in a .vibe function", async () => {
    const labels = await completionLabels("src/services.vibe", "users.find", { offset: 6 })
    assert(labels.includes("find"), `labels ${JSON.stringify(labels.slice(0, 20))}`)
    for (const label of ["pipe", "of", "key"]) assert(!labels.includes(label), `the key's own member ${label} in completions`)
  })

  await check("completion: service members hide the synthetic typing brand", async () => {
    const labels = await completionLabels("src/services.vibe", "greeter.greet", { offset: 8 })
    assert(labels.includes("greet"), `labels ${JSON.stringify(labels)}`)
    assert(!labels.some(label => label.includes("~vibelang")), `synthetic member in ${JSON.stringify(labels)}`)
  })

  await check("hover: a plain .vibe function shows the signature VibeLang calls", async () => {
    const shown = await hover("src/services.vibe", "double(n")
    assert(shown.includes("function double(n: number): number"), `got ${JSON.stringify(shown)}`)
    assert(/TypeScript callers see `(Effect\.)?Effect<number, never, never>`/.test(shown), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a call to a plain .vibe function shows its plain signature and does not run", async () => {
    const shown = await hover("src/services.vibe", "double(id)")
    assert(shown.includes("function double(n: number): number") && !shown.includes("Runs here"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a .ts file sees a plain .vibe function as an Effect", async () => {
    const shown = await hover("src/report.ts", "double(2)")
    assert(/Effect<number, never, never>/.test(shown) && !shown.includes("Plain JavaScript"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a service member call runs and shows its success value", async () => {
    const shown = await hover("src/services.vibe", "find(id)")
    assert(/Runs here and returns `string`/.test(shown), `got ${JSON.stringify(shown)}`)
  })

  await check("diagnostics: forms.vibe, with every form whose word has no node of its own, checks clean", async () => {
    open("src/forms.vibe", "vibe")
    const items = await diagnostics("src/forms.vibe")
    assert(items.length === 0, `expected no diagnostics, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("hover: every position of forms.vibe answers without a server error", async () => {
    const uri = fileUri("src/forms.vibe")
    const failures = []
    const lines = text("src/forms.vibe").split("\n")
    for (let line = 0; line < lines.length; line++) {
      for (let character = 0; character <= lines[line].length; character++) {
        try {
          await connection.request("textDocument/hover", { textDocument: { uri }, position: { line, character } })
        } catch (error) {
          failures.push(`${line + 1}:${character + 1} ${error.message.slice(0, 160)}`)
        }
      }
    }
    assert(failures.length === 0, `${failures.length} hovers failed, first: ${failures.slice(0, 3).join("; ")}`)
  })

  await check("hover: a form's word shows what the form declares or does", async () => {
    const shows = async (needle, offset, expected) => {
      for (const shift of [offset, offset + 1]) {
        const shown = await hover("src/forms.vibe", needle, { offset: shift })
        assert(expected.test(shown), `hover on ${JSON.stringify(needle)} at ${shift}: ${shown}`)
      }
    }
    await shows("error Gone", 0, /class Gone/)
    await shows("service Seats", 0, /class Seats/)
    await shows("control Gate", 0, /class Gate/)
    await shows("join [first", 0, /Joins the fiber/)
    await shows("concurrent(2)", 0, /Runs the body for each item in its own fiber/)
    await shows("const id of ids", 6, /\(parameter\) id: string/)
    await shows("of ids)", 3, /\(parameter\) ids: readonly string\[\]/)
  })

  await check("watching: the server registers a watcher that covers new .vibe files", () => {
    const watchers = connection.registrations
      .filter((r) => r.method === "workspace/didChangeWatchedFiles")
      .flatMap((r) => r.registerOptions.watchers)
    assert(watchers.some((w) => globMatches(watcherGlob(w), extraFile)), `globs ${JSON.stringify(watchers.map(watcherGlob))}`)
  })

  await check("watching: a new .vibe file on disk joins the project", async () => {
    writeFileSync(extraFile, "export function extraHelper(n: number) {\n  return n + 1\n}\n")
    connection.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: pathToFileURL(extraFile).href, type: 1 }] })
    const deadline = Date.now() + 20_000
    for (;;) {
      const symbols = (await connection.request("workspace/symbol", { query: "extraHelper" })) ?? []
      if (symbols.some((s) => s.location?.uri === pathToFileURL(extraFile).href)) break
      assert(Date.now() < deadline, `workspace/symbol never found extraHelper: ${JSON.stringify(symbols)}`)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  })
} catch (error) {
  failures++
  console.log(`FAIL ${error.message}`)
} finally {
  rmSync(extraFile, { force: true })
  await check("shutdown: the server exits with status 0 after shutdown and exit", async () => {
    const { code, signal } = await connection.close()
    assert(code === 0, `exit status ${code}, signal ${signal}`)
  })
}

// A client that accepts pushed diagnostics and cannot pull them, as Claude
// Code's does, gets each open document's diagnostics published.
await check("diagnostics: a client that cannot pull gets broken.vibe's TS2322 pushed", async () => {
  const push = new Connection(server, ["--lsp", "--stdio"], fixture)
  const published = []
  const dispatch = push.dispatch.bind(push)
  push.dispatch = (message) => {
    if (message.method === "textDocument/publishDiagnostics") published.push(message.params)
    dispatch(message)
  }
  try {
    const rootUri = pathToFileURL(fixture).href
    await push.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "lsp-fixture" }],
      capabilities: { textDocument: { synchronization: { didSave: true }, publishDiagnostics: { relatedInformation: true } }, workspace: { configuration: true } }
    })
    push.notify("initialized", {})
    const uri = fileUri("src/broken.vibe")
    push.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text: text("src/broken.vibe") } })
    const deadline = Date.now() + 30_000
    for (;;) {
      const report = published.find((params) => params.uri === uri)
      if (report) {
        assert(report.diagnostics.length === 1 && report.diagnostics[0].code === 2322, `got ${JSON.stringify(report.diagnostics.map((d) => d.code))}`)
        break
      }
      assert(Date.now() < deadline, `nothing published for broken.vibe; published ${JSON.stringify(published.map((params) => params.uri))}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } finally {
    await push.close()
  }
})

if (failures > 0) {
  console.log(`\n${failures} check(s) failed. Last server log lines:`)
  for (const line of connection.log) console.log(`  ${line}`)
  process.exit(1)
}
