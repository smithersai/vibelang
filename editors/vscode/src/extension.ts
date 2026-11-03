// The VibeLang extension: starts `vibelang --lsp --stdio` as the language
// server for .vibe and .vibex files, and for .ts and .js files when the
// built-in TypeScript features are off.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  State,
  TransportKind
} from "vscode-languageclient/node"

const vibeLanguages = ["vibe", "vibex"]
const typeScriptLanguages = ["typescript", "typescriptreact", "javascript", "javascriptreact"]

let client: LanguageClient | undefined
let output: vscode.LogOutputChannel
let status: vscode.LanguageStatusItem
let restarting: Promise<void> = Promise.resolve()

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("VibeLang", { log: true })
  status = vscode.languages.createLanguageStatusItem("vibelang.server", vibeLanguages.map((language) => ({ language })))
  status.name = "VibeLang language server"
  status.command = { title: "Show Output", command: "vibelang.showOutput" }
  context.subscriptions.push(
    output,
    status,
    vscode.commands.registerCommand("vibelang.restartServer", () => restart()),
    vscode.commands.registerCommand("vibelang.showOutput", () => output.show()),
    vscode.commands.registerCommand("vibelang.serveTypeScriptFiles", serveTypeScriptFiles),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("vibelang.server") || event.affectsConfiguration("typescript.experimental.useTsgo")) {
        void restart()
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void restart())
  )
  await restart()
}

export async function deactivate(): Promise<void> {
  await stop()
}

// restart stops the running server, if any, and starts one with the current
// settings. Calls queue, so two quick setting changes start one server.
function restart(): Promise<void> {
  restarting = restarting.then(async () => {
    await stop()
    await start()
  })
  return restarting
}

async function stop(): Promise<void> {
  const running = client
  client = undefined
  if (running === undefined) return
  try {
    await running.stop()
  } catch (error) {
    output.warn(`Stopping the language server failed: ${String(error)}`)
  }
}

async function start(): Promise<void> {
  const server = findServer()
  if (server === undefined) {
    status.severity = vscode.LanguageStatusSeverity.Error
    status.text = "vibelang not found"
    status.detail = "Run bun install in the project, set vibelang.server.path, or put vibelang on PATH"
    output.error("Cannot find vibelang: vibelang.server.path is empty, no node_modules/.bin/vibelang was found, and vibelang is not on PATH.")
    const choice = await vscode.window.showErrorMessage(
      "VibeLang cannot find vibelang. Run bun install in the project (it installs vibelang), set vibelang.server.path, or put vibelang on PATH.",
      "Open Settings",
      "Show Output"
    )
    if (choice === "Open Settings") await vscode.commands.executeCommand("workbench.action.openSettings", "vibelang.server.path")
    if (choice === "Show Output") output.show()
    return
  }

  const languages = servesTypeScriptFiles() ? [...vibeLanguages, ...typeScriptLanguages] : vibeLanguages
  output.info(`Starting ${server.command} --lsp --stdio (from ${server.from}) for ${languages.join(", ")} documents`)
  const serverOptions: ServerOptions = {
    command: server.command,
    args: ["--lsp"],
    transport: TransportKind.stdio,
    options: { cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath }
  }
  const clientOptions: LanguageClientOptions = {
    documentSelector: languages.flatMap((language) => [
      { scheme: "file", language },
      { scheme: "untitled", language }
    ]),
    outputChannel: output,
    diagnosticCollectionName: "vibelang",
    diagnosticPullOptions: { onChange: true, onSave: true },
    middleware: {
      workspace: {
        // The server reads the typescript, javascript, and js/ts sections.
        // Their validate.enable switches VS Code's built-in TypeScript
        // diagnostics, and turning those off must not silence VibeLang's.
        configuration: async (params, token, next) => {
          const values = await next(params, token)
          if (!Array.isArray(values)) return values
          return values.map((value, i) => withoutValidate(params.items[i]?.section, value))
        }
      }
    }
  }
  const started = new LanguageClient("vibelang", "VibeLang", serverOptions, clientOptions)
  started.onDidChangeState(({ newState }) => {
    if (client !== started) return
    if (newState === State.Running) {
      const info = started.initializeResult?.serverInfo
      status.severity = vscode.LanguageStatusSeverity.Information
      status.text = "vibelang"
      status.detail = `${server.command}${info?.version ? ` (TypeScript ${info.version})` : ""}`
    } else if (newState === State.Stopped) {
      status.severity = vscode.LanguageStatusSeverity.Warning
      status.text = "vibelang stopped"
      status.detail = "Run VibeLang: Restart Language Server"
    }
  })
  client = started
  status.severity = vscode.LanguageStatusSeverity.Information
  status.text = "vibelang starting"
  status.detail = server.command
  try {
    await started.start()
  } catch (error) {
    status.severity = vscode.LanguageStatusSeverity.Error
    status.text = "vibelang failed"
    status.detail = String(error)
    output.error(`The language server did not start: ${String(error)}`)
  }
}

function withoutValidate(section: string | undefined, value: unknown): unknown {
  if ((section !== "typescript" && section !== "javascript" && section !== "js/ts") || value === null || typeof value !== "object") {
    return value
  }
  const { validate: _validate, ...rest } = value as Record<string, unknown>
  return rest
}

interface Server {
  command: string
  from: string
}

// findServer returns the vibelang to run: the vibelang.server.path setting,
// else node_modules/.bin/vibelang nearest to the active .vibe or .vibex
// file or a workspace folder, else vibelang on PATH.
function findServer(): Server | undefined {
  const folders = vscode.workspace.workspaceFolders ?? []
  const configured = vscode.workspace.getConfiguration("vibelang").get<string>("server.path", "").trim()
  if (configured !== "") {
    const expanded = configured.startsWith("~/") ? path.join(os.homedir(), configured.slice(2)) : configured
    const base = folders[0]?.uri.fsPath
    const command = path.isAbsolute(expanded) || base === undefined ? expanded : path.resolve(base, expanded)
    return { command, from: "the vibelang.server.path setting" }
  }

  const executable = process.platform === "win32" ? "vibelang.cmd" : "vibelang"
  const starts: string[] = []
  const active = vscode.window.activeTextEditor?.document
  if (active && vibeLanguages.includes(active.languageId) && active.uri.scheme === "file") starts.push(path.dirname(active.uri.fsPath))
  for (const document of vscode.workspace.textDocuments) {
    if (vibeLanguages.includes(document.languageId) && document.uri.scheme === "file") starts.push(path.dirname(document.uri.fsPath))
  }
  for (const folder of folders) starts.push(folder.uri.fsPath)
  for (const start of starts) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules", ".bin", executable)
      if (isExecutableFile(candidate)) return { command: candidate, from: path.join(path.basename(dir), "node_modules", ".bin") }
      if (path.dirname(dir) === dir) break
    }
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = dir === "" ? "" : path.join(dir, executable)
    if (candidate !== "" && isExecutableFile(candidate)) return { command: candidate, from: "PATH" }
  }
  return undefined
}

function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

// servesTypeScriptFiles reports whether the server should also serve .ts and
// .js documents. In auto mode it does when the editor's built-in TypeScript
// features are off, so no file gets two sets of diagnostics, hovers, and
// completions.
function servesTypeScriptFiles(): boolean {
  const mode = vscode.workspace.getConfiguration("vibelang").get<string>("server.typeScriptFiles", "auto")
  if (mode === "on") return true
  if (mode === "off") return false
  return builtInTypeScriptIsOff()
}

// builtInTypeScriptIsOff reports whether the built-in TypeScript extension is
// disabled, or, in Cursor, stood down by typescript.experimental.useTsgo.
// VS Code's own extension stands down for that setting only when the
// TypeScript 7 extension is installed, which then serves .ts files itself.
function builtInTypeScriptIsOff(): boolean {
  if (vscode.extensions.getExtension("vscode.typescript-language-features") === undefined) return true
  return isCursor() && vscode.workspace.getConfiguration("typescript").get<boolean>("experimental.useTsgo") === true
}

function isCursor(): boolean {
  return vscode.env.appName.toLowerCase().includes("cursor")
}

// serveTypeScriptFiles turns the built-in TypeScript features off for this
// workspace, so VibeLang's server serves .ts and .js files too: a .ts
// file that imports a .vibe module then resolves it.
async function serveTypeScriptFiles(): Promise<void> {
  if (builtInTypeScriptIsOff()) {
    await vscode.window.showInformationMessage("VibeLang already serves .ts and .js files in this workspace.")
    return
  }
  if (isCursor()) {
    await vscode.workspace.getConfiguration("typescript").update("experimental.useTsgo", true, vscode.ConfigurationTarget.Workspace)
    await vscode.commands.executeCommand("workbench.action.restartExtensionHost")
    return
  }
  const choice = await vscode.window.showInformationMessage(
    "To let VibeLang serve .ts and .js files, disable the built-in extension \"TypeScript and JavaScript Language Features\" for this workspace (Disable (Workspace)), then reload the window.",
    "Show Extension"
  )
  if (choice !== undefined) {
    await vscode.commands.executeCommand("workbench.extensions.search", "@builtin TypeScript and JavaScript Language Features")
  }
}
