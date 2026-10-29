// Editor lifecycle contracts with a simulated VS Code API. The packaged
// extension's real-editor tests remain in run.mjs and harness/index.js.
import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

let settings: Record<string, unknown>
let registered: Map<string, () => unknown>
let status: any
let logs: string[]
let clients: FakeClient[]
let builtin: boolean
let errorChoice: string | undefined
let infoChoice: string | undefined
let failStart: boolean
let failStop: boolean
let onConfiguration: (event: any) => void
let onFolders: () => void
let executed: unknown[][]
let updates: unknown[][]
let scratch: string
let oldPath: string | undefined
class FakeClient {
  handler: (event: any) => void = () => {}
  initializeResult = { serverInfo: { version: "7.1-test" } }
  stopped = false
  constructor(readonly id: string, readonly name: string, readonly server: any, readonly options: any) { clients.push(this) }
  onDidChangeState(handler: any) { this.handler = handler }
  async start() { if (failStart) throw new Error("compiler failed"); this.handler({ newState: 2 }) }
  async stop() { this.stopped = true; if (failStop) throw new Error("stop failed") }
}
const workspace: any = {
  workspaceFolders: [], textDocuments: [],
  getConfiguration(section: string) {
    return {
      get(key: string, fallback: unknown) { return settings[`${section}.${key}`] ?? fallback },
      async update(...args: unknown[]) { updates.push([section, ...args]) }
    }
  },
  onDidChangeConfiguration(handler: any) { onConfiguration = handler; return { dispose() {} } },
  onDidChangeWorkspaceFolders(handler: any) { onFolders = handler; return { dispose() {} } }
}
const window: any = {
  activeTextEditor: undefined,
  createOutputChannel: () => ({ info: (s: string) => logs.push(s), warn: (s: string) => logs.push(s), error: (s: string) => logs.push(s), show: () => executed.push(["show"]), dispose() {} }),
  async showErrorMessage(...args: unknown[]) { executed.push(["error", ...args]); return errorChoice },
  async showInformationMessage(...args: unknown[]) { executed.push(["info", ...args]); return infoChoice }
}
const env = { appName: "Visual Studio Code" }
mock.module("vscode", () => ({ workspace, window, env,
  commands: {
    registerCommand(id: string, fn: () => unknown) { registered.set(id, fn); return { dispose() {} } },
    async executeCommand(...args: unknown[]) { executed.push(args) }
  },
  languages: { createLanguageStatusItem: () => (status = { dispose() {} }) },
  LanguageStatusSeverity: { Error: 2, Warning: 1, Information: 0 }, ConfigurationTarget: { Workspace: 2 },
  extensions: { getExtension: () => builtin ? {} : undefined }
}))
mock.module("vscode-languageclient/node", () => ({ LanguageClient: FakeClient, State: { Running: 2, Stopped: 1 }, TransportKind: { stdio: 0 } }))
const { activate, deactivate } = await import("../src/extension")

function reset() {
  scratch = mkdtempSync(join(tmpdir(), "vibelang-editor-unit-"))
  oldPath = process.env.PATH
  settings = { "vibelang.server.path": "/configured/vibelang" }
  registered = new Map(); clients = []; logs = []; executed = []; updates = []
  builtin = true; failStart = false; failStop = false; errorChoice = undefined; infoChoice = undefined
  workspace.workspaceFolders = [{ uri: { fsPath: scratch } }]; workspace.textDocuments = []
  window.activeTextEditor = undefined; env.appName = "Visual Studio Code"
}
async function cleanup() {
  await deactivate()
  if (oldPath === undefined) delete process.env.PATH
  else process.env.PATH = oldPath
  rmSync(scratch, { recursive: true, force: true })
}
beforeEach(reset)
afterEach(cleanup)
const start = () => activate({ subscriptions: [] } as any)
const command = (id: string) => registered.get(`vibelang.${id}`)!()
function executable(file: string) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, "fixture", { mode: 0o755 }); return file }

test("starts the configured server with stdio and owns only VibeLang by default", async () => {
  await start()
  expect(clients).toHaveLength(1)
  expect(clients[0].server).toEqual({ command: "/configured/vibelang", args: ["--lsp"], transport: 0, options: { cwd: scratch } })
  expect(clients[0].options.documentSelector).toEqual([{ scheme: "file", language: "vibe" }, { scheme: "untitled", language: "vibe" }])
  expect(status.text).toBe("vibelang")
  expect(status.detail).toContain("TypeScript 7.1-test")
  await deactivate()
  expect(clients[0].stopped).toBe(true)
})

for (const [mode, hasBuiltin, appName, useTsgo, serveTS] of [
  ["on", true, "Visual Studio Code", false, true],
  ["off", false, "Cursor", true, false],
  ["auto", false, "Visual Studio Code", false, true],
  ["auto", true, "Cursor", true, true],
  ["auto", true, "Visual Studio Code", true, false],
  ["auto", true, "Cursor", false, false]
] as const) {
  test(`TypeScript ownership: ${mode}, builtin ${hasBuiltin}, ${appName}, tsgo ${useTsgo}`, async () => {
    settings["vibelang.server.typeScriptFiles"] = mode
    settings["typescript.experimental.useTsgo"] = useTsgo
    builtin = hasBuiltin; env.appName = appName
    await start()
    const languages = [...new Set(clients[0].options.documentSelector.map((d: any) => d.language))]
    expect(languages).toEqual(serveTS ? ["vibe", "typescript", "typescriptreact", "javascript", "javascriptreact"] : ["vibe"])
  })
}

test("resolves a configured relative path against the first workspace folder", async () => {
  settings["vibelang.server.path"] = "  tools/compiler  "
  await start()
  expect(clients[0].server.command).toBe(join(scratch, "tools/compiler"))
})

test("expands a configured home path and works without an open folder", async () => {
  const { homedir } = await import("node:os")
  settings["vibelang.server.path"] = "~/tools/vibelang"
  workspace.workspaceFolders = undefined
  await start()
  expect(clients[0].server.command).toBe(join(homedir(), "tools/vibelang"))
  expect(clients[0].server.options.cwd).toBeUndefined()
})

test("the active source uses its nearest compiler before other documents or workspace folders", async () => {
  settings["vibelang.server.path"] = ""
  executable(join(scratch, "node_modules/.bin/vibelang"))
  const nested = executable(join(scratch, "nested/node_modules/.bin/vibelang"))
  window.activeTextEditor = { document: { languageId: "vibe", uri: { scheme: "file", fsPath: join(scratch, "nested/src/main.vibe") } } }
  await start()
  expect(clients[0].server.command).toBe(nested)
})

test("open VibeLang documents find their compiler even without workspace folders", async () => {
  settings["vibelang.server.path"] = ""
  workspace.workspaceFolders = []
  const local = executable(join(scratch, "node_modules/.bin/vibelang"))
  workspace.textDocuments = [{ languageId: "vibe", uri: { scheme: "file", fsPath: join(scratch, "src/main.vibe") } }]
  await start()
  expect(clients[0].server.command).toBe(local)
})

test("PATH fallback ignores empty entries, nonexecutable files and directories", async () => {
  settings["vibelang.server.path"] = ""
  workspace.workspaceFolders = []
  window.activeTextEditor = { document: { languageId: "typescript", uri: { scheme: "file", fsPath: join(scratch, "ignored.ts") } } }
  workspace.textDocuments = [{ languageId: "vibe", uri: { scheme: "untitled", fsPath: "untitled:Untitled-1" } }]
  mkdirSync(join(scratch, "directory/vibelang"), { recursive: true })
  executable(join(scratch, "no-permission/vibelang"))
  const { chmodSync } = await import("node:fs")
  chmodSync(join(scratch, "no-permission/vibelang"), 0o644)
  const compiler = executable(join(scratch, "bin/vibelang"))
  process.env.PATH = `:${join(scratch, "directory")}:${join(scratch, "no-permission")}:${join(scratch, "bin")}`
  await start()
  expect(clients[0].server.command).toBe(compiler)
})

for (const choice of [undefined, "Open Settings", "Show Output"]) {
  test(`missing compiler reports recovery actions: ${choice ?? "dismiss"}`, async () => {
    settings["vibelang.server.path"] = ""
    workspace.workspaceFolders = []; process.env.PATH = ""
    errorChoice = choice
    await start()
    expect(clients).toHaveLength(0)
    expect(status.text).toBe("vibelang not found")
    expect(status.severity).toBe(2)
    expect(logs.join("\n")).toContain("Cannot find vibelang")
    if (choice === "Open Settings") expect(executed).toContainEqual(["workbench.action.openSettings", "vibelang.server.path"])
    if (choice === "Show Output") expect(executed).toContainEqual(["show"])
  })
}

test("configuration middleware preserves settings except diagnostic validation switches", async () => {
  await start()
  const configure = clients[0].options.middleware.workspace.configuration
  const value = { validate: { enable: false }, format: { enable: true } }
  const sections = ["typescript", "javascript", "js/ts", "other", undefined, "typescript", "javascript"]
  const values = [value, value, value, value, value, null, false]
  const result = await configure({ items: sections.map((section) => ({ section })) }, {}, async () => values)
  expect(result).toEqual([{ format: { enable: true } }, { format: { enable: true } }, { format: { enable: true } }, value, value, null, false])
  expect(value.validate.enable).toBe(false)
  expect(await configure({ items: [] }, {}, async () => null)).toBeNull()
})

test("start failure remains recoverable through restart and stale client events are ignored", async () => {
  failStart = true
  await start()
  expect(status.text).toBe("vibelang failed")
  expect(logs.join("\n")).toContain("compiler failed")
  const previous = clients[0]
  failStart = false
  await command("restartServer")
  expect(previous.stopped).toBe(true)
  previous.handler({ newState: 1 })
  expect(status.text).toBe("vibelang")
  clients[1].handler({ newState: 1 })
  expect(status.text).toBe("vibelang stopped")
  expect(status.severity).toBe(1)
})

test("restart continues after stop failure and exposes output", async () => {
  await start()
  failStop = true
  await command("restartServer")
  expect(clients).toHaveLength(2)
  expect(logs.join("\n")).toContain("Stopping the language server failed")
  await command("showOutput")
  expect(executed).toContainEqual(["show"])
})

test("server settings, Cursor ownership changes and workspace folder changes restart the client", async () => {
  await start()
  onConfiguration({ affectsConfiguration: (section: string) => section === "unrelated" })
  await Bun.sleep(0)
  expect(clients).toHaveLength(1)
  for (const section of ["vibelang.server", "typescript.experimental.useTsgo"]) {
    const previous = clients.at(-1)!
    onConfiguration({ affectsConfiguration: (candidate: string) => candidate === section })
    await Bun.sleep(0)
    expect(previous.stopped).toBe(true)
  }
  onFolders()
  await Bun.sleep(0)
  expect(clients).toHaveLength(4)
})

test("Cursor's serve TypeScript command updates workspace settings and restarts the host", async () => {
  env.appName = "Cursor"
  await start()
  await command("serveTypeScriptFiles")
  expect(updates).toEqual([["typescript", "experimental.useTsgo", true, 2]])
  expect(executed).toContainEqual(["workbench.action.restartExtensionHost"])
})

test("the serve TypeScript command acknowledges an already disabled built-in extension", async () => {
  builtin = false
  await start()
  await command("serveTypeScriptFiles")
  expect(executed.some((e) => String(e[1]).includes("already serves"))).toBe(true)
  expect(updates).toHaveLength(0)
})

for (const choice of [undefined, "Show Extension"]) {
  test(`VS Code's serve TypeScript command offers built-in extension settings: ${choice ?? "dismiss"}`, async () => {
    infoChoice = choice
    await start()
    await command("serveTypeScriptFiles")
    expect(updates).toHaveLength(0)
    if (choice) expect(executed).toContainEqual(["workbench.extensions.search", "@builtin TypeScript and JavaScript Language Features"])
    else expect(executed.filter((e) => e[0] === "workbench.extensions.search")).toHaveLength(0)
  })
}

test("an unconfigured workspace without any ancestor compiler reports a missing server", async () => {
  settings["vibelang.server.path"] = ""
  process.env.PATH = ""
  await start()
  expect(clients).toHaveLength(0)
  expect(status.text).toBe("vibelang not found")
})

const tooling = "docs/design/history/src/428-part4-ch28-tooling.md: The editor (D79/D76)"
const guide = "docs/user/src/setup/vscode.md: 3; Server settings and troubleshooting"
const regressions = new URL("./property-regressions/", import.meta.url)
const property = (name: string, arbitrary: any, check: (input: any) => Promise<void>) => checkProperty(fc, {
  name, rule: name === "editor-configuration" ? "metamorphic: preserve unrelated configuration fields and caller-owned values" : `${tooling}; ${guide}`,
  arbitrary, regressions, command: "bun run test", numRuns: 50,
  diagnostics: () => logs.join("\n"),
  check: async (input: any) => { await cleanup(); reset(); try { await check(input) } finally { await deactivate() } }
})
const fileKind = fc.constantFrom("missing", "executable", "directory", "nonexecutable")
function candidate(file: string, kind: string) {
  if (kind === "directory") mkdirSync(file, { recursive: true })
  if (kind === "executable" || kind === "nonexecutable") {
    executable(file)
    if (kind === "nonexecutable") chmodSync(file, 0o644)
  }
}

// D79 and the user settings table: override > nearest executable local > PATH.
// Other document kinds cannot change selection (metamorphic irrelevant-document law).
test("property: compiler discovery from random trees and document sets", () => property("editor-discovery", fc.record({
  directories: fc.array(fc.constantFrom("src", "space dir", "雪"), { maxLength: 3 }),
  local: fc.array(fileKind, { minLength: 4, maxLength: 4 }),
  path: fc.array(fileKind, { maxLength: 3 }),
  override: fc.constantFrom("none", "relative", "absolute"),
  documents: fc.array(fc.constantFrom("vibe", "typescript", "untitled"), { maxLength: 4 }), active: fc.boolean()
}), async (input) => {
  const roots = [scratch]
  for (const dir of input.directories) roots.push(join(roots.at(-1)!, dir))
  roots.forEach((dir, i) => candidate(join(dir, "node_modules/.bin/vibelang"), input.local[i]))
  const bins = input.path.map((kind: string, i: number) => {
    const bin = join(scratch, `path${i}`); candidate(join(bin, "vibelang"), kind); return bin
  })
  process.env.PATH = ["", ...bins, ""].join(delimiter)
  const documents = input.documents.map((kind: string) => ({ languageId: kind === "untitled" ? "vibe" : kind,
    uri: { scheme: kind === "untitled" ? "untitled" : "file", fsPath: join(roots.at(-1)!, "main.vibe") } }))
  workspace.textDocuments = documents
  if (input.active && documents.length) window.activeTextEditor = { document: documents[0] }
  settings["vibelang.server.path"] = ({ none: "", relative: "tools/compiler", absolute: "/override/vibelang" } as any)[input.override]
  const nearest = documents.some((d: any) => d.languageId === "vibe" && d.uri.scheme === "file") ? roots.length - 1 : 0
  const localIndex = input.local.slice(0, nearest + 1).lastIndexOf("executable")
  const pathIndex = input.path.indexOf("executable")
  const expected = input.override === "relative" ? join(scratch, "tools/compiler")
    : input.override === "absolute" ? "/override/vibelang"
    : localIndex >= 0 ? join(roots[localIndex], "node_modules/.bin/vibelang")
    : pathIndex >= 0 ? join(bins[pathIndex], "vibelang") : undefined
  await start()
  expect(clients.at(-1)?.server.command).toBe(expected)
  if (!expected) expect(status.text).toBe("vibelang not found")
}))

const ownership = fc.record({ mode: fc.constantFrom("auto", "on", "off"), builtin: fc.boolean(), cursor: fc.boolean(), tsgo: fc.boolean() })
// D76 and user docs: ownership follows settings after each settled restart;
// showOutput and the TypeScript handoff command retain their documented effects.
test("property: configuration and command histories", () => property("editor-histories", fc.record({ initial: ownership,
  events: fc.array(fc.record({ action: fc.constantFrom("settings", "folders", "restart", "output", "handoff"), state: ownership }), { maxLength: 6 })
}), async ({ initial, events }) => {
  let state = initial
  const configure = () => {
    settings["vibelang.server.path"] = "tools/compiler"
    settings["vibelang.server.typeScriptFiles"] = state.mode
    settings["typescript.experimental.useTsgo"] = state.tsgo
    builtin = state.builtin; env.appName = state.cursor ? "Cursor" : "Visual Studio Code"
  }
  configure(); await start()
  for (const event of [{ action: "initial" }, ...events]) {
    const previous = clients.at(-1)!
    if (event.action === "settings" || event.action === "folders" || event.action === "restart") {
      if (event.action === "settings") { state = event.state; configure(); onConfiguration({ affectsConfiguration: (s: string) => s === "vibelang.server" }) }
      if (event.action === "folders") { workspace.workspaceFolders = [{ uri: { fsPath: join(scratch, `folder${clients.length}`) } }]; onFolders() }
      if (event.action === "restart") await command("restartServer")
      // The mocked lifecycle has no I/O: drain the restart promise's microtasks.
      for (let i = 0; i < 20 && clients.at(-1) === previous; i++) await Promise.resolve()
      expect(previous.stopped).toBe(true)
      expect(clients.at(-1)).not.toBe(previous)
    }
    if (event.action === "output") { await command("showOutput"); expect(executed.at(-1)).toEqual(["show"]) }
    if (event.action === "handoff") {
      updates = []; executed = []; infoChoice = "Show Extension"
      await command("serveTypeScriptFiles")
      const off = !state.builtin || state.cursor && state.tsgo
      if (off) expect(updates).toEqual([])
      else if (state.cursor) {
        expect(updates).toEqual([["typescript", "experimental.useTsgo", true, 2]])
      } else expect(executed).toContainEqual(["workbench.extensions.search", "@builtin TypeScript and JavaScript Language Features"])
    }
    const current = clients.at(-1)!
    const serveTS = state.mode === "on" || state.mode === "auto" && (!state.builtin || state.cursor && state.tsgo)
    const languages = serveTS ? ["vibe", "typescript", "typescriptreact", "javascript", "javascriptreact"] : ["vibe"]
    expect(new Set(current.options.documentSelector.map((d: any) => `${d.scheme}:${d.language}`)))
      .toEqual(new Set(languages.flatMap(language => ["file", "untitled"].map(scheme => `${scheme}:${language}`))))
    expect(current.server.command).toBe(join(workspace.workspaceFolders[0].uri.fsPath, "tools/compiler"))
    expect(clients.filter(client => !client.stopped)).toEqual([current])
    const detail = { text: status.text, detail: status.detail }
    previous.handler({ newState: 2 })
    expect({ text: status.text, detail: status.detail }).toEqual(detail)
  }
}))

// Metamorphic: irrelevant configuration and its nested values are unchanged;
// this does not prescribe how the server treats validation switches.
test("property: configuration middleware preserves unrelated settings", () => property("editor-configuration", fc.array(fc.record({
  section: fc.constantFrom("typescript", "javascript", "js/ts", "unrelated", undefined), enable: fc.boolean(),
  extras: fc.dictionary(fc.constantFrom("format", "suggest", "preferences", "inlayHints"), fc.jsonValue())
}), { maxLength: 8 }), async (items) => {
  await start()
  const values = items.map((item: any) => ({ ...item.extras, validate: { enable: item.enable } }))
  const before = structuredClone(values)
  const result = await clients[0].options.middleware.workspace.configuration({ items }, {}, async () => values)
  expect(values).toEqual(before)
  items.forEach(({ section, extras }: any, i: number) => {
    for (const [key, value] of Object.entries(extras)) expect(result[i][key]).toEqual(value)
    if (!["typescript", "javascript", "js/ts"].includes(section)) expect(result[i]).toEqual(values[i])
  })
}))
