// Oxlint's JS plugins, when the migration moves one to VibeLang. Oxlint's
// plugin host is Node, which loads a plugin's .vibe modules only through
// vibelang/register: without it every lint fails with
// ERR_UNKNOWN_FILE_EXTENSION ".vibe" (t3code's oxlint-plugin-t3code, 16
// modules). Setup preloads the loader in each package script that runs
// Oxlint, and in the plugin package's own test scripts, whose RuleTester
// spawns Oxlint with their environment.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { oxlintConfigs, repositoryPackages } from "./wire.mjs"

const preload = 'NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" '

/** The jsPlugins specifiers of an Oxlint config's text: a JSON(C) config's array, or a TypeScript config's literal one. */
export function jsPluginSpecifiers(ts, name, text) {
  if (/\.json[c]?$/.test(name)) {
    const { config } = ts.parseConfigFileTextToJson(name, text)
    return (config?.jsPlugins ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.specifier)).filter((s) => typeof s === "string")
  }
  const list = /\bjsPlugins\s*:\s*\[([^\]]*)\]/.exec(text)
  return list ? [...list[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]) : []
}

/**
 * command, a package script, with vibelang/register preloaded into each of
 * its commands that runs is(words): kept where it already loads it, added to
 * a NODE_OPTIONS it sets, or written before it.
 */
export function preloadRegister(command, is) {
  return command.split(/(&&|\|\||;|\|)/).map((part, i) => {
    if (i % 2) return part
    const lead = /^\s*\(?\s*((?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*)/.exec(part)
    const rest = part.slice(lead[0].length)
    if (!is(rest.replace(/\)\s*$/, "").trim().split(/\s+/))) return part
    if (/--import(?:=|\s+)vibelang\/register(?=["'\s]|$)/.test(part)) return part
    const assigned = /\bNODE_OPTIONS=(?:"([^"]*)"|'([^']*)'|([^\s]+))(?=\s|$)/.exec(lead[1])
    const at = lead[0].length - lead[1].length
    if (assigned) {
      const value = (assigned[1] ?? assigned[2] ?? assigned[3]) + " --import=vibelang/register"
      const q = assigned[2] === undefined ? '"' : "'"
      const start = at + assigned.index
      return part.slice(0, start) + "NODE_OPTIONS=" + q + value + q + part.slice(start + assigned[0].length)
    }
    return part.slice(0, at) + preload + part.slice(at)
  }).join("")
}

// A command that runs Oxlint: oxlint itself, or Vite+'s lint.
const runsOxlint = (words) => words[0] === "oxlint" || ((words[0] === "vp" || words[0] === "vite-plus") && words[1] === "lint") ||
  (/^(?:npx|bunx|pnpm|yarn)$/.test(words[0]) && words.slice(1).some((w) => w === "oxlint"))
// A command that runs a test runner, which a RuleTester runs Oxlint under.
const runsTests = (words) => /^(?:vitest|jest|mocha)$/.test(words[0]) || ((words[0] === "vp" || words[0] === "vite-plus") && words[1] === "test") ||
  (words[0] === "bun" && words[1] === "test") || (words[0] === "node" && words.includes("--test"))

/**
 * Preloads vibelang/register where Oxlint loads a JS plugin from a migrated
 * package (migrated holds their directories): each package script that runs
 * Oxlint, and each test script of the plugin's package. Returns the
 * manifests changed.
 */
export function wireOxlintPlugins({ root, migrated, ts }) {
  const packages = repositoryPackages(root)
  const plugins = new Set()
  for (const name of oxlintConfigs.filter((name) => existsSync(join(root, name)))) {
    for (const specifier of jsPluginSpecifiers(ts, name, readFileSync(join(root, name), "utf8"))) {
      const local = /^\.\.?\//.test(specifier)
      const packageName = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/")
      const pkg = local
        ? packages.filter((p) => p.dir === "." || posix.normalize(specifier).startsWith(p.dir + "/")).sort((a, b) => b.dir.length - a.dir.length)[0]
        : packages.find((p) => p.manifest.name === packageName)
      if (pkg && migrated.includes(pkg.dir)) plugins.add(pkg.dir)
    }
  }
  if (!plugins.size) return []
  const changed = []
  for (const { dir, manifest } of packages) {
    if (!manifest.scripts || typeof manifest.scripts !== "object") continue
    let edited = false
    for (const [script, command] of Object.entries(manifest.scripts)) {
      if (typeof command !== "string") continue
      let next = preloadRegister(command, runsOxlint)
      if (plugins.has(dir) && /^test(?::|$)/.test(script)) next = preloadRegister(next, runsTests)
      if (next !== command) {
        manifest.scripts[script] = next
        edited = true
      }
    }
    if (edited) {
      const file = posix.join(dir, "package.json")
      writeFileSync(join(root, file), JSON.stringify(manifest, null, 2) + "\n")
      changed.push(file)
    }
  }
  return changed
}
