import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export const ROOT = process.cwd()

export const GO_PACKAGES = [
  "typescript/tsc/internal/vibelang",
  "typescript/tsc/internal/vibelangestree",
  "typescript/tsc/internal/vibelangfmt",
  "typescript/tsc/internal/vibelangfuzz",
  "typescript/tsc/internal/vibelangmapper",
  "typescript/tsc/internal/vibelangprotocol"
] as const

export const NPM_PACKAGES = [
  "packages/compiler",
  "packages/create-vibelang",
  "packages/runtime",
  "packages/ts-mapper",
  "packages/typescript-shim",
  "packages/unplugin",
  "packages/vite"
] as const

export function metricsPath(): string {
  const path = process.env.UPHILL_METRICS
  if (!path) throw new Error("UPHILL_METRICS environment variable is not set")
  return path
}

export function quote(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")
  return `"${escaped}"`
}

export function emit(
  metric: string,
  value: string | number,
  opts?: { item?: string; target?: string | number; note?: string }
): void {
  const parts = [metric]
  if (opts?.item !== undefined) parts.push(quote(opts.item))
  parts.push(String(value))
  if (opts?.target !== undefined) parts.push("target", String(opts.target))
  if (opts?.note !== undefined) parts.push("note", quote(opts.note))
  appendFileSync(metricsPath(), `${parts.join(" ")}\n`)
}

export function walkFiles(dir: string, exts: string | string[]): string[] {
  const extList = Array.isArray(exts) ? exts : [exts]
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name.startsWith(".") ||
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "native" ||
      entry.name === "testdata"
    ) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, extList))
    } else if (extList.some((ext) => entry.name.endsWith(ext))) {
      out.push(relative(ROOT, full))
    }
  }
  return out.sort()
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)}MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)}kB`
  return `${bytes}B`
}

export function fileBytes(relPath: string): number {
  return statSync(join(ROOT, relPath)).size
}

export interface GoFnSpan {
  file: string
  name: string
  startLine: number
  lines: number
}

export function stripGoLine(line: string): string {
  let out = ""
  let inDouble = false
  let inBacktick = false
  let inRune = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const next = line[i + 1]
    if (!inDouble && !inBacktick && !inRune && ch === "/" && next === "/") break
    if (!inBacktick && !inRune && ch === '"' && line[i - 1] !== "\\") {
      inDouble = !inDouble
      out += " "
      continue
    }
    if (!inDouble && !inRune && ch === "`") {
      inBacktick = !inBacktick
      out += " "
      continue
    }
    if (!inDouble && !inBacktick && ch === "'" && line[i - 1] !== "\\") {
      inRune = !inRune
      out += " "
      continue
    }
    out += inDouble || inBacktick || inRune ? " " : ch
  }
  return out
}

export function analyzeGoFile(relPath: string): {
  lines: number
  bytes: number
  longestFn: GoFnSpan
  exportedDecls: number
  documentedExportedDecls: number
  panicHit?: { line: number }
  todoHit?: { line: number }
  testFuncs: number
  fuzzFuncs: number
} {
  const full = join(ROOT, relPath)
  const raw = readFileSync(full, "utf8")
  const bytes = statSync(full).size
  const lines = raw.split(/\r?\n/)

  let longestFn: GoFnSpan = { file: relPath, name: "none", startLine: 1, lines: 1 }
  let exportedDecls = 0
  let documentedExportedDecls = 0
  let panicHit: { line: number } | undefined
  let todoHit: { line: number } | undefined
  let testFuncs = 0
  let fuzzFuncs = 0

  let inFn: { name: string; startLine: number } | null = null
  let depth = 0
  let inBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const text = lines[i]
    const trimmed = text.trim()

    if (!todoHit && /\b(TODO|FIXME|XXX|HACK)\b/.test(text)) {
      todoHit = { line: lineNo }
    }

    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false
      continue
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true
      continue
    }

    const stripped = stripGoLine(text)

    if (/^func\s+Test[A-Z0-9_]/.test(trimmed)) testFuncs++
    if (/^func\s+Fuzz[A-Z0-9_]/.test(trimmed)) fuzzFuncs++

    if (depth === 0) {
      const expMatch = trimmed.match(/^(?:func\s+(?:\([^)]*\)\s*)?|type\s+)([A-Z][A-Za-z0-9_]*)\b/)
      if (expMatch) {
        exportedDecls++
        let k = i - 1
        while (k >= 0 && lines[k].trim() === "") k--
        if (k >= 0 && (lines[k].trim().startsWith("//") || lines[k].trim().endsWith("*/"))) {
          documentedExportedDecls++
        }
      }

      const fnMatch = stripped.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(/)
      if (fnMatch) {
        inFn = { name: fnMatch[1], startLine: lineNo }
      }
    }

    if (!panicHit && /\bpanic\s*\(/.test(stripped)) {
      panicHit = { line: lineNo }
    }

    for (const ch of stripped) {
      if (ch === "{") depth++
      else if (ch === "}") {
        depth = Math.max(0, depth - 1)
        if (depth === 0 && inFn) {
          const span = lineNo - inFn.startLine + 1
          if (span > longestFn.lines) {
            longestFn = { file: relPath, name: inFn.name, startLine: inFn.startLine, lines: span }
          }
          inFn = null
        }
      }
    }
  }

  return {
    lines: lines.length,
    bytes,
    longestFn,
    exportedDecls,
    documentedExportedDecls,
    panicHit,
    todoHit,
    testFuncs,
    fuzzFuncs
  }
}
