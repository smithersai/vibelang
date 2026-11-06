import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { lexer } from "marked"

// VIP-38: "imported warnings affect both by default." The zero-exit
// promise in configuration advice applies only to VibeLang's own warnings.
export function warningExitAdviceProblems(text, file = "document") {
  const problems = []
  const prose = tokens => tokens.map(token => token.tokens ? prose(token.tokens) : token.text ?? token.raw ?? "").join("")
  const check = token => {
    const paragraph = prose(token.tokens ?? []).replace(/\s+/g, " ")
    if (!/\bEK38(?:xx|\d+)\b/.test(paragraph)) return
    for (const match of paragraph.matchAll(/\bwarnings?\s+(?:alone\s+)?(?:keep|leave)\s+(?:the\s+)?exit\s+status\s+(?:at\s+)?(?:zero|0)\b/gi)) {
      if (/\bown\s+$/i.test(paragraph.slice(0, match.index))) continue
      const line = text.slice(0, text.indexOf(token.raw)).split("\n").length
      problems.push(file + ":" + line + ": qualify the zero-exit promise as VibeLang's own warnings; imported Effect warnings follow the compiler plugin's exit options")
    }
  }
  const visit = tokens => {
    for (const token of tokens) {
      if (token.type === "code") continue
      if (token.type === "paragraph" || token.type === "text" && token.tokens) check(token)
      else if (token.tokens) visit(token.tokens)
      if (token.items) for (const item of token.items) visit(item.tokens)
    }
  }
  visit(lexer(text))
  return problems
}

export function userWarningExitProblems(root = fileURLToPath(new URL("../user/src", import.meta.url))) {
  const pages = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(join(directory, entry.name)) : entry.name.endsWith(".md") ? [join(directory, entry.name)] : [])
  const supporting = [
    "../../packages/compiler/skills/vibelang/SKILL.md",
    "../../README.md",
    "../../.smithers/flows/migrate/rules.md",
    "../../.smithers/flows/migrate/context.md"
  ].map(path => fileURLToPath(new URL(path, import.meta.url)))
  return [...pages(root), ...supporting].flatMap(file => warningExitAdviceProblems(readFileSync(file, "utf8"), file))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = userWarningExitProblems()
  for (const problem of problems) console.error(problem)
  console.log("warning exit advice: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
