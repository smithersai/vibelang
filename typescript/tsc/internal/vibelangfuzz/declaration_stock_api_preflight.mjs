// The stock declaration API preflight: the emitted baseline's own declaration
// roots, checked with skipLibCheck off. The cold command and the long-lived
// worker run this one function; the worker only supplies parsed dependency
// declarations, as TypeScript's document registry shares them between programs.
import { readdirSync } from "node:fs"
import { join } from "node:path"

export function stockAPIPreflight(ts, root, dependencySource) {
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile)
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  if (parsed.errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors,
    { getCanonicalFileName: x => x, getCurrentDirectory: () => root, getNewLine: () => "\n" }))
  const roots = []
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (/\.d\.[cm]?ts$/.test(entry.name)) roots.push(file)
    }
  }
  visit(join(root, "__identity_out")); roots.sort()
  if (!roots.length) throw Error("stock emitted no declaration roots")
  const options = { ...parsed.options, noEmit: true, skipLibCheck: false }
  const host = ts.createCompilerHost(options)
  if (dependencySource) {
    const read = host.getSourceFile.bind(host)
    host.getSourceFile = (file, languageVersion, onError, fresh) => {
      if (!fresh && file.includes("/node_modules/") && /\.d\.[cm]?ts$/.test(file)) {
        const text = host.readFile(file)
        const shared = typeof text === "string" ? dependencySource(file, options, languageVersion, text, host) : undefined
        if (shared) return shared
      }
      return read(file, languageVersion, onError, fresh)
    }
  }
  const program = ts.createProgram(roots, options, host)
  return roots.flatMap(file => {
    const source = program.getSourceFile(file)
    if (!source) throw Error("stock declaration root was not loaded: " + file)
    return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
  }).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ({ code: d.code, file: d.file?.fileName, text: ts.flattenDiagnosticMessageText(d.messageText, "\n") }))
}
