// VIP fences are compiler inputs. Schematic examples remain visible warnings;
// they never excuse a removed catch-handler spelling (r7 ASTRA-4).
import ts from "typescript"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { issue, read, repository, vipRegistry } from "./spec-rules.mjs"

export function expectations(source) {
  return source.split("\n").flatMap((line, index) => {
    const marker = /\/\/\s*expect-error:\s*((?:(?:EK|TS)\d+[ ,]*)+)/.exec(line)
    return marker ? [{ line: line.slice(0, marker.index).trim() ? index + 1 : undefined, codes: marker[1].match(/(?:EK|TS)\d+/g) }] : []
  })
}
export function examples(text) {
  return [...text.matchAll(/^(`{3,}|~{3,})(ts(?: effect)?|typescript|vibe(?: es)?|vibex|tsx)\s*\n([\s\S]*?)^\1\s*$/gm)].map((m, i) => ({
    number: i + 1, offset: m.index, source: m[3],
    language: /^(?:ts effect|tsx)$/.test(m[2]) ? (m[2] === "tsx" ? "tsx" : "ts") : m[2] === "typescript" ? "ts" : m[2] === "vibex" ? "vibex" : "vibe",
    expected: expectations(m[3]).flatMap(x => x.codes),
    expectations: expectations(m[3]),
    fragment: /\/\/\s*fragment(?:\s*:|\s*$)/m.test(m[3]),
    gap: m[3].match(/\/\/\s*compiler-gap:\s*([^\n]+)/)?.[1],
    schematic: /…|\b(?:function|class)\s+\w+[^\n]*\{\s*\.\.\./.test(m[3])
  }))
}
export function diagnostics(output) {
  const located = [...output.matchAll(/^(.*?)\((\d+),(\d+)\): (error|warning) ((?:EK|TS)\d+): (.*)$/gm)]
    .map(m => ({ file: m[1], line: +m[2], category: m[4], code: m[5], message: m[6] }))
  return [...located, ...[...output.matchAll(/^error ((?:TS|EK)\d+): (.*)$/gm)].map(m => ({ file: "<config>", line: 1, code: m[1], message: m[2] }))]
}
// The public function-literal rule is stricter than pre-flip compilers. Keep
// its syntax check active even when another error prevents semantic checking.
export function removedHandlers(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  const tokens = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
    tokens.push({ kind: token, text: scanner.getTokenText() })
  const found = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== ts.SyntaxKind.CatchKeyword || [".", "?."].includes(tokens[i - 1]?.text)) continue
    const next = tokens[i + 1]
    if (next?.kind !== ts.SyntaxKind.Identifier || next.text === "effect" || tokens[i + 2]?.text === "=>") continue
    found.push({ severity: "error", message: "EK0509: catch requires a function literal (VIP-5); removed value handler" })
  }
  return found
}
export function verdict(example, result) {
  if (result.error || result.signal || result.status === null) throw new Error("VIP compiler failed: " + (result.error?.message ?? result.signal))
  const output = (result.stdout ?? "") + (result.stderr ?? ""), rows = diagnostics(output)
  if (result.status && !rows.length) throw new Error("VIP compiler failed without source diagnostics: " + output.slice(0, 1000))
  const codes = new Set(rows.map(x => x.code)), findings = removedHandlers(example.source).filter(f => !example.expected.includes("EK0509"))
  for (const code of example.expected) {
    const sites = example.expectations?.filter(x => x.codes.includes(code)) ?? []
    const matched = sites.length ? sites.every(site => rows.some(d => d.code === code && (site.line === undefined || d.line === site.line))) : codes.has(code)
    if (!matched) findings.push({ severity: "error", message: "expected " + code + " was not reported" + (sites.some(x => x.line !== undefined) ? " at its marked line" : "") })
  }
  const mixedComparison = /\/\/.*(?:exactly.*Effect TS|Effect TS)/i.test(example.source) && example.language === "vibe"
  const missingFixture = rows.some(d => /^(?:TS2304|TS2307|TS2552|TS18004|TS2503|TS7026|TS7006|TS7031)$/.test(d.code))
  const missingContext = /^(?:const \w+ = )?(?:try |fork |fork\.|join |provide )/m.test(example.source)
  const fixtureGap = example.fragment || example.schematic || example.gap || mixedComparison || missingFixture || missingContext
  for (const d of rows) {
    if (example.expected.includes(d.code) || d.category === "warning") continue
    const sourceLine = example.source.split("\n")[d.line - 1] ?? ""
    // Inline negative examples must state the code; prose saying only "error"
    // is debt, not a successful negative test.
    const marked = /\/\/.*\b(?:error|invalid|illegal|forbidden|rejected)\b/i.test(sourceLine)
    const incomplete = fixtureGap || /^(?:EK0501|EK1701)$/.test(d.code)
    findings.push({ severity: d.code === "EK0509" && !marked ? "error" : marked || incomplete ? "warning" : "error", message: d.code + ": " + d.message })
  }
  if (fixtureGap) findings.push({ severity: "warning", message: "example is not validated as a complete program: " + (example.gap ?? (mixedComparison ? "mixed counterpart" : example.schematic ? "ellipsis" : missingContext ? "enclosing Effect context" : "missing fixture bindings")) })
  return findings
}
export function lintExamples(root, compiler = process.env.VIBELANG_COMPILER ?? join(root, "packages/compiler/native/vibelang")) {
  const modules = process.env.EFFECT_NODE_MODULES ?? join(root, "experiments/node_modules")
  const runtime = process.env.VIBELANG_RUNTIME ?? join(root, "packages/runtime")
  for (const required of [compiler, join(modules, "effect/package.json"), join(runtime, "dist/index.d.ts")])
    if (!existsSync(required)) throw new Error("Missing VIP check dependency: " + required)
  mkdirSync(join(root, ".cache"), { recursive: true })
  const temp = mkdtempSync(join(root, ".cache/spec-examples-")), findings = []
  try {
    let index = 0
    for (const vip of vipRegistry(root).values()) {
      if (vip.status !== "accepted") continue // denied/open proposals are historical syntax.
      for (const example of examples(vip.text)) {
        const dir = join(temp, String(++index)); mkdirSync(dir)
        mkdirSync(join(dir, "node_modules"))
        symlinkSync(join(modules, "effect"), join(dir, "node_modules/effect"))
        symlinkSync(runtime, join(dir, "node_modules/vibelang-runtime"))
        writeFileSync(join(dir, "package.json"), JSON.stringify({type: "module"}))
        writeFileSync(join(dir, "main." + example.language), example.source)
        writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
          target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
          skipLibCheck: true, noEmit: true, types: [], jsx: "preserve"
        }, files: ["main." + example.language] }))
        const result = spawnSync(compiler, ["--noEmit", "--pretty", "false", "-p", join(dir, "tsconfig.json")], { cwd: dir, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
        for (const f of verdict(example, result)) findings.push(issue("examples", vip.path, vip.text, example.offset, "example " + example.number + ": " + f.message, f.severity))
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
  return findings
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = lintExamples(repository)
  for (const f of findings) console.log(`${f.path}:${f.line}: ${f.severity}: ${f.message}`)
  console.log(`examples: ${findings.filter(f => f.severity === "error").length} errors, ${findings.filter(f => f.severity === "warning").length} warnings`)
  process.exitCode = findings.some(f => f.severity === "error") ? 1 : 0
}
