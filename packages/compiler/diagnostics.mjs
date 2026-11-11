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
