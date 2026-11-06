// Runs TypeScript's own VS Code extension code that finds a workspace compiler
// (typescript/packages/vscode-typescript/src/util.ts) against an installed
// project. argv[2] is that code compiled to JavaScript, and argv[3] the tsdk
// directory. Prints the executable the extension picks.
import { registerHooks } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const stub = (source) => ({ format: "module", shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(source) })
const vscode = `
import { promises as fs } from "node:fs"
import { join } from "node:path"
export class Uri {
  constructor(fsPath) { this.fsPath = fsPath; this.scheme = "file" }
  static file(path) { return new Uri(path) }
  static joinPath(base, ...parts) { return new Uri(join(base.fsPath, ...parts)) }
}
export const workspace = { workspaceFolders: [], fs: { readFile: (uri) => fs.readFile(uri.fsPath), stat: (uri) => fs.stat(uri.fsPath) } }
export const window = {}, commands = {}, l10n = { t: (text) => text }, ConfigurationTarget = {}
`
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "vscode") return stub(vscode)
    if (specifier === "@typescript/typescript/vscode") return stub("export const createTypeScriptModuleLoader = () => undefined")
    if (specifier === "./tsdkPackage") return next(specifier + ".js", context)
    return next(specifier, context)
  }
})

const { resolveTsdkPathToExe } = await import(pathToFileURL(join(process.argv[2], "util.js")).href)
const found = await resolveTsdkPathToExe(process.argv[3])
console.log(JSON.stringify(found ?? null))
