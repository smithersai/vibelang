// Preserve the repository's authored project roots while replacing repeated
// checks by one reference build. Unsupported shell/checker forms stay explicit.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, posix, relative, resolve } from "node:path"
import { ownedPaths, setIgnoreLine, submodulePaths } from "./wire.mjs"

export function shellCommands(text) {
  const commands = []
  let start = 0, word = "", words = [], quoted = false, quote = null, escaped = false
  const endWord = () => { if (word || quoted) words.push(word); word = ""; quoted = false }
  const end = i => { endWord(); commands.push({ raw: text.slice(start, i).trim(), words }); words = []; start = i + 2 }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (escaped) { word += c; escaped = false; continue }
    if (c === "\\" && quote !== "'") { escaped = true; continue }
    if (quote) {
      if (c === quote) quote = null
      else { if (quote === '"' && /[$`]/.test(c)) throw new Error("dynamic shell words need manual typecheck wiring"); word += c }
      continue
    }
    if (c === "'" || c === '"') { quote = c; quoted = true; continue }
    if (c === "&" && text[i + 1] === "&") { end(i); i++; continue }
    if (/[|;&()<>$`\n\r]/.test(c)) throw new Error("only literal commands joined by && can be combined")
    if (/\s/.test(c)) endWord()
    else word += c
  }
  if (quote || escaped) throw new Error("unterminated shell word")
  end(text.length)
  if (commands.some(c => !c.words.length)) throw new Error("empty typecheck command")
  return commands
}

function compilerProject(words) {
  let cwd = ".", i = 0
  if (["pnpm", "npm", "bun", "npx", "bunx"].includes(words[0])) {
    const manager = words[i++]
    if (["-C", "--dir", "--prefix"].includes(words[i])) { cwd = words[i + 1]; i += 2 }
    if (["exec", "x"].includes(words[i])) i++
    else if (["pnpm", "npm", "bun"].includes(manager)) return null
  }
  if (!["tsc", "tsgo", "tsrs", "vibelang"].includes(words[i])) return null
  i++
  let build = false, noEmit = false, projects = []
  while (i < words.length) {
    const word = words[i++]
    if (word === "-b" || word === "--build") build = true
    else if (word === "--noEmit") {
      noEmit = words[i] === "false" ? false : true
      if (words[i] === "true" || words[i] === "false") i++
    } else if (word === "-p" || word === "--project") {
      if (!words[i] || words[i].startsWith("-")) throw new Error("missing compiler project")
      projects.push(words[i++])
    } else if (word === "--pretty") {
      if (words[i] === "true" || words[i] === "false") i++
    } else if (word.startsWith("-")) throw new Error("unsupported typecheck flag: " + word)
    else if (build) projects.push(word)
    else throw new Error("unexpected compiler argument: " + word)
  }
  if (!projects.length) projects = ["tsconfig.json"]
  return projects.map(path => ({ path: posix.normalize(posix.join(cwd, path)), ...(noEmit ? { noEmit: true } : {}) }))
}

export function typecheckPlan(command, { retire = [] } = {}) {
  const parts = shellCommands(command)
  const retired = []
  const retiring = new Set(retire.map(path => posix.normalize(path)))
  const remaining = parts.filter(part => {
    const match = ["node", "bun"].includes(part.words[0]) && part.words.length === 2 && retiring.has(posix.normalize(part.words[1]))
    if (match) retired.push(part.raw)
    return !match
  })
  const commands = remaining.map(part => ({ ...part, projects: compilerProject(part.words) }))
  const indices = commands.flatMap((part, i) => part.projects ? [i] : [])
  if (!indices.length) return null
  const first = indices[0], last = indices.at(-1)
  if (commands.some(c => c.words[0] === "cd")) throw new Error("cd needs explicit typecheck wiring")
  if (commands.slice(first, last + 1).some(c => !c.projects)) throw new Error("non-checker command between typechecks needs manual wiring")
  return {
    projects: commands.flatMap(c => c.projects ?? []),
    before: commands.slice(0, first).map(c => c.raw),
    after: commands.slice(last + 1).map(c => c.raw),
    retired
  }
}

function foreignPackageDirectories(config) {
  const root = config.target, owns = ownedPaths(root), out = []
  const walk = directory => {
    const dir = posix.relative(root, directory) || "."
    const selected = config.packages?.some(p => p.dir === dir || p.dir.startsWith(dir + "/"))
    if (dir !== "." && existsSync(join(directory, "package.json")) && !selected && !owns(posix.join(dir, "package.json"))) { out.push(dir); return }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !["node_modules", ".git", ".jj", ".cache", ".vibelang", ".vibelang-toolchain", ".turbo", ".next", ".output", ".repos", ".alchemy"].includes(entry.name)) walk(join(directory, entry.name))
    }
  }
  walk(root)
  return out
}

/** Writes the shared runner and its original project roots; no checker runs here. */
export function wireTypecheckBuild(config) {
  const root = config.target, manifestPath = join(root, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const current = manifest.scripts?.typecheck
  if (!current) return { changed: [], warnings: [] }
  const runner = "node .vibelang/typecheck.mjs"
  let plan
  if (current.includes(runner)) {
    const file = join(root, ".vibelang/typecheck.json")
    if (!existsSync(file)) throw new Error("typecheck runner has no recorded project roots")
    plan = { ...JSON.parse(readFileSync(file, "utf8")), before: [], after: [], resumed: true }
  } else {
    try { plan = typecheckPlan(current, { retire: config.typecheckRetire ?? [] }) }
    catch (error) { return { changed: [], warnings: ["typecheck: " + error.message + "; original command retained"] } }
    if (!plan) return { changed: [], warnings: [] }
  }
  const changed = []
  const put = (path, text) => {
    const file = join(root, path)
    if (existsSync(file) && readFileSync(file, "utf8") === text) return
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); changed.push(path)
  }
  const options = { projects: plan.projects,
    sourceRoots: config.typecheckSourceRoots ?? plan.sourceRoots ?? ["."],
    ignoredPaths: [...new Set([...submodulePaths(root), ...foreignPackageDirectories(config), ...(plan.ignoredPaths ?? [])])],
    prepare: config.typecheckPrepare ?? plan.prepare ?? [] }
  put(".vibelang/typecheck.mjs", "// Generated by VibeLang migration setup; update its typecheck template and rerun setup.\n" + readFileSync(new URL("../templates/typecheck.mjs", import.meta.url), "utf8"))
  put(".vibelang/typecheck.json", JSON.stringify(options, null, 2) + "\n")
  const ignore = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : ""
  put(".gitignore", setIgnoreLine(setIgnoreLine(ignore, ".cache/vibelang-typecheck.json", true), "**/.vibelang-typecheck-*.json", true))
  if (!plan.resumed) {
    manifest.scripts.typecheck = [...plan.before, runner, ...plan.after].join(" && ")
    put("package.json", JSON.stringify(manifest, null, 2) + "\n")
  }
  return { changed, warnings: [], projects: options.projects, retired: plan.retired ?? [] }
}
