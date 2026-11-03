// A source-evidence inventory, not a claim that the linked tests pass or prove a rule.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import ts from "typescript"
import * as portable from "./spec-normative"
import { vipRegistryFromSources } from "./spec-rules.mjs"

export type Sources = Map<string, string>
export type Rule = portable.Sentence & { id: string; chapter: string }
export type Status = "passing" | "pending" | "none"
export type Evidence = { status?: Status; test: string; kind: string; low: boolean; reason: string }
export type Row = Rule & { evidence: Evidence[] }
const root = resolve(import.meta.dir, "../..")
const gatePath = join(import.meta.dir, "rule-evidence.ts")
const detector = existsSync(gatePath) ? await import(gatePath) : portable
export const detectorName = existsSync(gatePath) ? "rule-evidence.ts" : "spec-normative.ts (gate dd4ff590c915 API)"
export const normalize = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim()
const digest = (s: string) => createHash("sha256").update(s).digest("hex")

export function rules(sources: Sources): Rule[] {
  const found = new Map<string, Rule>()
  const accepted = new Set([...vipRegistryFromSources(sources).values()].filter(v => v.status === "accepted").map(v => v.path))
  for (const [path, text] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^docs\/design\/(?:src|vips)\/.*\.md$/.test(path)) continue
    if (path.includes("/vips/") && !accepted.has(path)) continue
    for (const sentence of detector.sentences(path, text).filter(s => detector.normative(s.text))) {
      const id = path + "#" + digest(normalize(sentence.text)).slice(0, 16)
      if (!found.has(id)) found.set(id, { ...sentence, id, chapter: path })
    }
  }
  return [...found.values()]
}

// jj file show's metadata template frames each text file without diffing against root.
export function parseSnapshot(stream: string): Sources {
  const parts = stream.split("\0"), files: Sources = new Map()
  if (parts[0] !== "" || parts.length % 2 !== 1) throw new Error("Malformed framed jj snapshot")
  for (let i = 1; i < parts.length; i += 2) {
    if (!parts[i] || files.has(parts[i])) throw new Error("Missing or duplicate snapshot path")
    files.set(parts[i], parts[i + 1])
  }
  return files
}
function jj(args: string[]): string {
  const r = spawnSync("jj", ["--ignore-working-copy", ...args], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error("jj " + args[0] + ": " + r.stderr)
  return r.stdout
}
export function snapshot(revision: string) {
  const id = jj(["log", "-r", revision, "--no-graph", "-T", 'commit_id ++ "\n"']).trim()
  if (!/^[a-f0-9]{40,64}$/.test(id)) throw new Error("Expected exactly one revision")
  const sources = parseSnapshot(jj(["file", "show", "-r", id, "-T", '"\\0" ++ path ++ "\\0"', "--",
    "glob:docs/design/src/**/*.md", "glob:docs/design/vips/**/*.md",
    ...["vibe", "vibex", "ts", "tsx", "mjs", "txt"].map(ext => "glob:typescript/vibelang/cases/**/*." + ext),
    "glob:typescript/vibelang/cases/**/pending",
    "glob:typescript/tsc/internal/**/*_test.go", "glob:docs/tools/**/*.test.ts", "glob:docs/tools/**/*.test.mjs",
    ...["ts", "tsx", "mjs", "js"].map(ext => "glob:packages/**/*.test." + ext)]))

  return { id, sources }
}


// Split runnable declarations so a pending declaration cannot cover a passing sibling.
// The scanner ignores braces in strings and comments (including Go raw strings).
function blockEnd(text: string, start: number) {
  let depth = 0, quote = "", comment = ""
  for (let i = start; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (comment === "//") { if (c === "\n") comment = ""; continue }
    if (comment === "/*") { if (c === "*" && next === "/") { comment = ""; i++ }; continue }
    if (quote) {
      if (c === "\\" && quote !== "`") { i++; continue }
      if (c === quote) quote = ""
      continue
    }
    if (c === "/" && (next === "/" || next === "*")) { comment = c + next; i++; continue }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue }
    if (c === "{") depth++
    if (c === "}" && --depth === 0) return i + 1
  }
  return text.length
}
const plain = (text: string) => normalize(text).replace(/[`"'*_]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
function tags(text: string) {
  return [...text.matchAll(/^\s*(?:\/\/|\*)\s*(?:rule-evidence:\s*)?(Chapter\s*0*\d+|VIP-0*\d+)(?:\s*[:;,—-]\s*|\s+)(.+)$/gim)]
    .map(m => ({ key: m[1].toLowerCase().replace(/\s+/g, "").replace(/0+(\d)/, "$1"),
      name: plain(m[2].split(/[.;]/)[0]) }))
    .filter(t => t.name.length >= 4)
}
function ruleKey(rule: Rule) {
  const vip = /\/vips\/0*(\d+)-/.exec(rule.path)
  const chapter = /(?:ch|\/src\/0*)(\d+)-/.exec(rule.path)
  return vip ? "vip-" + Number(vip[1]) : chapter ? "chapter" + Number(chapter[1]) : ""
}
export function evidenceFiles(sources: Sources) {
  const pending = [...sources.keys()].filter(path => /^typescript\/vibelang\/cases\/[^/]+\/pending$/.test(path)).map(path => path.slice(0, -"pending".length))
  const units: { path: string; text: string; status: Status }[] = []
  for (const [path, text] of sources) {
    if (/\/(?:expected|out|node_modules|testdata)\//.test(path) || path === "docs/tools/coverage-census.test.ts") continue
    if (/^typescript\/vibelang\/cases\/[^/]+\//.test(path)) {
      if ((/\.(?:vibe|vibex|ts|tsx|mjs|json|txt)$/.test(path) && !/\/(?:package|tsconfig)\.json$/.test(path)) || path.endsWith("/pending"))
        units.push({ path, text, status: pending.some(dir => path.startsWith(dir)) ? "pending" : "passing" })
    } else if (/^typescript\/tsc\/internal\/.*_test\.go$/.test(path)) {
      if (!/\/vibelang[^/]*\//.test(path) && !/VIP-\d|Chapter\s+\d|rule-evidence:|docs\/design/.test(text)) continue
      const functions = [...text.matchAll(/^func (?:Test|Fuzz)\w+\([^\n]*\{/gm)]
      // Constants and file-level citations are shared by the declarations.
      const header = text.slice(0, functions[0]?.index ?? 0)
      for (const f of functions) {
        const end = blockEnd(text, f.index! + f[0].lastIndexOf("{"))
        const prefix = text.slice(Math.max(0, f.index! - 4096), f.index)
        const before = prefix.match(/(?:^|\n)((?:[ \t]*\/\/[^\n]*\n)+)[ \t]*$/)?.[1] ?? ""
        const body = before + text.slice(f.index, end)
        const skips = [...body.matchAll(/\bt\.Skip(?:f)?\(([^\n]*)/g)].map(m => m[1])
        units.push({ path: path + ":" + (text.slice(0, f.index).split("\n").length), text: header + "\n" + body,
          status: skips.length ? "pending" : "passing" })
      }
    } else if (/^(?:docs\/tools|packages)\/.*\.test\.(?:ts|tsx|mjs|js)$/.test(path)) {
      const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
      const calls: ts.CallExpression[] = []
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && /^(?:test|it)(?:\.(?:todo|skip|only))?$/.test(node.expression.getText(ast))) calls.push(node)
        ts.forEachChild(node, visit)
      }
      visit(ast)
      const header = text.slice(0, calls[0]?.getFullStart() ?? 0)
      for (const call of calls) {
        const kind = call.expression.getText(ast)
        units.push({ path: path + ":" + text.slice(0, call.getStart(ast)).split("\n").length,
          text: header + "\n" + call.getFullText(ast), status: /\.(?:todo|skip)$/.test(kind) ? "pending" : "passing" })
      }
    }
  }
  return units.map(unit => {
    const strings = [...unit.text.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g)].map(m => {
      if (m[0][0] === '"') { try { return JSON.parse(m[0]) } catch {} }
      return m[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\(["'\\])/g, "$1")
    })
    return { ...unit, ids: new Set(unit.text.match(/docs\/design\/(?:src|vips)\/[^\s"\x27\x60#]+\.md#[a-f0-9]{16}\b/g) ?? []), quotes: strings.filter(s => typeof s === "string").map(normalize), body: normalize(unit.text), tags: tags(unit.text) }
  })
}

export async function census(sources: Sources, compileTwin?: (pair: unknown) => Promise<{ ok: boolean; reason: string }>, excluded: Set<string> = new Set()): Promise<Row[]> {
  const tests = evidenceFiles(sources), rows: Row[] = []
  if (import.meta.main) console.error("coverage-census: indexed " + tests.length + " test declarations")
  const index = new Map<string, Set<number>>()
  tests.forEach((test, i) => {
    for (const word of new Set((test.body + " " + test.quotes.join(" ") + " " + test.path).match(/[A-Za-z_$][\w$]*/g) ?? [])) {
      const entries = index.get(word) ?? new Set<number>()
      entries.add(i); index.set(word, entries)
    }
  })
  const candidates = (text: string) => {
    const words = text.match(/[A-Za-z_$][\w$]*/g) ?? []
    const rarest = words.map(word => index.get(word) ?? new Set<number>()).sort((a, b) => a.size - b.size)[0]
    return rarest ?? new Set(tests.map((_, i) => i))
  }
  const tagged = tests.flatMap((test, i) => test.tags.length ? [i] : [])
  const formCache = new Map<string, number[]>()
  const compiled = new Map<string, { ok: boolean; reason: string }>()
  for (const rule of rules(sources)) {
    if (excluded.has(rule.id)) continue
    const evidence: Evidence[] = [], quote = normalize(rule.text)
    const codes = [...rule.text.matchAll(/\b(?:EK|TS)\d{4,}\b/g)].map(m => m[0])
    const forms = [...rule.text.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(s => s.length >= 8 && /[.()!]|\s/.test(s))
    const exactPossible = candidates(quote)
    const possible = new Set([...exactPossible, ...candidates(rule.id), ...tagged.filter(i => tests[i].tags.some(t => t.key === ruleKey(rule))),
      ...codes.flatMap(code => [...(index.get(code) ?? []), ...(index.get(code.toLowerCase()) ?? [])]), ...forms.flatMap(form => {
        if (!formCache.has(form)) formCache.set(form, [...candidates(form)].filter(i => tests[i].body.includes(form)))
        return formCache.get(form)!
      })])
    for (const i of possible) {
      const test = tests[i]
      const exact = exactPossible.has(i) && quote.length >= 24 && (test.quotes.some(q => q === quote || q.includes(quote)) || test.body.includes(quote))
      const explicit = test.ids.has(rule.id)
      const tag = test.tags.find(t => t.key === ruleKey(rule) && ((" " + plain(rule.text) + " ").includes(" " + t.name + " ") || (" " + plain(rule.section) + " ").includes(" " + t.name + " ")))
      if (tag) evidence.push({ test: test.path, status: test.status, kind: "tag-linked", low: false, reason: "chapter/VIP and short rule name: " + tag.name })
      if (exact || explicit) evidence.push({ test: test.path, status: test.status, kind: /\.go(?::\d+)?$/.test(test.path) ? "fuzz-quote" : "test-quote",
        low: false, reason: exact ? "exact normalized sentence" : "explicit stable rule id" })
      else if (!tag && codes.some(code => new RegExp("\\b" + code + "\\b", "i").test(test.text + " " + test.path)))
        evidence.push({ test: test.path, kind: "shared-code", low: true, reason: "shared diagnostic code; does not establish this sentence" })
      else if (!tag && /^typescript\/vibelang\/cases\//.test(test.path)) {
        if (forms.some(s => test.body.includes(s)))
          evidence.push({ test: test.path, kind: "shared-form", low: true, reason: "shared literal code only; adequacy unverified" })
      }
    }
    if ("nearbyTwins" in detector) {
      for (const pair of detector.nearbyTwins(rule, sources.get(rule.path)!)) {
        const key = digest(JSON.stringify(pair))
        const result = compiled.get(key) ?? (compileTwin ? await compileTwin(pair) : { ok: false, reason: "adjacent complete twin; not compiled" })
        compiled.set(key, result)
        evidence.push({ test: rule.path + ":" + pair.vibe.line + "+" + pair.effect.line,
          status: result.ok ? "passing" : "none", kind: result.ok ? "compiled-twin" : compileTwin ? "failed-twin" : "uncompiled-twin", low: !result.ok, reason: result.reason })
      }
    }
    rows.push({ ...rule, evidence })
    if (import.meta.main && rows.length % 500 === 0) console.error("coverage-census: matched " + rows.length + " rules")
  }
  return rows
}

export function status(row: Row): Status {
  const strong = row.evidence.filter(e => !e.low)
  return strong.some(e => e.status !== "pending") ? "passing" : strong.length ? "pending" : "none"
}
export function totals(rows: Row[]) {
  const passing = rows.filter(r => status(r) === "passing").length
  const pending = rows.filter(r => status(r) === "pending").length
  const covered = passing + pending
  const tagLinked = rows.filter(r => r.evidence.some(e => !e.low && e.kind === "tag-linked")).length
  return { rules: rows.length, passing, pending, none: rows.length - covered, covered, tagLinked,
    percent: rows.length ? (100 * covered / rows.length).toFixed(2) : "0.00" }
}
const csv = (value: unknown) => '"' + String(value).replace(/"/g, '""') + '"'
const md = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ")
export function reports(rows: Row[], revision: string, twinMode: string, excluded = 0) {
  const t = totals(rows)
  const percent = "passing " + t.passing + ", pending " + t.pending + ", no test " + t.none + " of " + t.rules + " rules (excluded " + excluded + ")\n"
  const lines = ["# Specification test coverage census", "", "**" + percent.trim() + " · Coverage: " + t.percent + "% · tag-linked: " + t.tagLinked + "**", "",
    "Revision: `" + revision + "`. Detector: `" + detectorName + "`. Twin mode: " + twinMode + ".", "",
    "Passing and pending are source classifications, not fresh execution results. Passing takes precedence over pending. Pending includes harness pending markers, Go tests containing t.Skip, and test.todo/test.skip declarations. Exact sentence quotes, stable rule ids, chapter/VIP comments with a matching short rule name, and successfully compiled twins count. Tag-linked rules are reported separately. Shared codes/forms remain low confidence and count as no test. Exclusions come from not-rules/*.csv and are removed from the denominator. One normalized sentence per file is one rule. Accepted VIPs require explicit accepted status. The shared detector excludes fences, headings and generated pages; this syntactic census cannot prove semantic adequacy.", "",
    "CSV contains every evidence path and both rule status and evidence status. Chapter/VIP tags require a matching phrase in the sentence or section; a chapter alone does not cover every rule.", ""]
  const records: unknown[][] = [["rule", "test", "missing", "status", "chapter", "line", "sentence", "low_confidence", "kind", "reason", "test_status"]]
  let chapter = ""
  for (const row of rows) {
    const strong = row.evidence.filter(e => !e.low), low = row.evidence.filter(e => e.low), state = status(row)
    if (chapter !== row.chapter) {
      chapter = row.chapter
      const ct = totals(rows.filter(r => r.chapter === chapter))
      lines.push("## " + chapter, "", "Passing " + ct.passing + ", pending " + ct.pending + ", no test " + ct.none + " of " + ct.rules + "; tag-linked " + ct.tagLinked, "",
        "| Rule / line | Sentence | Test | Status | Low confidence |", "| --- | --- | --- | --- | --- |")
    }
    lines.push("| `" + row.id + "` / " + row.line + " | " + md(row.text) + " | " + md(strong.slice(0, 3).map(e => e.test).join("; ")) + " | " + state + " | " + md(low.slice(0, 3).map(e => e.test).join("; ")) + " |")
    for (const e of row.evidence.length ? row.evidence : [{ test: "", low: false, kind: "", reason: "no deterministic evidence", status: "none" }])
      records.push([row.id, e.test, state === "none" ? "yes" : "", state, row.chapter, row.line, row.text, e.low ? "yes" : "", e.kind, e.reason, e.status ?? "none"])
  }
  return { markdown: lines.join("\n") + "\n", csv: records.map(r => r.map(csv).join(",")).join("\n") + "\n", percent }
}
// Read RFC-4180 fields, including quoted reasons with commas and newlines.
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++ } else quoted = !quoted
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, "")); field = ""
      if (c === "\n") { rows.push(row); row = [] }
    } else field += c
  }
  if (quoted) throw new Error("Unclosed CSV quote")
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row) }
  return rows
}
export function exclusions(dir: string): Set<string> {
  const ids = new Set<string>()
  if (!existsSync(dir)) return ids
  for (const file of readdirSync(dir).filter(f => f.endsWith(".csv")).sort()) {
    const [header, ...rows] = parseCSV(readFileSync(join(dir, file), "utf8"))
    const column = header?.indexOf("rule") ?? -1
    if (column < 0) throw new Error("Exclusion CSV needs rule column: " + file)
    for (const row of rows) if (row[column]?.trim()) ids.add(row[column].trim())
  }
  return ids
}

export function writeReports(out: string, result: ReturnType<typeof reports>) {
  mkdirSync(out, { recursive: true })
  // Publish PERCENT last, as the receipt that the two inventories completed.
  for (const [name, content] of [["CENSUS.md", result.markdown], ["CENSUS.csv", result.csv], ["PERCENT", result.percent]]) {
    writeFileSync(join(out, name + ".tmp"), content); renameSync(join(out, name + ".tmp"), join(out, name))
  }
}
async function main() {
  const args = process.argv.slice(2), value = (name: string, fallback: string) => {
    const at = args.indexOf(name)
    if (at < 0) return fallback
    if (!args[at + 1] || args[at + 1].startsWith("--")) throw new Error(name + " needs a value")
    const result = args[at + 1]; args.splice(at, 2); return result
  }
  const revision = value("--revision", "main@github")
  const out = resolve(value("--out", join(homedir(), "vibe/review-spec/coverage")))
  const excludeDir = resolve(value("--not-rules", join(out, "not-rules")))
  const twins = args.includes("--compile-twins")
  if (twins) args.splice(args.indexOf("--compile-twins"), 1)
  if (args.length) throw new Error("Unknown options: " + args.join(" "))
  const started = performance.now()
  console.error("coverage-census: reading immutable snapshot " + revision)
  const { id, sources } = snapshot(revision)
  console.error("coverage-census: snapshot " + id + ", " + sources.size + " files; matching evidence")
  if (![...sources.keys()].some(p => p.startsWith("docs/design/src/"))) throw new Error("Snapshot has no spec chapters")
  // The shared linter registry consumes the snapshot, never the mutable workspace.
  if (twins && !("compileTwin" in detector)) throw new Error("Compiled twins require landed gate-rule-evidence dd4ff590c915")
  const excluded = exclusions(excludeDir)
  const excludedCount = rules(sources).filter(rule => excluded.has(rule.id)).length
  const rows = await census(sources, twins ? detector.compileTwin : undefined, excluded)
  writeReports(out, reports(rows, id, twins ? "compiled" : "not compiled; candidates listed, no twins counted", excludedCount))
  console.error("coverage-census: complete in " + ((performance.now() - started) / 1000).toFixed(1) + "s")
  writeFileSync(join(out, "REVISION"), id + "\n")
  console.log(reports(rows, id, twins ? "compiled" : "not compiled", excludedCount).percent.trim() + " -> " + out)
}
if (import.meta.main) main().catch(error => { console.error(String(error)); process.exitCode = 2 })
