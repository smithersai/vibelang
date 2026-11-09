#!/usr/bin/env node
import { hasWithSpanEffectBlock } from "./lsp-format-shape.mjs"
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
import { Connection } from "./lsp-connection.mjs"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, "lsp-fixture")
const server = path.resolve(process.argv[2] ?? path.join(here, "..", "built", "local", "vibelang"))
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

  await check("code action: TypeScript's interface implementation fix remains available", async () => {
    const file = "src/ts-codefix.ts"
    open(file, "typescript")
    const items = await diagnostics(file)
    const item = items.find(d => d.code === 2420)
    assert(item, "missing TS2420 control: " + JSON.stringify(items))
    const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri(file) }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
    assert(actions.some(a => a.edit), "TypeScript's implementation fix is missing: " + JSON.stringify(actions))
  })

  await check("diagnostics retained without VibeLang automatic fixes: src/old-await.vibe", async () => {
    open("src/old-await.vibe", "vibe")
    const items = await diagnostics("src/old-await.vibe")
    const placement = items.filter((d) => d.code === 102)
    assert(placement.length === 2 && placement.every((d) => d.source === "EK" && d.severity === 1),
      "placement diagnostics " + JSON.stringify(items))
    const uri = fileUri("src/old-await.vibe")
    for (const item of items.filter(d => d.source === "EK")) {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri("src/old-await.vibe") }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      assert(actions.length === 0, "VibeLang automatic fixes were offered: " + JSON.stringify(actions))
    }
  })

  await check("diagnostics retained without VibeLang automatic fixes: src/old-declarations.vibe", async () => {
    const file = "src/old-declarations.vibe"
    open(file, "vibe")
    const items = await diagnostics(file)
    const codes = items.map((d) => `${d.source} ${d.code} ${d.severity}`).sort()
    assert(JSON.stringify(codes) === JSON.stringify(["EK 2121 1", "EK 909 1"]), `diagnostics ${JSON.stringify(codes)}`)
    const uri = fileUri(file)
    const service = items.find((d) => d.code === 909)
    const serviceStart = at(file, "service class Greeting")
    assert(service.range.start.line === serviceStart.line && service.range.start.character === serviceStart.character, `EK0909 range ${JSON.stringify(service.range)}`)
    for (const item of items.filter(d => d.source === "EK")) {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri("src/old-declarations.vibe") }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      assert(actions.length === 0, "VibeLang automatic fixes were offered: " + JSON.stringify(actions))
    }
  })

  await check("diagnostics retained without VibeLang automatic fixes: src/ts-forms.vibe", async () => {
    const file = "src/ts-forms.vibe"
    open(file, "vibe")
    const items = await diagnostics(file)
    const codes = items.map((d) => `${d.source} ${d.code} ${d.severity}`).sort()
    assert(JSON.stringify(codes) === JSON.stringify(["EK 4830 2", "EK 4833 2"]), `diagnostics ${JSON.stringify(codes)}`)
    const uri = fileUri(file)
    for (const item of items.filter(d => d.source === "EK")) {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri("src/ts-forms.vibe") }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      assert(actions.length === 0, "VibeLang automatic fixes were offered: " + JSON.stringify(actions))
    }
  })

  await check("diagnostics retained without VibeLang automatic fixes: src/old-catch.vibe", async () => {
    open("src/old-catch.vibe", "vibe")
    const nativeTry = (await diagnostics("src/old-catch.vibe")).filter((d) => d.code === 503)
    assert(nativeTry.length === 2 && nativeTry.every((d) => d.source === "EK" && d.severity === 1), `VIP-5 native try diagnostics: ${JSON.stringify(nativeTry)}`)
    const items = (await diagnostics("src/old-catch.vibe")).filter((d) => d.code === 2112)
    assert(items.length === 2, `expected two EK2112 warnings, got ${JSON.stringify(items.map((d) => d.message))}`)
    const [item] = items
    assert(item.source === "EK" && item.severity === 2, `expected warning EK 2112, got ${item.source} severity ${item.severity}`)
    const start = at("src/old-catch.vibe", "Missing) {")
    assert(item.range.start.line === start.line && item.range.start.character === start.character, `range ${JSON.stringify(item.range)}`)
    const uri = fileUri("src/old-catch.vibe")
    for (const item of items.filter(d => d.source === "EK")) {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri("src/old-catch.vibe") }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      assert(actions.length === 0, "VibeLang automatic fixes were offered: " + JSON.stringify(actions))
    }
  })

  await check("diagnostics retained without VibeLang automatic fixes: src/old-catch.vibe", async () => {
    const items = (await diagnostics("src/old-catch.vibe")).filter((d) => d.code === 2113)
    assert(items.length === 1, `expected one EK2113 warning, got ${JSON.stringify(items.map((d) => d.message))}`)
    const [item] = items
    const uri = fileUri("src/old-catch.vibe")
    for (const item of items.filter(d => d.source === "EK")) {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri("src/old-catch.vibe") }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      assert(actions.length === 0, "VibeLang automatic fixes were offered: " + JSON.stringify(actions))
    }
  })

  await check("diagnostics: catch-expression.vibe, with a value handler and a matching handler, checks clean", async () => {
    open("src/catch-expression.vibe", "vibe")
    const items = await diagnostics("src/catch-expression.vibe")
    assert(items.length === 0, `expected no diagnostics, got ${JSON.stringify(items.map((d) => d.message))}`)
  })

  await check("diagnostics: wrapper arrows capture parameters without an input fix (VIP-6)", async () => {
    open("src/hatch-outside.vibe", "vibe")
    const items = await diagnostics("src/hatch-outside.vibe")
    assert(items.length === 0, `expected no capture diagnostic, got ${JSON.stringify(items)}`)
    const uri = fileUri("src/hatch-outside.vibe")
    const start = at("src/hatch-outside.vibe", "text.length")
    const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri }, range: { start, end: start }, context: { diagnostics: [], only: ["quickfix"] } })) ?? []
    assert(!actions.some((a) => a.title === "Pass text as an input"), "retired input fix was offered")
  })

  await check("diagnostics retained without VibeLang automatic fixes: src/lsrules.vibe", async () => {
    open("src/lsrules.vibe", "vibe")
    const items = await diagnostics("src/lsrules.vibe")
    const codes = items.map((d) => `${d.source}${d.code}:${d.severity}`).sort()
    // EK4833 is the TypeScript spelling of discard's parameter type (D287).
    assert(JSON.stringify(codes) === JSON.stringify(["EK4801:1", "EK4808:2", "EK4813:1", "EK4833:2"]), `codes ${JSON.stringify(codes)}`)
    const uri = fileUri("src/lsrules.vibe")
    const floating = items.find(d => d.code === 4801)
    const start = at("src/lsrules.vibe", "program\n  //")
    assert(floating.range.start.line === start.line && floating.range.start.character === start.character, "floating diagnostic range changed")
    for (const item of items.filter(d => d.source === "EK")) {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri("src/lsrules.vibe") }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      assert(actions.length === 0, "VibeLang automatic fixes were offered: " + JSON.stringify(actions))
    }
  })

  // D266: a .ts file keeps TypeScript's verdict, so yield without * draws no
  // EK4819 there; VibeLang's Effect API rename is no longer offered.
  await check("diagnostics retained without VibeLang automatic fixes: src/lsrules-gen.ts", async () => {
    open("src/lsrules-gen.ts", "typescript")
    const items = await diagnostics("src/lsrules-gen.ts")
    const codes = items.map((d) => `${d.source ?? "ts"}${d.code}`).sort()
    assert(JSON.stringify(codes) === JSON.stringify(["ts2339"]), `codes ${JSON.stringify(codes)}`)
    const uri = fileUri("src/lsrules-gen.ts")
    const item = items.find(d => d.code === 2339)
    const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri("src/lsrules-gen.ts") }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
    assert(!actions.some(a => a.title === "Write Effect.catch"), "removed VibeLang API rename was offered")
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
    assert(contract.includes("export effect function greet(): string!!Greeting {"), `contract: ${contract.split("\n").find((l) => l.includes("greet("))}`)
    const schema = await refactor("interface Point", "Convert to a schema declaration")
    assert(schema.includes("schema Point {\n  x: number\n  y: number\n}"), `schema not written: ${JSON.stringify(schema.slice(schema.indexOf("schema Point"), schema.indexOf("schema Point") + 60))}`)
    const plain = await refactor("async function", "Convert to a VibeLang function")
    assert(plain.includes("export effect function size(text: string) {") && plain.includes("const length = try Effect.tryPromise(() => Promise.resolve(text.length))") && plain.includes("return try Effect.tryPromise(async () => "), `async: ${plain.split("\n").filter((l) => l.includes("size") || l.includes("length =")).join(" / ")}`)
    const mapped = await refactor("async function", "Convert to a VibeLang function with an error per await")
    const errorDeclaration = "error ResolveFailed { cause: unknown }\n"
    assert(mapped.includes(errorDeclaration) && mapped.indexOf(errorDeclaration) < mapped.indexOf("service Name {") && mapped.includes("export effect function size(") && mapped.includes("try Effect.tryPromise({ try: () => Promise.resolve(text.length), catch: (cause) => new ResolveFailed({ cause }) })"), "module error declaration or Promise bridge not written")
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
    assert(codes.includes("EK4801:off") && codes.includes("EK4856:off") && codes.includes("*:off"), `codes ${JSON.stringify(codes.slice(0, 5))}`)
  })

  await check("diagnostics retained without VibeLang automatic fixes: src/lsrules-editor.vibe", async () => {
    const relative = "src/lsrules-editor.vibe"
    const items = (await diagnostics(relative)).filter((d) => d.code === 4823)
    assert(items.length === 1 && items[0].severity === 2, `EK4823 ${JSON.stringify(items)}`)
    const uri = fileUri(relative)
    for (const item of items.filter(d => d.source === "EK")) {
      const actions = (await connection.request("textDocument/codeAction", { textDocument: { uri: fileUri("src/lsrules-editor.vibe") }, range: item.range, context: { diagnostics: [item], only: ["quickfix"] } })) ?? []
      assert(actions.length === 0, "VibeLang automatic fixes were offered: " + JSON.stringify(actions))
    }
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
    const items = await diagnostics("src/spellings.vibe")
    assert(items.length === 1 && items[0].source === "EK" && items[0].code === 4856 && items[0].severity === 2,
      "expected the bare alias migration warning only: " + JSON.stringify(items))
    const start = at("src/spellings.vibe", "Effect<string, Missing>")
    assert(items[0].range.start.line === start.line && items[0].range.start.character === start.character,
      "alias diagnostic span " + JSON.stringify(items[0].range))
  })

  await check("hover: wrapper arrows may capture locals and legacy direct calls list their inputs", async () => {
    const shown = await hover("src/hatch-outside.vibe", "sync((t)")
    assert(shown.includes("capture surrounding locals (VIP-6)") && shown.includes("Inputs, which fill its first parameters: `text`."), `hover ${shown}`)
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

  // D147's by-name arguments are retired: an argument is evaluated once, as
  // JavaScript evaluates it, so greeting() gives Effect.timeout its Effect (VIP-1, VIP-2).
  await check("hover: a call passed as an argument builds its Effect once, not by name", async () => {
    const shown = await hover("src/main.vibe", "greeting(), ")
    assert(shown.includes("function greeting(): string!!") && !shown.includes("Passed by name") && !shown.includes("Runs here"), `got ${JSON.stringify(shown)}`)
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
    const bare = await hover("src/data.vibe", "Waiting()", {})
    assert(bare.includes("(variant) Delivery.Waiting"), `got ${JSON.stringify(bare)}`)
  })

  await check("definition: a data variant goes to the variant in its declaration", async () => {
    for (const [needle, target] of [["Sent({", "Sent { tracking"], ["Waiting()", "Waiting\n"]]) {
      const [location, ...rest] = await definition("src/data.vibe", needle)
      assert(location && rest.length === 0, `${needle}: expected one location, got ${JSON.stringify([location, ...rest])}`)
      const want = at("src/data.vibe", target)
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

  await check("completion: namespace exports and explicit service members after a dot or partial name", async () => {
    for (const [needle, offsets, expected, absent] of [
      ["FileSystem.FileSystem", [11, 14], ["FileSystem", "makeNoop", "layerNoop"], ["readFileString", "exists"]],
      ["fs.readFileString", [3, 6], ["readFileString", "exists"], ["FileSystem", "layerNoop"]],
      ["Experimental.Process.Process", [21, 24], ["Process", "make", "layerTest"], ["hostname", "pid"]],
      ["proc.hostname", [5, 8], ["hostname", "pid", "isRunning"], ["Process", "layerTest"]]
    ]) {
      for (const offset of offsets) {
        const labels = await completionLabels("src/services.vibe", needle, { offset })
        for (const name of expected) assert(labels.includes(name), `${needle} at ${offset}: no ${name} in ${JSON.stringify(labels)}`)
        for (const name of absent) assert(!labels.includes(name), `${needle} at ${offset}: unexpected ${name}`)
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

  // A topic is the left side's value, evaluated once (VIP-23); the by-name
  // topic of D155 is retired, so the first topic is the Effect greeting() builds.
  await check("hover: a topic holds its left side's value, an Effect, not a program passed by name", async () => {
    const shown = await hover("src/main.vibe", "%, \"1 second\")) |>")
    assert(shown.includes("(topic) %: string!!") && !shown.includes("Passed by name"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a topic used as a value shows its type and left side", async () => {
    const shown = await hover("src/main.vibe", "${%}!", { offset: 2 })
    assert(shown.includes("(topic) %: string") && shown.includes("runs once, before the pipe's body"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a topic in a do expression in the pipe's body shows its type and left side", async () => {
    const shown = await hover("src/main.vibe", "%.length}")
    assert(shown.includes("(topic) %: string") && shown.includes("The value of `word`"), `got ${JSON.stringify(shown)}`)
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
    assert(formatted.includes('try (greeting() |> Effect.timeout(%, "1 second")) |> `${%}!`'), `formatted to ${JSON.stringify(formatted.split("\n").filter((l) => l.includes("greeting()")))}`)
  })

  await check("formatting: throw, do, and an effect block keep their shape", async () => {
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
    // A program is an effect block, not an arrow (VIP-2).
    assert(hasWithSpanEffectBlock(formatted), `formatted to ${JSON.stringify(formatted.split("\n").filter((l) => l.includes("withSpan") || l.includes("return try greeting") || l.includes('"load"')))}`)
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

  await check("diagnostics: services.vibe retains its two bare-alias migration warnings without errors", async () => {
    const items = await diagnostics("src/services.vibe")
    assert(items.length === 2 && items.every((d) => d.source === "EK" && d.code === 4856 && d.severity === 2),
      "expected exactly two alias warnings: " + JSON.stringify(items))
    for (const needle of ["Effect<string, Missing, never>", "Effect<string>"]) {
      const start = at("src/services.vibe", needle)
      assert(items.some((d) => d.range.start.line === start.line && d.range.start.character === start.character),
        "missing alias warning at " + needle + ": " + JSON.stringify(items))
    }
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
    const value = await hover("src/catch-expression.vibe", "catch () => \"guest\"")
    assert(value.includes("Effect.catch") && value.includes("Returns `string`") && /`(Late \| Missing|Missing \| Late)`/.test(value), `got ${JSON.stringify(value)}`)
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

  await check("hover: providing Approval removes its service requirement", async () => {
    const shown = await hover("src/declarations.vibe", "approved(version: string)")
    assert(/function approved\(version: string\): [^!\n]+!!/.test(shown), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a provided service method parameter has its declared type", async () => {
    const shown = await hover("src/declarations.vibe", "request.startsWith")
    assert(shown.includes("request: string"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a provided service method shows its contract in the ! form", async () => {
    const shown = await hover("src/declarations.vibe", "approve(request) {")
    assert(shown.includes("approve(request: string): boolean!!"), `got ${JSON.stringify(shown)}`)
  })

  await check("definition: a provided service method goes to its service declaration", async () => {
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
    // VIP-15: a field without readonly stays writable in the decoded type.
    assert(!shown.includes("readonly name:") && !shown.includes("readonly city:"), `got ${JSON.stringify(shown)}`)
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

  // A function without effect is plain JavaScript, for VibeLang and TypeScript
  // callers alike (VIP-1); no caller sees it as an Effect.
  await check("hover: a plain .vibe function shows its plain signature", async () => {
    const shown = await hover("src/services.vibe", "double(n")
    assert(shown.includes("function double(n: number): number") && !shown.includes("Effect<number"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a call to a plain .vibe function shows its plain signature and does not run", async () => {
    const shown = await hover("src/services.vibe", "double(id)")
    assert(shown.includes("function double(n: number): number") && !shown.includes("Runs here"), `got ${JSON.stringify(shown)}`)
  })

  await check("hover: a .ts file sees a plain .vibe function as plain JavaScript", async () => {
    const shown = await hover("src/report.ts", "double(2)")
    assert(shown.includes("function double(n: number): number") && !shown.includes("Effect<number"), `got ${JSON.stringify(shown)}`)
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
    await shows("service Gate", 0, /class Gate/)
    await shows("join first", 0, /Runs Fiber.join on the fiber/)
    await shows("concurrent(2)", 0, /Runs Effect\.forEach.*enclosing fiber/)
    await shows("const id of ids", 6, /const id: string/)
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
