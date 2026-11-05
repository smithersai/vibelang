// A runner that loads source with no VibeLang loader cannot read a .vibe module:
// Node on a package bin (ERR_UNKNOWN_FILE_EXTENSION), `bun file` where no bunfig
// preloads vibelang/bun, or Playwright's Babel. Compile, declarations and tests
// pass, and the tool fails only when someone runs it. Setup wires what it can, so
// what is left here stays TypeScript: each module such an entry reaches, by name.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { parseImports } from "./imports.mjs"
import { sourceGraph } from "./test-bundles.mjs"
import { ownedPaths } from "./wire.mjs"
import { isFixtureFile, isTestFile } from "./inventory.mjs"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"

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
export function scriptEntries(script, { locations = false } = {}) {
  const found = []
  let cwd = "."
  let cursor = 0
  for (const part of script.split(/&&|\|\||;|\||\r?\n/)) {
    const start = script.indexOf(part, cursor)
    cursor = start + part.length
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
    if (file) found.push({ runner, file, cwd: at, wired, ...(locations ? { line: script.slice(0, start).split("\n").length, command: part.trim() } : {}) })
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
export function bareRunnerDeferrals(root, selected, { paths = {}, ts, routed = false } = {}) {
  if (!selected.length) return { entries: [], wired: [], deferred: [] }
  const graph = sourceGraph(root, { paths, ts })
  const { files, manifests, known, text, deps, runtimeFile, owner, dependency } = graph
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
  // Build targets can invoke a shell outside package scripts. Inspect owned
  // shells without executing or rewriting them; an unproved cwd retains all
  // matching source entries rather than certifying a loader from the wrong cwd.
  const owns = ownedPaths(root)
  const shells = dir => {
    for (const item of readdirSync(join(root, dir), { withFileTypes: true })) {
      const file = posix.join(dir, item.name)
      if (item.isDirectory()) {
        if (!item.name.startsWith(".") && !["node_modules", "dist", "build", "coverage"].includes(item.name) && owns(file + "/_probe.ts")) shells(file)
      } else if (item.isFile() && file.endsWith(".sh") && owns(file)) {
        const source = readFileSync(join(root, file), "utf8").replace(/\\\r?\n/g, " ")
        for (const command of scriptEntries(source, { locations: true })) {
          const uncertain = /[$`]/.test(command.cwd)
          const candidates = uncertain ? [] : [posix.join(command.cwd, command.file), posix.join(posix.dirname(file), command.cwd, command.file)]
          let targets = [...new Set(candidates.map(candidate => runtimeFile(candidate)).filter(Boolean))]
          if (!targets.length) {
            const suffix = command.file.replace(/^\.\//, "")
            targets = files.filter(candidate => candidate === suffix || candidate.endsWith("/" + suffix))
          }
          for (const entry of targets) {
            const receipt = { runner: command.runner, entry, cwd: uncertain ? null : command.cwd,
              via: file + ":" + command.line, command: command.command }
            add(!(command.wired && !uncertain), receipt)
          }
        }
      }
    }
  }
  shells(".")
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
  const protectedFiles = new Set(routed ? [...manifests].flatMap(([dir, manifest]) =>
    [...testOnlyScripts(root, dir, packageScripts(root, dir), manifest)]) : [])
  const routeable = new Map()
  const routedFrom = file => {
    if (!routeable.has(file)) {
      // Only the relative edges normal emission can rewrite form a boundary.
      // Entries and protected tests keep their direct source paths.
      const native = /(?<!\.d)\.(?:[cm]?tsx?)$/.test(file) && !/\.d\.vibe\.ts$/.test(file)
      routeable.set(file, new Set(native && !isTestFile(file) && !isFixtureFile(file) && !protectedFiles.has(file)
        ? parseImports(text(file)).filter(edge => !edge.typeOnly && edge.specifier.startsWith("."))
          .flatMap(edge => dependency(file, edge.specifier))
          .filter(target => wanted.has(target) && /\.(?:ts|mts|vibe)$/.test(target) && owner(file) === owner(target))
        : []))
    }
    return routeable.get(file)
  }
  const reach = entry => {
    if (walked.has(entry)) return walked.get(entry)
    const seen = new Set(), todo = [entry]
    while (todo.length) {
      const file = todo.pop()
      if (seen.has(file) || !known.has(file)) continue
      seen.add(file)
      todo.push(...deps(file).filter(target => !routed || !routedFrom(file).has(target)))
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
