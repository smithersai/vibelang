// Module specifiers in TypeScript and VibeLang source, found by pattern rather
// than a parser so that the codemod can read a .vibe file the TypeScript
// parser rejects. Each specifier carries its offsets so it can be rewritten.
import { posix } from "node:path"

const fromClause = /(?<=^|[;\n}])[ \t]*(import|export)\s+(type\s+)?((?:(?!\b(?:import|export)\b)[^'";=])*?)\s*from\s*(['"])([^'"\n]+)\4/dg
const bare = /(?<=^|[;\n}])[ \t]*import\s*(['"])([^'"\n]+)\1/dg
const dynamic = /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/dg
const mocked = /\bmock\.module\(\s*(['"])([^'"\n]+)\1/dg

/** Every import and re-export specifier of text, in source order. */
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
  return found.sort((a, b) => a.start - b.start)
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
  const target = posix.normalize(posix.join(posix.dirname(from), specifier))
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
  return candidates.find((candidate) => files.has(candidate))
}

/** Replaces the specifiers at the given offsets; edits are { start, end, text }. */
export function applyEdits(text, edits) {
  let out = text
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return out
}
