import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { lexer } from "marked"

function* blocks(tokens) {
  for (const token of tokens) {
    if (token.type === "blockquote") yield* blocks(token.tokens)
    else if (token.type === "list") {
      for (const item of token.items) yield* blocks(item.tokens)
    } else yield token
  }
}

// Yarn uses root package.json resolutions rather than npm's overrides.
export function yarnInstallProblems(markdown, expected, directed = false, file = "document") {
  let pin = false, command = false, context = ""
  const problems = []
  const problem = () => file + ": Yarn installation needs @effect/platform-node-shared pinned to " +
    expected + " under resolutions in the root package.json before the add commands"
  for (const token of blocks(lexer(markdown))) {
    if (token.type !== "code") {
      context += token.raw ?? ""
      continue
    }
    const language = (token.lang ?? "").split(/\s+/, 1)[0].toLowerCase()
    if (language === "json" && /package\.json/.test(context + (token.lang ?? ""))) {
      try { pin ||= JSON.parse(token.text)?.resolutions?.["@effect/platform-node-shared"] === expected } catch {}
    }
    if (/^(?:sh|shell|bash|console)$/.test(language) &&
        /(?:^|\n)[ \t]*yarn\s+add\b/.test(token.text) &&
        /(?:^|\s)(?:effect(?:@|\s|$)|@effect\/platform-node(?:@|\s|$))/.test(token.text)) {
      command = true
      if (!pin) problems.push(problem())
    }
    context = ""
  }
  if (directed && !command && !pin) problems.push(problem())
  return problems
}

export function userYarnInstallProblems(repo = fileURLToPath(new URL("../../", import.meta.url))) {
  const read = file => readFileSync(join(repo, file), "utf8")
  const expected = JSON.parse(read("packages/runtime/package.json")).peerDependencies.effect
  const overview = read("docs/user/src/setup.md")
  const file = "docs/user/src/setup/existing-project.md"
  return yarnInstallProblems(read(file), expected, /\byarn add\b/.test(overview), file)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = userYarnInstallProblems()
  for (const problem of problems) console.error(problem)
  console.log("Yarn installation pins: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
