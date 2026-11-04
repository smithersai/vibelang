// Derives the VibeLang TextMate grammar from VS Code's TypeScript and TSX grammars.
//
// The grammar is TypeScript's with a new name and root scope,
// source.vibe or source.vibex, plus VibeLang's declaration and statement forms
// (vibelang-grammar.mjs). Inner scopes keep their .ts or .tsx suffix, so every
// theme rule written for TypeScript colors VibeLang the same way. The JSDoc injection is retargeted to the new
// root scope. Both source files are MIT-licensed; see ThirdPartyNotices.txt.
//
// Usage: node scripts/derive-grammar.mjs [typescript-basics directory]
//
// The directory defaults to the typescript-basics extension inside
// /Applications/Visual Studio Code.app.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { addVibeLangSyntax } from "./vibelang-grammar.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const source =
  process.argv[2] ?? "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/typescript-basics"
const syntaxes = path.join(here, "..", "syntaxes")
const read = (file) => JSON.parse(readFileSync(path.join(source, "syntaxes", file), "utf8"))
const write = (file, json) => writeFileSync(path.join(syntaxes, file), JSON.stringify(json, null, "\t") + "\n")

const note =
  "Derived for VibeLang by editors/vscode/scripts/derive-grammar.mjs from the TypeScript grammar that VS Code ships; it adds the VibeLang forms in vibelang-grammar.mjs."

for (const [base, kind, language, scope] of [
  ["TypeScript", "ts", "VibeLang", "vibe"],
  ["TypeScriptReact", "tsx", "VibeLangReact", "vibex"]
]) {
  const grammar = read(base + ".tmLanguage.json")
  const { information_for_contributors: info = [], version, name, scopeName, patterns, repository, ...other } = grammar
  if (name !== base || scopeName !== "source." + kind) throw new Error('unexpected grammar ' + name + ' (' + scopeName + ')')
  if (Object.keys(other).length > 0) throw new Error('unexpected grammar keys: ' + Object.keys(other).join(", "))
  write(language + ".tmLanguage.json", addVibeLangSyntax({
    information_for_contributors: [note, ...info], version,
    name: language, scopeName: "source." + scope, patterns, repository
  }))
}

const injection = read("jsdoc.ts.injection.tmLanguage.json")
const text = JSON.stringify(injection)
if (!text.includes("source.ts#docblock")) throw new Error("the JSDoc injection no longer includes source.ts#docblock")
for (const scope of ["vibe", "vibex"]) {
  write("jsdoc." + scope + ".injection.tmLanguage.json", JSON.parse(
    text.replaceAll("source.ts#docblock", "source." + scope + "#docblock")
      .replace('"scopeName":"documentation.injection.ts"', '"scopeName":"documentation.injection.' + scope + '"')
  ))
}
console.log("wrote VibeLang and VibeLangReact grammars and JSDoc injections")
