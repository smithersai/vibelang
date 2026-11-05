import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { lexer } from "marked"

// Chapter 5's written-shape form supplies no namespace outside its own body.
export function serviceShapeAdviceProblems(text, file = "document") {
  const problems = []
  function paragraph(token) {
    const codes = []
    const mask = tokens => tokens.map(item => {
      if (item.type === "codespan") {
        const index = codes.push(item.text) - 1
        return "@CODE" + index + "@"
      }
      return item.tokens ? mask(item.tokens) : item.text ?? item.raw ?? ""
    }).join("")
    const prose = mask(token.tokens ?? [])
    const names = new Set(codes.flatMap(code => {
      const match = /^service\s+([A-Za-z_$][\w$]*)\s*:/.exec(code)
      return match ? [match[1]] : []
    }))
    if (!names.size) return
    const line = text.slice(0, text.indexOf(token.raw)).split("\n").length
    for (const sentence of prose.split(/[.!?]\s+/)) {
      if (!/\b(?:resolves|denotes|names|represents)\b|\bis an? alias\b/i.test(sentence)) continue
      if (/\bdoes not (?:resolve|denote|name)|\bnot an? alias\b/i.test(sentence)) continue
      if (/\b(?:inside|within)\b[^.!?]*\bbody\b/i.test(sentence)) continue
      for (const match of sentence.matchAll(/@CODE(\d+)@/g)) {
        const alias = /^([A-Za-z_$][\w$]*)\s*\.\s*Shape$/.exec(codes[Number(match[1])])
        if (alias && names.has(alias[1])) {
          problems.push(file + ":" + line + ": " + alias[1] + ".Shape names a written whole shape only inside its service body; qualify the scope and name the written type or Context.Service.Shape outside")
        }
      }
    }
  }
  function visit(tokens) {
    for (const token of tokens) {
      if (token.type === "code") continue
      if (token.type === "paragraph" || token.type === "text" && token.tokens) paragraph(token)
      else if (token.tokens) visit(token.tokens)
      if (token.items) for (const item of token.items) visit(item.tokens)
    }
  }
  visit(lexer(text))
  return problems
}

export function userServiceShapeProblems(root = fileURLToPath(new URL("../user/src", import.meta.url))) {
  const pages = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(join(directory, entry.name)) : entry.name.endsWith(".md") ? [join(directory, entry.name)] : [])
  const supporting = [
    "../../packages/compiler/skills/vibelang/SKILL.md",
    "../../README.md",
    "../../.smithers/flows/migrate/rules.md",
    "../../.smithers/flows/migrate/context.md"
  ].map(path => fileURLToPath(new URL(path, import.meta.url)))
  return [...pages(root), ...supporting].flatMap(file => serviceShapeAdviceProblems(readFileSync(file, "utf8"), file))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = userServiceShapeProblems()
  for (const problem of problems) console.error(problem)
  console.log("service shape advice: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
