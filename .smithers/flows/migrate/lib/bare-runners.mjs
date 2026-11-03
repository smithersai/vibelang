// A runner that loads source with no VibeLang loader cannot read a .vibe module:
// Node on a package bin (ERR_UNKNOWN_FILE_EXTENSION), `bun file` where no bunfig
// preloads vibelang/bun, or Playwright's Babel. Compile, declarations and tests
// pass, and the tool fails only when someone runs it. Setup wires what it can, so
// what is left here stays TypeScript: each module such an entry reaches, by name.
import { existsSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { parseImports } from "./imports.mjs"
import { sourceGraph } from "./test-bundles.mjs"

const loader = /\bvibelang\/(?:register|bun)\b/
const runners = new Set(["node", "bun", "tsx", "ts-node"])
// Words that may stand before a runner in a script's command.
const wrappers = new Set(["exec", "npx", "bunx", "time", "cross-env", "dotenv", "--"])
const managers = new Set(["pnpm", "npm", "yarn"])
const bunCommands = new Set(["test", "t", "install", "i", "add", "a", "remove", "rm", "update", "link", "unlink", "pm", "x", "create", "c", "init", "build", "upgrade", "outdated", "publish", "repl", "patch"])
const valueFlags = new Set(["--import", "--require", "-r", "--preload", "--loader", "--experimental-loader", "--env-file", "--conditions", "-C", "--tsconfig", "--tsconfig-override", "--config", "-c", "--cwd"])
const scriptEntry = /\.(?:[cm]?[jt]sx?|vibe)$/
const playwrightConfig = /(?:^|\/)playwright(?:[.-][^/]*)?\.config\.[cm]?[jt]s$/
const playwrightTest = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/**
 * The script files a package script runs through a bare runner: each is
 * `{ runner, file, cwd, wired }`, file relative to the script's package.
 * `wired` says the command itself names VibeLang's loader.
 */
export function scriptEntries(script) {
  const found = []
  let cwd = "."
  for (const part of script.split(/&&|\|\||;|\|/)) {
    const words = part.replace(/[()"']/g, " ").trim().split(/\s+/).filter(Boolean)
    while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift()
    if (words[0] === "cd" && words[1]) { cwd = posix.normalize(posix.join(cwd, words[1])); continue }
    if (managers.has(words[0]) && words[1] === "exec") words.splice(0, 2)
    while (wrappers.has(words[0])) words.shift()
    const runner = words[0]
    if (!runners.has(runner)) continue
    const args = words.slice(1)
    let at = cwd, wired = false, file = null
    for (let i = 0; i < args.length && file === null; i++) {
      const word = args[i]
      if (loader.test(word)) wired = true
      if (word.startsWith("-")) {
        if (word === "--test" || word === "--eval" || word === "-e" || word === "-p" || word === "--print") { file = false; break }
        if (valueFlags.has(word)) {
          const value = args[++i] ?? ""
          if (loader.test(value)) wired = true
          if (word === "--cwd") at = posix.normalize(posix.join(at, value))
        }
        continue
      }
      if (runner === "bun" && word === "run") continue
      if (runner === "bun" && bunCommands.has(word)) { file = false; break }
      file = scriptEntry.test(word) ? word : false
    }
    if (file) found.push({ runner, file, cwd: at, wired })
  }
  return found
}

const bunfigPreloads = (root, dir) => {
  const path = join(root, dir, "bunfig.toml")
  return existsSync(path) && /(?:^|\n)\s*preload\s*=[^\n]*vibelang\/bun/.test(readFileSync(path, "utf8").split(/\n\s*\[/)[0])
}

/**
 * The bare runners' entries in a repository, and what each reaches. entries are
 * `{ runner, entry, via, cwd? }`; wired names the ones VibeLang's loader serves
 * instead. deferred lists each selected module an entry reaches, with its
 * receipts and the reason it stays TypeScript. Only a static, runtime import is
 * followed, and only an emitted file a package's map names is a boundary.
 */
export function bareRunnerDeferrals(root, selected, { paths = {}, ts } = {}) {
  if (!selected.length) return { entries: [], wired: [], deferred: [] }
  const graph = sourceGraph(root, { paths, ts })
  const { files, manifests, known, text, deps, runtimeFile } = graph
  const entries = [], wired = [], binEntries = new Set(), named = []
  const add = (target, receipt) => (target ? entries : wired).push(receipt)
  for (const [dir, manifest] of manifests) {
    const bins = typeof manifest.bin === "string" ? { [manifest.name ?? dir]: manifest.bin } : manifest.bin ?? {}
    for (const [name, target] of Object.entries(bins)) {
      if (typeof target !== "string") continue
      const entry = runtimeFile(posix.join(dir, target))
      if (!entry) continue
      binEntries.add(entry)
      const shebang = /^#!.*$/.exec(text(entry).split("\n", 1)[0])?.[0] ?? ""
      const loads = loader.test(shebang) || parseImports(text(entry)).some(i => loader.test(i.specifier)) || (/\bbun\b/.test(shebang) && bunfigPreloads(root, dir))
      add(!loads, { runner: /\bbun\b/.test(shebang) ? "bun" : "node", entry, via: `${posix.join(dir, "package.json")} bin ${name}` })
    }
    for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
      if (typeof script !== "string") continue
      for (const command of scriptEntries(script)) {
        const entry = runtimeFile(posix.join(dir, command.cwd, command.file))
        if (!entry) continue
        const cwd = posix.normalize(posix.join(dir, command.cwd))
        const served = command.wired || (command.runner === "bun" && bunfigPreloads(root, cwd))
        const receipt = { runner: command.runner, entry, cwd, via: `${posix.join(dir, "package.json")} scripts.${name}` }
        add(!served, receipt)
        // A loader reads what it reaches, but the script still names this file by its .ts path.
        if (served) named.push(receipt)
      }
    }
  }
  for (const file of files) {
    // A script its shebang runs from any directory: `./scripts/clean.ts`, and only a loader it names itself is sure.
    const shebang = /^#!.*\b(node|bun|tsx|ts-node)\b.*$/.exec(text(file).split("\n", 1)[0])
    if (shebang && !binEntries.has(file)) {
      const served = loader.test(shebang[0]) || parseImports(text(file)).some(i => loader.test(i.specifier))
      add(!served, { runner: shebang[1], entry: file, via: `${file} shebang` })
    }
    // Playwright compiles a config and its tests with Babel, whatever else the package sets up.
    if (playwrightConfig.test(file)) {
      const directory = /\btestDir\s*:\s*["'`]([^"'`]+)["'`]/.exec(text(file))?.[1]
      const under = posix.normalize(posix.join(posix.dirname(file), directory ?? "."))
      entries.push({ runner: "playwright", entry: file, via: file })
      for (const test of files) {
        if (playwrightTest.test(test) && (under === "." || test.startsWith(under + "/"))) entries.push({ runner: "playwright", entry: test, via: file })
      }
    } else if (text(file).includes("playwright") && parseImports(text(file)).some(i => !i.typeOnly && /^(?:@playwright\/test|playwright)$/.test(i.specifier))) {
      entries.push({ runner: "playwright", entry: file, via: file })
    }
  }
  const wanted = new Set(selected), found = new Map(), walked = new Map(), names = new Map()
  const reach = entry => {
    if (walked.has(entry)) return walked.get(entry)
    const seen = new Set(), todo = [entry]
    while (todo.length) {
      const file = todo.pop()
      if (seen.has(file) || !known.has(file)) continue
      seen.add(file)
      todo.push(...deps(file))
    }
    walked.set(entry, seen)
    return seen
  }
  for (const receipt of entries) for (const file of reach(receipt.entry)) {
    if (!wanted.has(file)) continue
    const list = found.get(file) ?? []
    if (!list.some(item => item.entry === receipt.entry && item.via === receipt.via && item.runner === receipt.runner)) list.push(receipt)
    found.set(file, list)
  }
  for (const receipt of named) {
    if (wanted.has(receipt.entry) && !found.has(receipt.entry)) names.set(receipt.entry, receipt)
  }
  const describe = r => `${r.runner} runs ${r.entry} (${r.via})`
  const deferred = [...found].sort(([a], [b]) => a.localeCompare(b)).map(([file, runBy]) => ({
    file, runBy,
    reason: `stays TypeScript: ${describe(runBy[0])}${runBy.length > 1 ? ` and ${runBy.length - 1} more` : ""} with no VibeLang loader, and cannot load a .vibe module; wire the runner or change its entry first`
  }))
  for (const [file, receipt] of names) deferred.push({
    file, runBy: [receipt],
    reason: `stays TypeScript: ${describe(receipt)} by this path, and no step rewrites a script's path; change the script first`
  })
  deferred.sort((a, b) => a.file.localeCompare(b.file))
  return { entries, wired, deferred }
}
