import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// ECMA-262 ImportDeclaration already includes import ModuleSpecifier ;.
// Extending ModuleSpecifier changes both native import alternatives. Adding
// that side-effect alternative again creates two derivations (R25 ASTRA-1).
export function importAlternatives(text) {
  const fence = String.fromCharCode(96).repeat(3)
  const start = text.search(/^ImportDeclaration\s*=/m)
  if (start < 0) return []
  const production = text.slice(start).split(fence)[0].replace(/^ImportDeclaration\s*=\s*/, "")
  return production.split(/\n\s*\|/).map(x => x.trim().replace(/\s+/g, " "))
}
export function sideEffectImportDerivations(text) {
  return importAlternatives(text).filter(alternative =>
    /^an ordinary TypeScript import declaration using ModuleSpecifier\b/.test(alternative) ||
    /^"import"\s+ModuleSpecifier\s+";"/.test(alternative))
}
export function lintImportGrammar(text) {
  const paths = sideEffectImportDerivations(text)
  return paths.length > 1 ? [{
    line: text.slice(0, text.search(/^ImportDeclaration\s*=/m)).split("\n").length,
    message: "side-effect imports have multiple derivations: the native TypeScript import production already includes import ModuleSpecifier ;"
  }] : []
}
export function readImportGrammar(root = fileURLToPath(new URL("../design", import.meta.url))) {
  return readFileSync(resolve(root, "src/900-appendices.md"), "utf8")
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = lintImportGrammar(readImportGrammar(process.env.SPEC_ROOT))
  for (const failure of failures) console.error("900-appendices.md:" + failure.line + ": " + failure.message)
  console.log("import-grammar: " + failures.length + " violations")
  process.exitCode = failures.length ? 1 : 0
}
