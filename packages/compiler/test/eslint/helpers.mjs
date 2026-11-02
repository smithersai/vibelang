// Shared helpers for the vibelang/eslint tests.
import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

export const repo = fileURLToPath(new URL("../../../../", import.meta.url))

const skipped = new Set(["node_modules", ".cache", "dist", ".git", ".jj", "site"])

/** Returns the repository's files whose names end in one of suffixes, sorted. */
export function repositoryFiles(...suffixes) {
  const found = []
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      if (skipped.has(name)) continue
      const path = join(directory, name)
      const stat = statSync(path, { throwIfNoEntry: false })
      if (stat?.isDirectory()) walk(path)
      else if (stat?.isFile() && suffixes.some((suffix) => name.endsWith(suffix))) found.push(path)
    }
  }
  walk(repo)
  return found.sort()
}

export const relativeToRepo = (path) => relative(repo, path)

/**
 * Returns a plain copy of an ESTree value for comparison: no loc or parent,
 * regular expressions and bigints as strings, keys sorted, undefined dropped.
 */
export function plain(value) {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? `${value}n` : value
  }
  if (value instanceof RegExp) return String(value)
  if (Array.isArray(value)) return value.map(plain)
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (key === "loc" || key === "parent" || value[key] === undefined) continue
    out[key] = plain(value[key])
  }
  return out
}

/** Returns the path to the first difference between two plain values, or undefined. */
export function firstDifference(a, b, path = "$") {
  if (a === b) return undefined
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return `${path}: ${JSON.stringify(a)?.slice(0, 160)} !== ${JSON.stringify(b)?.slice(0, 160)}`
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array mismatch`
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const difference = firstDifference(a[key], b[key], `${path}.${key}${a?.type ? `<${a.type}>` : ""}`)
    if (difference) return difference
  }
  return undefined
}

// These files deliberately test syntax errors, rather than valid ESTree.
// Keep exact diagnostics and positions: blanket skips would hide new failures
// and fixtures that stopped exercising their intended error.
const expectedSyntaxErrors = {
  // The compiler case explicitly expects EK0510 (VIP-34, Spec 002).
  "typescript/vibelang/cases/fiber-unary-exponentiation-error/main.vibe": {
    message: "An unparenthesized execution expression cannot be the left operand of **. Parenthesize the try, fork, or join expression.",
    line: 5, column: 10
  },
  // lsp-smoke.mjs asserts TS1109 for this incomplete pipe while editing.
  "typescript/vibelang/lsp-fixture/src/malformed-pipe.vibe": {
    message: "Expression expected.", line: 1, column: 11
  }
}

export const expectedParseError = (file) => expectedSyntaxErrors[relativeToRepo(file)]

export function matchesParseError(expected, error) {
  return Boolean(expected && error instanceof SyntaxError && error.message === expected.message &&
    error.lineNumber === expected.line && error.column === expected.column)
}

export function matchesLintParseError(expected, message) {
  return Boolean(expected && message.fatal === true && message.ruleId === null &&
    message.message === "Parsing error: " + expected.message && message.line === expected.line && message.column === expected.column)
}
