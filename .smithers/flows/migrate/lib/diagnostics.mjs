// The compiler's diagnostics, read from `vibelang --pretty false` output:
//   src/a.vibe(8,60): error EK1002: Effect.gen expects a JavaScript generator, ...
//     Write the body as an ordinary function: ...
// Indented lines after a diagnostic are its notes.
import { isAbsolute, join, relative } from "node:path"
import { quote, run } from "./util.mjs"

const head = /^(.+?)\((\d+),(\d+)\): (error|warning|message|suggestion) ([A-Z]+\d+): (.*)$/
const global = /^(error|warning) ([A-Z]+\d+): (.*)$/

/** Parses diagnostics; file paths become relative to root when cwd is given. */
export function parseDiagnostics(output, { cwd, root } = {}) {
  const out = []
  for (const line of output.split(/\r?\n/)) {
    const m = head.exec(line)
    if (m) {
      let file = m[1]
      if (cwd && root) file = relative(root, isAbsolute(file) ? file : join(cwd, file)).replaceAll("\\", "/")
      out.push({ file, line: Number(m[2]), column: Number(m[3]), category: m[4], code: m[5], message: m[6], notes: [] })
      continue
    }
    const g = global.exec(line)
    if (g) {
      out.push({ file: null, line: 0, column: 0, category: g[1], code: g[2], message: g[3], notes: [] })
      continue
    }
    if (out.length && /^\s+\S/.test(line)) out[out.length - 1].notes.push(line.trim())
  }
  return out
}

// How a Go program's crash starts a line.
const crashLine = /^(?:panic: |fatal error: |SIG[A-Z]+: |goroutine \d+ \[)/m

/**
 * Throws when a compiler run died rather than finished. A run that reports
 * errors exits nonzero too, so only the output tells them apart: a Go crash, a
 * signal, or a failing exit with no diagnostic to read. Read as a clean run,
 * any of these reports no errors.
 */
export function assertFinished(result, log) {
  const output = result.stdout + result.stderr
  const crash = crashLine.exec(output)
  if (!crash && !result.signal && !result.timedOut && (result.code === 0 || parseDiagnostics(output).length)) return
  const tail = crash ? output.slice(crash.index) : output
  // A timeout keeps its own words: callers such as onepass match "timed out" or "exit 124".
  const ended = result.timedOut ? `timed out, exit ${result.code}` : result.signal ? `killed by ${result.signal}` : `exit ${result.code}`
  throw new Error(`the compiler did not finish (${ended}${log ? `, log ${log}` : ""}):\n${tail.trim().split("\n").slice(0, 8).join("\n")}`)
}

/** Counts by code, and the diagnostics of the given files apart from the rest. */
export function summarize(diagnostics, files = []) {
  const inFiles = new Set(files)
  const count = (list) => {
    const byCode = {}
    for (const d of list) byCode[d.code] = (byCode[d.code] ?? 0) + 1
    return byCode
  }
  const batch = diagnostics.filter((d) => inFiles.has(d.file))
  const other = diagnostics.filter((d) => !inFiles.has(d.file))
  return {
    errors: diagnostics.filter((d) => d.category === "error").length,
    warnings: diagnostics.filter((d) => d.category === "warning").length,
    batch: { errors: batch.filter((d) => d.category === "error").length, warnings: batch.filter((d) => d.category === "warning").length, byCode: count(batch) },
    other: { errors: other.filter((d) => d.category === "error").length, byCode: count(other) }
  }
}

/**
 * The style gate follows severity, including user-configured Effect severity.
 * Warnings never return a module to TypeScript. Errors still block, even when
 * their note says no safe fix exists; settle/verify also check all own errors.
 */
export function styleProblems(diagnostics, files) {
  const inFiles = new Set(files)
  return diagnostics.filter((d) => inFiles.has(d.file) && d.category === "error" &&
    (/^EK48\d\d$/.test(d.code) || d.code === "EK4402" || d.code === "EK9204"))
}

/**
 * Module provenance for the warnings a module keeps. No diagnostic code
 * allow-list: imported Effect and future warning codes have the same contract.
 * See README.md, "Warning exceptions", for the persisted record shape.
 */
export function warningExceptions(diagnostics, files) {
  const inFiles = new Set(files), records = new Map()
  for (const d of diagnostics) {
    if (d.category !== "warning" || !inFiles.has(d.file)) continue
    const reasons = (d.notes ?? []).filter(note => /no quick fix/i.test(note))
    const reason = [...new Set(reasons)].sort().join("\n")
    const record = {
      name: reason ? "warning-fix-refused" : "warning-retained",
      category: "warning", code: d.code, file: d.file, line: d.line, column: d.column,
      message: d.message,
      reason: reason || "Warning remains after the safe-fix pass; no refusal reason was reported."
    }
    records.set(JSON.stringify(record), record)
  }
  // Plain string comparison is independent of the host's locale.
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
  return [...records.values()].sort((a, b) => compare(a.file, b.file) ||
    a.line - b.line || a.column - b.column || compare(a.code, b.code) ||
    compare(a.name, b.name) || compare(a.reason, b.reason) || compare(a.message, b.message))
}

/** Errors that the baseline did not have, compared by file, code and message. */
export function newErrors(baseline, current) {
  // A file keeps its identity across the rename to .vibe.
  const key = (d) => `${(d.file ?? "").replace(/\.(?:ts|mts|vibe)$/, "")}\0${d.code}\0${d.message}`
  const seen = new Map()
  for (const d of baseline.filter((d) => d.category === "error")) seen.set(key(d), (seen.get(key(d)) ?? 0) + 1)
  const added = []
  for (const d of current.filter((d) => d.category === "error")) {
    const n = seen.get(key(d)) ?? 0
    if (n > 0) seen.set(key(d), n - 1)
    else added.push(d)
  }
  return added
}

/** Checks a project with vibelang and parses what it reports. */
export async function check({ compiler, tsconfig, cwd, root, log }) {
  const result = await run(`${quote(compiler)} -p ${quote(tsconfig)} --singleThreaded --noEmit --pretty false`, { cwd, log })
  assertFinished(result, log)
  return { code: result.code, diagnostics: parseDiagnostics(result.stdout + result.stderr, { cwd, root }) }
}
