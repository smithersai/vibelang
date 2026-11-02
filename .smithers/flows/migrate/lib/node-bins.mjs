// A package script that runs a workspace package's Node bin, such as
// Smithers' `pnpm exec smthrs target …`, runs that program in its own Node
// process, which reads the repository's sources itself: once a module it
// reaches is .vibe, Node needs vibelang's loader (smithers: target-index
// failed on NodeControl.ts -> ./internal/ControlNdjson.vibe). Setup gives such
// an invocation NODE_OPTIONS="--import=vibelang/register", as it does a Vite
// config that imports migrated sources (vite-config.mjs).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { nativeConfigDependency } from "./vite-config.mjs"

const preload = 'NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" '
// A bin invocation in a package script, after any environment assignments and
// a package-manager launcher.
const binCall = /^(\s*\(?\s*(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*)((?:(?:pnpm|npm)\s+exec\s+|npx\s+|pnpm\s+)?)([@\w][\w@./-]*)(?=\s|[)]|$)/

/**
 * The Node bins the workspace's own packages declare, by command name, as
 * repository-relative files. A bin whose file starts with a shebang naming
 * another runtime (bun, deno) is left out.
 */
export function workspaceNodeBins(root, manifests) {
  const bins = new Map()
  for (const { dir } of manifests) {
    const path = join(root, dir, "package.json")
    if (!existsSync(path)) continue
    let pkg
    try { pkg = JSON.parse(readFileSync(path, "utf8")) } catch { continue }
    const entries = typeof pkg.bin === "string" ? [[String(pkg.name ?? "").replace(/^@[^/]+\//, ""), pkg.bin]] : Object.entries(pkg.bin ?? {})
    for (const [name, target] of entries) {
      if (!name || typeof target !== "string") continue
      const file = posix.normalize(posix.join(dir, target))
      if (!existsSync(join(root, file))) continue
      const first = readFileSync(join(root, file), "utf8").split("\n", 1)[0]
      if (first.startsWith("#!") && !/\bnode\b/.test(first)) continue
      bins.set(name, file)
    }
  }
  return bins
}

/**
 * scripts with NODE_OPTIONS loading vibelang/register before each invocation
 * of a bin in needed (command names), keeping shell chaining, a launcher and
 * a NODE_OPTIONS the script already sets. A script that already loads it is
 * left as it is. Returns { scripts, wired } with the bins it wired.
 */
export function nodeBinScripts(scripts = {}, needed) {
  const wired = new Set()
  const next = Object.fromEntries(Object.entries(scripts).map(([name, command]) => {
    if (typeof command !== "string") return [name, command]
    const text = command.split(/(&&|\|\||;)/).map(part => {
      const call = binCall.exec(part)
      if (!call || !needed.has(call[3])) return part
      wired.add(call[3])
      const before = call[1]
      if (/vibelang\/register/.test(before)) return part
      const rest = part.slice(before.length)
      const assigned = /\bNODE_OPTIONS=(?:"([^"]*)"|'([^']*)'|([^\s]+))(?=\s|$)/.exec(before)
      if (assigned) {
        const value = (assigned[1] ?? assigned[2] ?? assigned[3]) + " --import=vibelang/register"
        const q = assigned[2] === undefined ? '"' : "'"
        return before.slice(0, assigned.index) + "NODE_OPTIONS=" + q + value + q + before.slice(assigned.index + assigned[0].length) + rest
      }
      return before + preload + rest
    }).join("")
    return [name, text]
  }))
  return { scripts: next, wired: [...wired] }
}

/**
 * Wires every package script that runs a workspace Node bin whose runtime
 * imports reach a .vibe module or a source setup will migrate (packages'
 * sources), and adds vibelang to that package's devDependencies.
 */
export function wireNodeBins({ root, packages, manifests, ts, specsFor }) {
  const bins = workspaceNodeBins(root, manifests)
  const needed = new Set([...bins].filter(([, file]) => nativeConfigDependency({ root, file, packages, ts })).map(([name]) => name))
  const changed = [], wired = new Set()
  if (!needed.size) return { changed, bins: [] }
  for (const { dir } of manifests) {
    const file = posix.join(dir, "package.json")
    if (!existsSync(join(root, file))) continue
    const before = readFileSync(join(root, file), "utf8")
    const pkg = JSON.parse(before)
    const result = nodeBinScripts(pkg.scripts, needed)
    result.wired.forEach(name => wired.add(name))
    if (JSON.stringify(result.scripts) === JSON.stringify(pkg.scripts ?? {})) continue
    pkg.scripts = result.scripts
    if (!pkg.dependencies?.vibelang && !pkg.devDependencies?.vibelang) pkg.devDependencies = { ...pkg.devDependencies, vibelang: specsFor(dir).vibelang }
    writeFileSync(join(root, file), JSON.stringify(pkg, null, 2) + "\n")
    changed.push(file)
  }
  return { changed, bins: [...wired] }
}
