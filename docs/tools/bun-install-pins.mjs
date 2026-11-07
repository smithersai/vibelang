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

// Bun ignores resolutions when the same manifest has an overrides field.
export function bunInstallProblems(markdown, expected, file = "document") {
  const options = new Set(), problems = []
  let context = ""
  for (const token of blocks(lexer(markdown))) {
    if (token.type !== "code") {
      context += token.raw ?? ""
      continue
    }
    const language = (token.lang ?? "").split(/\s+/, 1)[0].toLowerCase()
    if (language === "json" && /package\.json/.test(context + (token.lang ?? ""))) {
      try {
        const config = JSON.parse(token.text)
        const active = Object.hasOwn(config, "overrides") ? "overrides" :
          Object.hasOwn(config, "resolutions") ? "resolutions" : undefined
        if (active && config[active]?.["@effect/platform-node-shared"] === expected) options.add(active)
      } catch {}
    }
    if (/^(?:sh|shell|bash|console)$/.test(language) &&
        /(?:^|\n)[ \t]*bun\s+add\b/.test(token.text) &&
        /(?:^|\s)(?:effect(?:@|\s|$)|@effect\/platform-node(?:@|\s|$))/.test(token.text) &&
        (!options.has("overrides") || !options.has("resolutions"))) {
      problems.push(file + ": existing-project Bun instructions need separate active overrides and resolutions " +
        "examples pinned to " + expected + " before the add commands, preserving the project's existing pin table")
    }
    context = ""
  }
  return problems
}

// A newly initialized project has no existing pin table to preserve.
export function freshBunInstallProblems(markdown, expected, file = "document") {
  let pinned = false, context = ""
  const problems = []
  for (const token of blocks(lexer(markdown))) {
    if (token.type !== "code") {
      context += token.raw ?? ""
      continue
    }
    const language = (token.lang ?? "").split(/\s+/, 1)[0].toLowerCase()
    if (language === "json" && /package\.json/.test(context + (token.lang ?? ""))) {
      try {
        const config = JSON.parse(token.text)
        const active = Object.hasOwn(config, "overrides") ? "overrides" : "resolutions"
        pinned ||= config[active]?.["@effect/platform-node-shared"] === expected
      } catch {}
    }
    if (/^(?:sh|shell|bash|console)$/.test(language)) {
      for (const line of token.text.split("\n")) {
        if (/^[ \t]*bun\s+init\b/.test(line)) pinned = false
        if (/^[ \t]*bun\s+add\b/.test(line) &&
            /(?:^|\s)(?:effect(?:@|\s|$)|@effect\/platform-node(?:@|\s|$))/.test(line) && !pinned) {
          problems.push(file + ": pin @effect/platform-node-shared to " + expected + " in the root package.json before installing Effect")
        }
      }
    }
    context = ""
  }
  return problems
}

export function userBunInstallProblems(repo = fileURLToPath(new URL("../../", import.meta.url))) {
  const expected = JSON.parse(readFileSync(join(repo, "packages/runtime/package.json"), "utf8")).peerDependencies.effect
  return ["docs/user/src/setup/existing-project.md", "docs/user/src/getting-started/004-installation.md"].flatMap(file =>
    bunInstallProblems(readFileSync(join(repo, file), "utf8"), expected, file))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = userBunInstallProblems()
  for (const problem of problems) console.error(problem)
  console.log("Bun installation pins: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
