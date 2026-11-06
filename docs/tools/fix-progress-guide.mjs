import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { lexer } from "marked"

// The migration runner records fix progress only when its log option is set.
// The native CLI's progress stream is standard error, not a file-writing API.
export function fixProgressGuideProblems(text, file = "document") {
  const problems = []
  const prose = tokens => tokens.map(token => token.tokens ? prose(token.tokens) : token.text ?? token.raw ?? "").join("")
  const visit = tokens => {
    for (const token of tokens) {
      if (token.type === "code") continue
      if (token.type === "paragraph" || token.type === "text" && token.tokens) {
        const paragraph = prose(token.tokens ?? []).replace(/\s+/g, " ")
        if (!/\.progress\.jsonl\b/.test(paragraph) || !/\b(?:records?|recorded|saves?|saved|writes?|wrote|written)\b/i.test(paragraph)) continue
        if (/\b(?:not|never)\s+(?:record|save|write)\b/i.test(paragraph)) continue
        const runner = /\bmigration\s+(?:runner|flow)\b/i.test(paragraph)
        const logging = /\blog\s+(?:file\s+)?path\b|\blogging\s+(?:is\s+)?enabled\b/i.test(paragraph)
        if (!runner || !logging) {
          const line = text.slice(0, text.indexOf(token.raw)).split("\n").length
          problems.push(file + ":" + line + ": progress log files belong to the migration runner with logging enabled; direct CLI progress goes to standard error")
        }
      } else if (token.tokens) visit(token.tokens)
      if (token.items) for (const item of token.items) visit(item.tokens)
    }
  }
  visit(lexer(text))
  return problems
}

export function checkFixProgressGuide(root = fileURLToPath(new URL("../..", import.meta.url))) {
  const file = "docs/user/src/setup/vibelang-cli.md"
  return fixProgressGuideProblems(readFileSync(resolve(root, file), "utf8"), file)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkFixProgressGuide()
  for (const problem of problems) console.error(problem)
  console.log("fix progress guide: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
