// Internal loader diagnostic selection. Global configuration errors still fail
// every load: a config is not a listed program source. An inline module shares its containing source's diagnostics.
import { realpathSync } from "node:fs"

const realpath = (path) => {
  try { return realpathSync(path) } catch { return path }
}

// main.vibe.text.js, main.vibex.text.js and main.vibex.text.jsx are module
// declarations of their .vibe or .vibex file: vibelang/project's
// moduleDeclarationSource, which imports this module.
const moduleDeclarationSource = (path) => /^(.+\.vibex?)\.[^./\\]+\.jsx?$/.exec(path)?.[1]

export function diagnosticsForFile(diagnostics, file, files) {
  const source = realpath(moduleDeclarationSource(file) ?? file)
  return diagnostics.filter((diagnostic) => !diagnostic.file || !files.includes(diagnostic.file) || realpath(diagnostic.file) === source)
}

/** Formats a diagnostic as `file:line:column - error TS2322: text`. */
export function formatDiagnostic(diagnostic) {
  const where = diagnostic.file ? `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} - ` : ""
  return `${where}${diagnostic.category} ${diagnostic.code}: ${diagnostic.text}`
}

// What vibelang/register and vibelang/bun print for a module they load: each
// warning of that module, and each project-wide one, once per compile. A
// warning is a diagnostic the build prints but does not fail on, such as an
// Effect lint error under ignoreEffectErrorsInTscExitCode, which `vibelang -p`
// prints before it exits 0. The bundler plugins hand the same warnings to the
// bundler's log.
const reported = new WeakMap()

export function reportWarnings(result, file, report) {
  let seen = reported.get(result)
  if (seen === undefined) reported.set(result, seen = new Set())
  for (const warning of diagnosticsForFile(result.warnings, file, result.files)) {
    if (seen.has(warning)) continue
    seen.add(warning)
    report(formatDiagnostic(warning))
  }
}
