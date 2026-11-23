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
  // A stale golden: string!Timeout | Refused has needed parentheses since EK0121.
  ".smithers/flows/convert/golden/18-catch-all/expected.vibe": {
    message: "! beside a union, an intersection, a function type or a conditional type without parentheses. Parenthesize the intended type before combining ! with another type operator.",
    line: 4, column: 26
  },
  // estree_warning_severity_test.go reads this file for its throw-comma error.
  "typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-crypto-throw-comma.vibe": {
    message: "A throw expression can't be followed by ,: write throw (…) to throw the whole expression, or (throw badArgument()) to throw only badArgument().",
    line: 1, column: 110
  },
  // throw_comma_typecheck_test.go reads this file for its throw-comma error.
  "typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-throw-comma-independent-error.vibe": {
    message: "A throw expression can't be followed by ,: write throw (…) to throw the whole expression, or (throw 2) to throw only 2.",
    line: 2, column: 43
  },
  // The file states that VIP-17 requires EK1702 for a binding named fork.
  "typescript/tsc/internal/vibelangfuzz/testdata/soft-keywords/opencode-local-fork-binding.vibe": {
    message: "fork and join are reserved in effect code, including an effect expression's own name. Use another binding or label name, and rename its uses.",
    line: 4, column: 9
  },
  // Syntax from before VIP-1, kept as the mapper's input.
  "typescript/tsc/internal/vibelangmapper/testdata/pre-vip1/catch-expression/main.vibe": {
    message: "! beside a union, an intersection, a function type or a conditional type without parentheses. Parenthesize the intended type before combining ! with another type operator.",
    line: 6, column: 35
  },
  // The case's pending file records TS1005 and TS1109.
  "typescript/vibelang/cases/cov-ch900a-nonnull-after-effect/main.vibe": {
    message: "';' expected.",
    line: 2, column: 49
  },
  // The case's pending file records EK0204.
  "typescript/vibelang/cases/cov2-002b-parameter-return-generators/main.vibe": {
    message: "return cannot leave this do expression: VibeLang still compiles a do expression in this position to a function. Move the do expression into a statement of its own.",
    line: 3, column: 55
  },
  // The case's pending file records EK0204.
  "typescript/vibelang/cases/coverage-ch001-generator-defaults/main.vibe": {
    message: "return cannot leave this do expression: VibeLang still compiles a do expression in this position to a function. Move the do expression into a statement of its own.",
    line: 2, column: 37
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
