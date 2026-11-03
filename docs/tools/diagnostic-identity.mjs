// Printed diagnostic identities, independently inventoried from compiler source.
// Optional until fold-details folds the complete Appendix B inventory. See build.md.
import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const repository = fileURLToPath(new URL("../..", import.meta.url))
const codeName = n => "EK" + String(n).padStart(4, "0")

function files(root, extension) {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? files(path, extension) : path.endsWith(extension) ? [path] : []
  })
}

// Tokenize comments separately: neither an example in a comment nor diagnostic
// wording that happens to contain message(9999, ...) declares a diagnostic.
export function goTokens(text) {
  const out = []
  const pattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|`[^`]*`|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*|\d+|[^\s]/g
  for (const match of text.matchAll(pattern)) {
    if (match[0].startsWith("//") || match[0].startsWith("/*")) continue
    out.push({ value: match[0], offset: match.index })
  }
  return out
}

export function compilerCodes(sources) {
  const registered = new Map()
  const tokens = sources.map(({ path, text }) => ({ path, text, tokens: goTokens(text) }))
  const constants = new Map()
  const mapperConstants = new Map()
  const directory = path => path.slice(0, path.lastIndexOf("/"))
  for (const { tokens: ts } of tokens) {
    for (let i = 0; i < ts.length; i++) {
      const j = ts[i + 1]?.value === "int32" ? i + 2 : i + 1
      if (ts[j]?.value === "=" && /^\d+$/.test(ts[j + 1]?.value ?? ""))
        constants.set(ts[i].value, Number(ts[j + 1].value))
    }
  }
  // Resolve actual package-local const declarations, never a same-named
  // variable from another package or a generic forwarding parameter.
  for (const { path, tokens: ts } of tokens) {
    if (!path.split("/").includes("vibelangmapper")) continue
    const values = mapperConstants.get(directory(path)) ?? new Map()
    mapperConstants.set(directory(path), values)
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].value !== "const") continue
      const grouped = ts[i + 1]?.value === "("
      let end = i + 2
      if (grouped) {
        let depth = 1
        while (end < ts.length && depth) {
          if (ts[end].value === "(") depth++
          else if (ts[end].value === ")") depth--
          end++
        }
      }
      for (let j = grouped ? i + 2 : i + 1; j < end; j++) {
        const name = ts[j]?.value
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name ?? "")) continue
        const eq = ts[j + 1]?.value === "=" ? j + 1 : ts[j + 2]?.value === "=" ? j + 2 : -1
        if (eq < 0) continue
        const arg = ts[eq + 1]?.value
        values.set(name, Number.isInteger(Number(arg)) ? Number(arg) : undefined)
        j = eq + 1
      }
    }
  }
  const add = (code, path, offset, kind) => {
    if (!/^EK\d{4,}$/.test(code)) throw new Error(path + ": invalid diagnostic code " + code)
    if (!registered.has(code)) registered.set(code, [])
    registered.get(code).push({ path, offset, kind })
  }
  for (const { path, tokens: ts } of tokens) {
    for (let i = 0; i < ts.length; i++) {
      const token = ts[i].value
      if (/(?:^|\/)vibelang\//.test(path) && ["message", "messageOff", "registryMessage", "registryVariant"].includes(token) && ts[i + 1]?.value === "(") {
        let arg = ts[i + 2]?.value
        // A named function declaration is not a message construction.
        if (ts[i - 1]?.value === "func") continue
        if (ts[i + 3]?.value === ".") arg = ts[i + 4]?.value
        const n = /^\d+$/.test(arg ?? "") ? Number(arg) : constants.get(arg)
        if (n !== undefined) add(codeName(n), path, ts[i].offset, "message")
        else if (/^"EK\d{4,}"$/.test(arg ?? "")) add(JSON.parse(arg), path, ts[i].offset, "message")
        else throw new Error(path + ": unresolved diagnostic constructor argument " + arg)
      }
      // The stock TypeScript content mapper reports its own EK diagnostics
      // as Diagnostic records. A native message's removal must not hide one.
      if (path.split("/").includes("vibelangmapper") && ["Diagnostic", "OptionDiagnosticResult"].includes(token) && ts[i + 1]?.value === "{") {
        let depth = 1
        for (let j = i + 2; j < ts.length && depth; j++) {
          if (ts[j].value === "{") depth++
          else if (ts[j].value === "}") depth--
          else if (depth === 1 && ts[j].value === "Code" && ts[j + 1]?.value === ":") {
            const arg = ts[j + 2]?.value
            if (![",", "}"].includes(ts[j + 3]?.value)) continue
            const local = mapperConstants.get(directory(path))
            const n = Number.isInteger(Number(arg)) ? Number(arg) : local?.get(arg)
            if (local?.has(arg) && n === undefined)
              throw new Error(path + ": unresolved mapper diagnostic constant " + arg)
            if (n > 0) add(codeName(n), path, ts[j].offset, "mapper")
          }
        }
      }
      // Both maps are actual compiler registries. The category map also reserves
      // ahead-of-implementation VIP codes; it never enables a checker. Do not
      // read Appendix B or a proposed JSON catalog to invent registrations.
      if (["VibeDiagnosticCategories", "VibeImportedLintCodes"].includes(token) && ts[i + 1]?.value === "=") {
        let j = i + 2
        while (j < ts.length && ts[j].value !== "{") j++
        for (j++; j < ts.length && ts[j].value !== "}"; j++) {
          if (/^"EK\d{4,}"$/.test(ts[j].value) && ts[j + 1]?.value === ":")
            add(JSON.parse(ts[j].value), path, ts[j].offset, token)
        }
      }
    }
  }
  if (!registered.size) throw new Error("No compiler diagnostic registrations found")
  return registered
}

export function appendixCodes(text) {
  const section = text.split(/^## Appendix B\. Diagnostics\s*$/m)[1]?.split(/^## /m)[0]
  if (!section) throw new Error("Missing Appendix B. Diagnostics")
  const rows = new Map()
  // Only definition cells count: prose mentions and ranges cannot stand in for
  // a row. Compatibility rows use the existing 'interim' prefix.
  for (const match of section.matchAll(/^\|\s*(?:interim\s+)?`?(EK\d{4,})`?\s*\|([^\n]*)/gm)) {
    if (rows.has(match[1])) throw new Error("Duplicate Appendix B row " + match[1])
    rows.set(match[1], match[2])
  }
  if (!rows.size) throw new Error("Appendix B has no diagnostic definition rows")
  return rows
}

export function auditIdentity(registered, appendix, documents) {
  const findings = []
  for (const [code, sites] of registered) {
    if (!appendix.has(code)) findings.push({ kind: "registered-missing", code, path: sites[0].path })
  }
  for (const code of appendix.keys()) {
    if (!registered.has(code)) findings.push({ kind: "appendix-unregistered", code, path: "docs/design/src/900-appendices.md" })
  }
  for (const { path, text } of documents) {
    // Whole decimal codes: EK3810 and EK38100 are different identities.
    for (const match of text.matchAll(/\bEK\d{4,}\b/g)) {
      const retired = path === "docs/design/src/900-appendices.md" &&
        text.slice(0, match.index).endsWith("The old `") &&
        text.slice(match.index + match[0].length).startsWith("` is retired and will never be reassigned:")
      if (!registered.has(match[0]) && !retired) findings.push({
        kind: "cited-unknown", code: match[0], path, line: text.slice(0, match.index).split("\n").length
      })
    }
  }
  return findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code) || a.path.localeCompare(b.path))
}

export function loadIdentity(root = repository) {
  const sources = files(join(root, "typescript/tsc/internal"), ".go")
    .filter(path => !path.endsWith("_test.go"))
    .map(path => ({ path: relative(root, path), text: readFileSync(path, "utf8") }))
  // Published reference chapters and user guides. Historical VIP proposals,
  // decision logs, history, release notes and the explicitly versioned code map
  // are migration records, not claims about a current printed identity.
  const paths = [
    ...files(join(root, "docs/user/src"), ".md").filter(path => !/(?:release-notes|diagnostic-code-map)\.md$/.test(path)),
    ...files(join(root, "docs/design/src"), ".md").filter(path => !path.endsWith("900-appendices.md")),
    join(root, "docs/user/llms-essentials.md"), join(root, "packages/compiler/skills/vibelang/SKILL.md"),
    join(root, "templates/app/AGENTS.md")
  ]
  const documents = paths.map(path => ({ path: relative(root, path), text: readFileSync(path, "utf8") }))
  const appendixText = readFileSync(join(root, "docs/design/src/900-appendices.md"), "utf8")
  // Scan Appendix B's references too, but exclude the historical decision log in C.
  documents.push({ path: "docs/design/src/900-appendices.md", text: appendixText.split(/^## Appendix C\./m)[0] })
  const registered = compilerCodes(sources)
  const appendix = appendixCodes(appendixText)
  return { registered, appendix, documents, findings: auditIdentity(registered, appendix, documents) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const audit = loadIdentity(process.argv[2] ?? repository)
  for (const finding of audit.findings)
    console.error(finding.path + (finding.line ? ":" + finding.line : "") + ": " + finding.kind + ": " + finding.code)
  const count = kind => new Set(audit.findings.filter(f => f.kind === kind).map(f => f.code)).size
  console.log(JSON.stringify({ registered: audit.registered.size, appendix: audit.appendix.size,
    registeredMissing: count("registered-missing"), appendixUnregistered: count("appendix-unregistered"), citedUnknown: count("cited-unknown") }))
  process.exitCode = audit.findings.length ? 1 : 0
}
