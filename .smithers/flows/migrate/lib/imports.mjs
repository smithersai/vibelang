// Module specifiers in TypeScript and VibeLang source, found by pattern rather
// than a parser so that the codemod can read a .vibe file the TypeScript
// parser rejects. Each specifier carries its offsets so it can be rewritten.
import { posix } from "node:path"

const fromClause = /(?<=^|[;\n}])[ \t]*(import|export)\s+(type\s+)?((?:(?!\b(?:import|export)\b)[^'";=])*?)\s*from\s*(['"])([^'"\n]+)\4/dg
const bare = /(?<=^|[;\n}])[ \t]*import\s*(['"])([^'"\n]+)\1/dg
const dynamic = /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/dg
const mocked = /\bmock\.module\(\s*(['"])([^'"\n]+)\1/dg

// Where a string or template ends, from just after its opening quote.
const stringEnd = (text, at, quote) => {
  for (let i = at; i < text.length && text[i] !== "\n"; i++) {
    if (text[i] === "\\") i++
    else if (text[i] === quote) return i + 1
  }
  return at
}

/**
 * The ranges of text's comments. A string, template text and an unterminated
 * block comment hold none; a regular expression is read as code, so one that
 * looks like a comment hides at most the rest of its line.
 */
function commentRanges(text) {
  const ranges = []
  const holes = [] // the brace depth at each open template hole, ${
  let depth = 0
  // Returns the index after a template's closing backtick or a hole's ${.
  const template = (at) => {
    for (let i = at; i < text.length; i++) {
      if (text[i] === "\\") i++
      else if (text[i] === "`") return i + 1
      else if (text[i] === "$" && text[i + 1] === "{") {
        holes.push(depth)
        return i + 2
      }
    }
    return text.length
  }
  for (let i = 0; i < text.length;) {
    const c = text[i]
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i)
      ranges.push([i, end < 0 ? text.length : end])
      i = end < 0 ? text.length : end
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      if (end < 0) i += 2
      else {
        ranges.push([i, end + 2])
        i = end + 2
      }
    } else if (c === "'" || c === '"') i = stringEnd(text, i + 1, c)
    else if (c === "`") i = template(i + 1)
    else if (c === "}" && holes.at(-1) === depth) {
      holes.pop()
      i = template(i + 1)
    } else {
      if (c === "{") depth++
      if (c === "}") depth--
      i++
    }
  }
  return ranges
}

/**
 * Every import and re-export specifier of text, in source order. A specifier
 * in a comment is prose, such as `{@link import("./x.ts").X}`, and declaration
 * emit copies a doc comment, so it is no import.
 */
export function parseImports(text) {
  const found = []
  for (const m of text.matchAll(fromClause)) {
    const clause = m[3]
    const named = /\{([^}]*)\}/.exec(clause)
    const allTypes = named && !clause.replace(named[0], "").replace(/[\s,]/g, "") &&
      named[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))
    found.push({
      kind: m[1],
      specifier: m[5],
      typeOnly: Boolean(m[2]) || Boolean(allTypes),
      clause: clause.trim(),
      start: m.indices[5][0],
      end: m.indices[5][1]
    })
  }
  for (const m of text.matchAll(bare)) found.push({ kind: "import", specifier: m[2], typeOnly: false, clause: "", start: m.indices[2][0], end: m.indices[2][1] })
  for (const m of text.matchAll(dynamic)) found.push({ kind: "dynamic", specifier: m[2], typeOnly: false, clause: "", start: m.indices[2][0], end: m.indices[2][1] })
  for (const m of text.matchAll(mocked)) found.push({ kind: "mock", specifier: m[2], typeOnly: false, clause: "", start: m.indices[2][0], end: m.indices[2][1] })
  const comments = commentRanges(text)
  return found.filter((i) => !comments.some(([start, end]) => start <= i.start && i.start < end)).sort((a, b) => a.start - b.start)
}

/** Whether a specifier names Effect or one of its packages. */
export const isEffectSpecifier = (specifier) =>
  specifier === "effect" || specifier.startsWith("effect/") || specifier.startsWith("@effect/")

/**
 * How a file uses Effect: "values" when it imports a value from Effect,
 * "types" when every Effect import is type-only, "none" otherwise.
 */
export function effectUse(imports) {
  const effect = imports.filter((i) => isEffectSpecifier(i.specifier))
  if (!effect.length) return "none"
  return effect.some((i) => !i.typeOnly) ? "values" : "types"
}

const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".vibe"]
const jsToSource = { ".js": [".ts", ".tsx", ".vibe"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] }

/**
 * The repository-relative file a relative specifier of `from` names, given the
 * set of repository-relative files that exist, or undefined. It follows
 * TypeScript's rules for NodeNext and bundler resolution, and VibeLang's: a
 * `.js` specifier names a `.ts` or a `.vibe` source.
 */
export function resolveRelative(from, specifier, files) {
  if (!specifier.startsWith(".")) return undefined
  return resolveFile(posix.normalize(posix.join(posix.dirname(from), specifier)), files)
}

/**
 * The repository-relative file among files that target, a repository-relative
 * path as a specifier spells it, names: with its own source extension or
 * another (the module may have moved between .ts and .vibe), a JavaScript
 * extension standing for its source, or none, the file or its directory's
 * index. Or undefined.
 */
export function resolveFile(target, files) {
  const ext = posix.extname(target)
  const candidates = []
  if (sourceExtensions.includes(ext)) {
    // A source name; the module may since have moved between .ts and .vibe.
    const base = target.slice(0, -ext.length)
    candidates.push(target, ...sourceExtensions.filter((e) => e !== ext).map((e) => base + e))
  } else if (jsToSource[ext]) {
    const base = target.slice(0, -ext.length)
    candidates.push(...jsToSource[ext].map((e) => base + e), target)
  } else {
    candidates.push(...sourceExtensions.map((e) => target + e), ...sourceExtensions.map((e) => target + "/index" + e), target)
  }
  return candidates.map((candidate) => posix.normalize(candidate)).find((candidate) => files.has(candidate))
}

/**
 * The repository-relative file a `paths` alias names, `~/main` or
 * `@app/config`, as TypeScript resolves it, or undefined. paths maps each
 * pattern, with at most one `*`, to its substitutions, repository-relative
 * paths with the same `*`, as tsconfigPaths gives them: a pattern without `*`
 * that equals the specifier wins, else the matching pattern with the longest
 * prefix, and its substitutions are tried in order (TypeScript's
 * tryLoadModuleUsingPaths).
 */
export function resolveAlias(specifier, paths, files) {
  if (!paths || specifier.startsWith(".")) return undefined
  let best = paths[specifier] && !specifier.includes("*") ? { substitutions: paths[specifier], matched: "" } : undefined
  if (!best) {
    for (const [pattern, substitutions] of Object.entries(paths)) {
      const star = pattern.indexOf("*")
      if (star < 0) continue
      const prefix = pattern.slice(0, star)
      const suffix = pattern.slice(star + 1)
      if (specifier.length < prefix.length + suffix.length || !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
      if (!best || prefix.length > best.prefix.length) best = { substitutions, prefix, matched: specifier.slice(prefix.length, specifier.length - suffix.length) }
    }
  }
  if (!best) return undefined
  for (const substitution of best.substitutions) {
    // As TypeScript does, an empty match leaves the substitution as written, `*` and all.
    const found = resolveFile(posix.normalize(best.matched ? substitution.replace("*", best.matched) : substitution), files)
    if (found) return found
  }
  return undefined
}

/**
 * The file a tsconfig `paths` alias names from file, by the substitutions
 * aliases(file) gives for the importer's project ([{ pattern: "@/*",
 * targets: ["packages/app/src/*"] }], repository-relative), with
 * resolveRelative's rules for extensions and directory indexes: `@/x` and
 * `@/x.js` name packages/app/src/x.vibe. Returns { target, base }, base the
 * aliased path before those rules, or undefined.
 */
export function resolveAliased(from, specifier, files, aliases) {
  if (!aliases || specifier.startsWith(".")) return undefined
  for (const { pattern, targets } of aliases(from)) {
    const star = pattern.indexOf("*")
    let rest = ""
    if (star < 0) {
      if (specifier !== pattern) continue
    } else {
      const head = pattern.slice(0, star)
      const tail = pattern.slice(star + 1)
      if (!specifier.startsWith(head) || !specifier.endsWith(tail) || specifier.length < head.length + tail.length) continue
      rest = specifier.slice(head.length, specifier.length - tail.length)
    }
    for (const target of targets) {
      const base = posix.normalize(target.replace("*", rest))
      let relative = posix.relative(posix.dirname(from), base) || "."
      if (!relative.startsWith(".")) relative = "./" + relative
      const found = resolveRelative(from, relative + (specifier.endsWith("/") && !relative.endsWith("/") ? "/" : ""), files)
      if (found) return { target: found, base }
    }
  }
  return undefined
}

/** Replaces the specifiers at the given offsets; edits are { start, end, text }. */
export function applyEdits(text, edits) {
  let out = text
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return out
}
