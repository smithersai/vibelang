// Lint configuration names modules by path, and those paths outlive a rename:
// `overrides[].files` and `ignorePatterns` go on naming x.ts after the module
// is x.vibe, so what the repository silenced comes back (foldkit-107). The
// filesystem decides, so setup, the codemod and revert share one idempotent
// pass, and setup also repairs paths earlier runs left behind.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { platformPath } from "./platform.mjs"
import { isDeclarationFile } from "./util.mjs"

const oxlintConfig = /(?:^|\/)(?:\.?oxlintrc[^/]*\.jsonc?|oxlint\.config\.[cm]?[jt]s)$/
const eslintConfig = /(?:^|\/)(?:\.eslintrc(?:\.json|\.[cm]?js)?|eslint\.[^/]*\.[cm]?[jt]s)$/
const test = /\.test\.[cm]?[jt]s$/

/** The tracked files that configure Oxlint or ESLint, other than generated ones and their tests. */
export const lintConfigs = (tracked) => tracked.filter((file) =>
  (oxlintConfig.test(file) || eslintConfig.test(file)) && !test.test(file) && !file.startsWith(".vibelang/"))

/**
 * The string literals of a JSON, JSONC or JavaScript text, in order: { start,
 * end, value, list }, where list identifies the enclosing array, if any.
 * Property names are left out. A scan, because a config has comments, trailing
 * commas or code, and an edit touches only a string that names a real file.
 */
export function stringsOf(text) {
  const strings = [], open = []
  let lists = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i)
      i = end < 0 ? text.length : end
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end < 0 ? text.length : end + 1
    } else if (char === "[") {
      open.push(++lists)
    } else if (char === "{" || char === "(") {
      open.push(null)
    } else if (char === "]" || char === "}" || char === ")") {
      open.pop()
    } else if (char === '"' || char === "'" || char === "`") {
      let end = i + 1
      while (end < text.length && text[end] !== char && (char === "`" || text[end] !== "\n")) end += text[end] === "\\" ? 2 : 1
      const after = /\S/.exec(text.slice(end + 1))?.[0]
      if (after !== ":") strings.push({ start: i, end: end + 1, value: text.slice(i + 1, end), list: open.at(-1) ?? null })
      i = end
    }
  }
  return strings
}

// A rooted, relative or negated pattern keeps its spelling around the path.
const parts = (value) => {
  const [, lead, path] = /^(!?(?:\.\/|\/)?)(.*)$/s.exec(value)
  return { lead, path }
}

/** What a literal path becomes now that its module moved, or null: { to, also } or { remove: true }. */
function followed(value, dir, exists) {
  const { lead, path } = parts(value)
  for (const candidate of new Set([posix.join(dir, path), path])) {
    if (exists(candidate)) return null
    if (candidate.endsWith(".ts") && !isDeclarationFile(candidate) && exists(candidate.slice(0, -3) + ".vibe")) {
      return { to: lead + path.slice(0, -3) + ".vibe", also: exists(platformPath(candidate)) ? lead + platformPath(path) : null }
    }
    if (candidate.endsWith(".vibe") && exists(candidate.slice(0, -5) + ".ts")) return { to: lead + path.slice(0, -5) + ".ts", also: null }
    // revert removes the sibling a split wrote; a path to it goes too.
    if (candidate.endsWith(".platform.ts") && exists(candidate.slice(0, -12) + ".ts")) return { remove: true }
  }
  return null
}

// A wildcard names no module, so it stays, and Oxlint's globs gain the .vibe
// spelling where a module moved out from under them. Native `vibelang lint`
// matches a glob as written; the generated ESLint bridge reads .ts as .vibe.
function vibeGlob(value, dir, modules) {
  const { lead, path } = parts(value)
  if (!/[*?[]/.test(path) || !path.endsWith(".ts")) return null
  const glob = path.slice(0, -3) + ".vibe"
  const pattern = glob.includes("/") ? glob : "**/" + glob
  const matches = (module) => posix.matchesGlob(module, pattern) || posix.matchesGlob(posix.relative(dir, module), pattern)
  return modules.some(matches) ? lead + glob : null
}

// An array element leaves with the comma on one side of it.
function removal(text, { start, end }) {
  const before = /,\s*$/.exec(text.slice(0, start))
  if (before) return { start: before.index, end, text: "" }
  const after = /^\s*,\s*/.exec(text.slice(end))
  return { start, end: end + (after?.[0].length ?? 0), text: "" }
}

/**
 * Points every lint configuration at where its modules are now. A literal path
 * follows the module, in either direction, and names its .platform.ts sibling
 * where the codemod split one off, since the code the path silenced moved
 * there. Returns the edits: { config, from, to }, with to null for a removal.
 */
export function followLintRenames(root, tracked) {
  const exists = (file) => existsSync(join(root, file))
  const modules = tracked.filter((file) => file.endsWith(".vibe"))
  const edits = []
  for (const config of lintConfigs(tracked).filter(exists)) {
    const text = readFileSync(join(root, config), "utf8")
    const dir = posix.dirname(config)
    const strings = stringsOf(text)
    const listed = (string, value) => strings.some((other) => other.list === string.list && other.value === value)
    const changes = []
    for (const string of strings) {
      const quote = text[string.start]
      const literal = (value) => quote + value + quote
      const add = (value) => changes.push({ start: string.end, end: string.end, text: ", " + literal(value) })
      const next = followed(string.value, dir, exists)
      if (next?.remove) {
        if (string.list === null) continue
        changes.push(removal(text, string))
        edits.push({ config, from: string.value, to: null })
      } else if (next) {
        changes.push({ start: string.start, end: string.end, text: literal(next.to) })
        edits.push({ config, from: string.value, to: next.to })
        if (next.also && string.list !== null && !listed(string, next.also)) {
          add(next.also)
          edits.push({ config, from: string.value, to: next.also })
        }
      } else if (string.list !== null && oxlintConfig.test(config)) {
        const glob = vibeGlob(string.value, dir, modules)
        if (glob && !listed(string, glob)) {
          add(glob)
          edits.push({ config, from: string.value, to: glob })
        }
      }
    }
    if (!changes.length) continue
    const next = changes.sort((a, b) => b.start - a.start).reduce((all, c) => all.slice(0, c.start) + c.text + all.slice(c.end), text)
    writeFileSync(join(root, config), next)
  }
  return edits
}
