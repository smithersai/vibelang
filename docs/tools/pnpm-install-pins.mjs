import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { lexer } from "marked"

const shared = "@effect/platform-node-shared"

function* blocks(tokens) {
  for (const token of tokens) {
    if (token.type === "blockquote") yield* blocks(token.tokens)
    else if (token.type === "list") {
      for (const item of token.items) yield* blocks(item.tokens)
    } else yield token
  }
}

// npm's package.json overrides do not configure pnpm's dependency resolution.
export function pnpmInstallProblems(markdown, expected, file = "document") {
  const problems = []
  let context = "", workspace, offset = 0
  for (const token of blocks(lexer(markdown))) {
    let at = markdown.indexOf(token.raw, offset)
    if (at < 0 && token.type === "code") at = markdown.indexOf(token.text.split("\n", 1)[0], offset)
    if (at >= 0) offset = at + (markdown.startsWith(token.raw, at) ? token.raw.length : token.text.length)
    if (token.type !== "code") {
      context += token.raw ?? ""
      continue
    }
    const language = (token.lang ?? "").split(/\s+/, 1)[0].toLowerCase()
    if (/^(?:yaml|yml)$/.test(language) && /pnpm-workspace\.yaml/.test(context + (token.lang ?? ""))) {
      workspace = token.text
    }
    if (/^(?:sh|shell|bash|console)$/.test(language) &&
        /(?:^|\n)[ \t]*pnpm\s+add\b/.test(token.text) &&
        /(?:^|\s)(?:effect(?:@|\s|$)|@effect\/platform-node(?:@|\s|$))/.test(token.text)) {
      let pin
      try { pin = workspace === undefined ? undefined : Bun.YAML.parse(workspace)?.overrides?.[shared] } catch {}
      if (pin !== expected) {
        const line = markdown.slice(0, Math.max(0, at)).split("\n").length
        problems.push(file + ":" + line + ": pnpm installs need " + shared + " pinned to " + expected +
          " under overrides in pnpm-workspace.yaml before the add commands; package.json overrides apply to npm and Bun")
      }
    }
    context = ""
  }
  return problems
}

export function userPnpmInstallProblems(repo = fileURLToPath(new URL("../../", import.meta.url))) {
  const expected = JSON.parse(readFileSync(join(repo, "packages/runtime/package.json"), "utf8")).peerDependencies.effect
  const pages = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(join(directory, entry.name)) :
      entry.name.endsWith(".md") && entry.name !== "release-notes.md" ? [join(directory, entry.name)] : [])
  return pages(join(repo, "docs/user/src")).flatMap(file =>
    pnpmInstallProblems(readFileSync(file, "utf8"), expected, file))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = userPnpmInstallProblems()
  for (const problem of problems) console.error(problem)
  console.log("pnpm installation pins: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
