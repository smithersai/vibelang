// Deterministic specification contracts, executed by the root PACKAGE.ts.
// All authority is public and source-keyed; private review files are test provenance only.
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { lintKind, loadSpec } from "./spec-lint.ts"

export const repository = fileURLToPath(new URL("../../", import.meta.url))
export const read = (root, path) => readFileSync(join(root, path), "utf8")
const chapters = root => readdirSync(join(root, "docs/design/src")).filter(x => x.endsWith(".md")).sort().map(x => "docs/design/src/" + x)
export const reviewFindings = (root, kind) => lintKind(loadSpec(join(root, "docs/design")), kind)
  .map(f => ({ kind, path: "docs/design/" + f.file, line: f.line, severity: "error", message: f.message }))
export const issue = (kind, path, text, offset, message, severity = "error") =>
  ({ kind, path, line: text.slice(0, offset).split("\n").length, severity, message })

export function vipRegistry(root) {
  return new Map(readdirSync(join(root, "docs/design/vips")).filter(x => /^\d+.*\.md$/.test(x)).sort().map(name => {
    const path = "docs/design/vips/" + name, text = read(root, path)
    const status = text.match(/\*\*Status:\*\*\s*(accepted|denied|open)\b/i)?.[1]?.toLowerCase()
    if (!status) throw new Error(path + ": missing VIP status")
    return [Number(name.slice(0, 4)), { path, text, status }]
  }))
}

// Switch only this adapter when lang-tables' one-file registry lands.
// Do not copy its unlanded source or depend on another workspace.
export function diagnosticRegistry(root) {
  const path = "docs/design/registry/diagnostics.json"
  if (existsSync(join(root, path))) {
    const source = JSON.parse(read(root, path))
    const rows = Array.isArray(source) ? source : source.diagnostics
    if (!Array.isArray(rows)) throw new Error(path + ": expected diagnostics array")
    return new Map(rows.map(row => [row.code, { authority: row.vip ?? row.vips, path }]))
  }
  const pathB = "docs/design/src/900-appendices.md"
  const appendix = read(root, pathB).split("## Appendix B. Diagnostics\n")[1]?.split("\n## ")[0]
  if (!appendix) throw new Error("missing Appendix B")
  return new Map([...appendix.matchAll(/^\| `((?:EK|TS)\d+)` \| (.*?) \| (.*?) \|/gm)]
    .map(m => [m[1], { authority: m[3], path: pathB }]))
}

const inlineTokens = text => [...text.matchAll(/`([^`\n]+)`/g)].flatMap(m => {
  const value = m[1]
  // Inventory generation commands belong to the documentation tool, not the
  // language CLI. Their --write/--test arguments are not compiler options.
  if (/^(?:node|bun|python3?|bash|sh)\s/.test(value)) return []
  // Qualified config names and flag spellings, including comma-separated examples.
  return [...value.matchAll(/\b(?:compilerOptions\.vibelang(?:\.[A-Za-z]\w*)?|vibelang\.[A-Za-z]\w*|vibe\.(?!config\b)[A-Za-z]\w*)\b|--[a-z][\w-]*\b/g)]
    .map(t => ({ value: t[0], offset: m.index + 1 + t.index }))
})
// Configuration fences may contain several JSONC examples. Scan balanced
// objects first, then use the JSON AST so comments and braces in strings cannot
// invent keys. Explicit rejection examples are not positive option assignments.
function fencedTokens(text) {
  const found = []
  for (const m of text.matchAll(/^[ \t]{0,3}(`{3,}|~{3,})(jsonc?|sh|bash|shell)\s*\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm)) {
    const body = m[3], base = m.index + m[0].indexOf("\n") + 1
    const rejected = offset => /(?:\/\/|#).*\b(?:EK3007|TS5023)\b/.test(body.split("\n")[body.slice(0, offset).split("\n").length - 1] ?? "")
    if (!m[2].startsWith("json")) {
      for (const line of body.matchAll(/^.*$/gm)) {
        if (!/^\s*(?:\$\s+)?(?:(?:npx|bunx)\s+)?vibelang(?:\s|$)/.test(line[0])) continue
        for (const flag of line[0].split(/\s+#/)[0].matchAll(/--[a-z][\w-]*\b/g))
          found.push({ value: flag[0], offset: base + line.index + flag.index })
      }
      continue
    }
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, body)
    let depth = 0, start = 0
    const properties = node => ts.isObjectLiteralExpression(node) ? node.properties.filter(ts.isPropertyAssignment) : []
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.OpenBraceToken && depth++ === 0) start = scanner.getTokenPos()
      if (token !== ts.SyntaxKind.CloseBraceToken) continue
      if (--depth !== 0) continue
      const source = ts.parseJsonText("spec.json", body.slice(start, scanner.getTextPos()))
      const object = source.statements[0]?.expression
      if (!object) continue
      const add = (property, prefix) => {
        const offset = start + property.name.getStart(source)
        if (!rejected(offset)) found.push({ value: prefix + property.name.text, offset: base + offset })
      }
      for (const section of properties(object)) {
        if (["vibe", "vibelang"].includes(section.name.text)) {
          for (const property of properties(section.initializer)) add(property, section.name.text + ".")
        } else if (section.name.text === "compilerOptions") {
          for (const property of properties(section.initializer)) {
            if (property.name.text === "vibelang") {
              for (const nested of properties(property.initializer)) add(nested, "compilerOptions.vibelang.")
            } else add(property, "compilerOptions.")
          }
        }
      }
    }
  }
  return found
}
const tokens = text => [...inlineTokens(text), ...fencedTokens(text)]
const literalCode = code => new RegExp("\\b" + code + "\\b")
export function lintRegistry(root) {
  const findings = reviewFindings(root, "registry"), vips = vipRegistry(root), diagnostics = diagnosticRegistry(root)
  const upstream = JSON.parse(read(root, "typescript/tsc/internal/diagnostics/diagnosticMessages.json"))
  const tsCodes = new Set(Object.values(upstream).map(x => "TS" + x.code))
  const declarations = read(root, "typescript/tsc/internal/tsoptions/declarations_generated.go")
  const tsOptions = new Set([...declarations.matchAll(/(?:Name|ShortName):\s*"([^"]+)"/g)].map(m => m[1]))
  const accepted = [...vips.values()].filter(v => v.status === "accepted")
  // Denials authorize their rejection diagnostics, never the denied syntax.
  const publicAuthority = [...vips.values()].filter(v => v.status !== "open")
  const authorityText = publicAuthority.map(v => v.text).join("\n")
  const approvedToken = token => accepted.some(v => tokens(v.text).some(t => t.value === token || t.value.startsWith(token + ".")))
  // An accepted decision that cites an assigned code is part of that
  // code's authority. This is also checked by TestSpecCodesInAppendixB.
  for (const [id, vip] of vips) {
    if (vip.status !== "accepted") continue
    const heading = "\n## Decision\n", start = vip.text.indexOf(heading)
    if (start < 0) continue
    const offset = start + heading.length, body = vip.text.slice(offset).split(/\n## /, 1)[0]
    const cited = new Set()
    for (const m of body.matchAll(/\bEK(?:38\d{2,}|\d{4})\b/g)) {
      const begin = Math.max(body.lastIndexOf("\n", m.index), body.lastIndexOf(".", m.index)) + 1
      if (/\bold\b/i.test(body.slice(begin, m.index)) || cited.has(m[0])) continue
      cited.add(m[0])
      const row = diagnostics.get(m[0]), ids = String(row?.authority ?? "").match(/\d+/g) ?? []
      if (!ids.includes(String(id))) findings.push(issue("registry", vip.path, vip.text, offset + m.index,
        "VIP-" + id + " cites " + m[0] + " but its registry authority does not name VIP-" + id))
    }
  }
  const seen = new Set()
  for (const path of chapters(root)) {
    const text = read(root, path)
    for (const m of text.matchAll(/\b(?:EK|TS)\d{4,}\b/g)) {
      const code = m[0], row = diagnostics.get(code)
      if (code.startsWith("TS") && tsCodes.has(code)) continue // VIP-34 preserves TS diagnostics.
      if (!row) {
        const line = text.slice(text.lastIndexOf("\n", m.index) + 1, text.indexOf("\n", m.index) < 0 ? undefined : text.indexOf("\n", m.index))
        // Explicit historical diagnostics are documentation, not assignments.
        if (/\b(?:old|legacy|retired|transitional|interim|obsolete|replaced|still prints)\b/i.test(line)) continue
        if (literalCode(code).test(authorityText)) {
          findings.push(issue("registry", path, text, m.index, code + " has public authority but no registry row"))
        } else findings.push(issue("registry", path, text, m.index, code + " has no registry entry or published authority", "warning"))
      } else {
        const ids = String(row.authority ?? "").match(/\d+/g) ?? []
        if (!ids.length || ids.some(id => !vips.has(Number(id)))) findings.push(issue("registry", path, text, m.index, code + " has an invalid registry authority"))
        else if (ids.every(id => vips.get(Number(id)).status === "open"))
          findings.push(issue("registry", path, text, m.index, code + " has only open VIP authority; an accepted source is still needed", "warning"))
      }
    }
    for (const token of tokens(text)) {
      const value = token.value, key = path + ":" + value
      if (seen.has(key)) continue
      seen.add(key)
      if (value.startsWith("--") && tsOptions.has(value.slice(2))) continue
      if (value.startsWith("compilerOptions.") && !value.startsWith("compilerOptions.vibelang") && tsOptions.has(value.slice(16))) continue
      if (approvedToken(value)) continue
      findings.push(issue("registry", path, text, token.offset, value + " has no accepted VIP spelling; publish the decided authority or obtain a decision", "warning"))
    }
    // Round 14 OPUS-3: bare sibling option names smuggled into prose.
    for (const m of text.matchAll(/`(trustedPackages|tracing)`/g)) {
      if (!accepted.some(v => v.text.includes("`" + m[1] + "`")))
        findings.push(issue("registry", path, text, m.index, m[1] + " has no published option authority", "warning"))
    }
  }
  return findings
}

export function table(text, header) {
  const lines = text.split("\n")
  const start = lines.indexOf(header)
  if (start < 0) throw new Error("missing table " + header)
  let end = start + 1
  while (end < lines.length && lines[end].startsWith("|")) end++
  return lines.slice(start, end).join("\n") + "\n"
}

export const sharedTables = [
  { key: "resolution", source: "docs/design/vips/0039-vibex.md", target: "docs/design/src/007-tooling.md", header: "| Specifier | Tries, in order |", finding: "r14 OPUS-1 / r4 OPUS-2" }
]
export function lintCopies(root, write = false) {
  const findings = write ? [] : reviewFindings(root, "copies")
  for (const copy of sharedTables) {
    const original = table(read(root, copy.source), copy.header), text = read(root, copy.target)
    const duplicate = table(text, copy.header)
    if (original === duplicate) continue
    if (write) writeFileSync(join(root, copy.target), text.replace(duplicate, original))
    else findings.push(issue("copies", copy.target, text, text.indexOf(copy.header), copy.key + " must be byte-identical to " + copy.source))
  }
  // Explicit copies allow prose/examples to be generated without a second hand-edited rule.
  // <!-- spec-copy: docs/design/vips/NNNN-name.md#anchor --> ... <!-- /spec-copy -->
  for (const path of chapters(root)) {
    let text = read(root, path)
    for (const m of [...text.matchAll(/<!-- spec-copy: ([^\s]+) -->\n([\s\S]*?)<!-- \/spec-copy -->/g)]) {
      const [source, anchor] = m[1].split("#")
      if (!/^docs\/design\/vips\/\d{4}-[^/]+\.md$/.test(source) || !anchor) throw new Error(path + ": invalid copy source")
      const original = section(read(root, source), anchor)
      if (m[2] !== original) {
        if (write) text = text.replace(m[0], "<!-- spec-copy: " + m[1] + " -->\n" + original + "<!-- /spec-copy -->")
        else findings.push(issue("copies", path, text, m.index, "copy differs from " + m[1]))
      }
    }
    if (write && text !== read(root, path)) writeFileSync(join(root, path), text)
  }
  return findings
}
export function section(text, anchor) {
  const heading = [...text.matchAll(/^(#{1,6}) (.+)\n/gm)].find(m => m[2].toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-") === anchor)
  if (!heading) throw new Error("missing section #" + anchor)
  const rest = text.slice(heading.index + heading[0].length)
  const next = new RegExp("^#{1," + heading[1].length + "} ", "m").exec(rest)
  return rest.slice(0, next?.index ?? rest.length)
}

export function lintTables(root) {
  const findings = reviewFindings(root, "tables"), vips = vipRegistry(root)
  const chapterPath = "docs/design/src/007-tooling.md", chapter = read(root, chapterPath)
  const config = table(chapter, "| Key | Meaning |")
  const chapterKeys = new Set([...config.matchAll(/^\| `(vibe\.[^\x60]+)` \|/gm)].map(m => m[1]))
  const approvedKeys = new Set(tokens(vips.get(30).text).map(t => t.value).filter(x => x.startsWith("vibe.") && x !== "vibe.config"))
  for (const key of new Set([...chapterKeys, ...approvedKeys])) {
    if (chapterKeys.has(key) !== approvedKeys.has(key)) findings.push(issue("tables", chapterPath, chapter, chapter.indexOf("| Key | Meaning |"), key + ": decided-key table disagrees with VIP-30"))
  }
  const appendixPath = "docs/design/src/900-appendices.md", appendix = read(root, appendixPath)
  const denied = table(appendix, "| VIP | Denied | Instead |")
  const rows = [...denied.matchAll(/^\| \[(\d+)\].*? \| (.*?) \| (.*?) \|$/gm)]
  const ids = new Set(rows.map(m => Number(m[1])))
  for (const [id, vip] of vips) {
    if ((vip.status === "denied") !== ids.has(id))
      findings.push(issue("tables", appendixPath, appendix, appendix.indexOf("| VIP | Denied | Instead |"), "denied VIP-" + id + " membership disagrees with its status"))
  }
  for (const m of rows) {
    const vip = vips.get(Number(m[1]))
    if (!vip) continue
    const repairs = [...m[3].matchAll(/`([^`]+)`/g)].map(x => x[1])
    for (const repair of repairs) {
      // Template parameter names are irrelevant to repair *forms*.
      const normalize = x => x.replace(/\b(?:args|x)\b/g, "$arg")
      if (!normalize(vip.text).includes(normalize(repair)) && !(repair === ".ts" && vip.text.includes("plain TypeScript")))
        findings.push(issue("tables", appendixPath, appendix, appendix.indexOf(m[0]), "VIP-" + m[1] + " repair is absent from its VIP: " + repair))
    }

  }
  return findings
}

export function lintAuthority(root) {
  const findings = reviewFindings(root, "authority"), vips = vipRegistry(root)
  for (const path of chapters(root)) {
    const text = read(root, path)
    for (const m of text.matchAll(/^\| `((?:EK|TS)\d+)` \| .*? \| ([\d, ]+) \|.*$/gm)) {
      for (const id of m[2].match(/\d+/g) ?? []) {
        const vip = vips.get(Number(id))
        if (vip?.status === "denied" && !/trailing block|shorthand|inline .module.|wire|not permitted|forbidden|removed|denied/i.test(m[0]))
          findings.push(issue("authority", path, text, m.index, m[1] + " cites denied VIP-" + id + " as authority"))
      }
    }
    for (const m of text.matchAll(/VIP-(\d+)\b|\]\(\.\.\/vips\/(\d{4})-[^)]+\)/g)) {
      const id = Number(m[1] ?? m[2]), vip = vips.get(id)
      if (vip?.status !== "denied") continue
      const boundary = text.lastIndexOf("\n\n", m.index)
      const begin = boundary < 0 ? 0 : boundary + 2
      const end = text.indexOf("\n\n", m.index)
      // Blank link destinations without moving offsets: a filename containing
      // denied is not a rejection, nor is a separate neighbouring sentence.
      const paragraph = text.slice(begin, end < 0 ? undefined : end)
        .replace(/\]\([^)]+\)/g, link => "]" + " ".repeat(link.length - 1))
      const offset = m.index - begin
      const sentence = [...paragraph.matchAll(/[\s\S]+?(?:[.!?](?=\s|$)|$)/g)]
        .find(s => s.index <= offset && offset < s.index + s[0].length)?.[0] ?? paragraph
      if (text.slice(text.lastIndexOf("\n", m.index) + 1, m.index).trimStart().startsWith("//")) continue
      // A standalone attributed quotation records historical rationale; it
      // does not assert that the denied proposal is part of the language.
      if (/^["“][\s\S]+["”]\s*\(VIP-\d+\)\.\s*$/.test(sentence.trim())) continue
      if (/\b(?:denied|rejected|not permitted|not part of the language|no special syntax|removed|don.t exist|trailing block.*(?:error|EK1101))\b/i.test(sentence)) continue
      findings.push(issue("authority", path, text, m.index, "denied VIP-" + id + " cannot authorize this chapter citation"))
    }
    for (const m of text.matchAll(/^.*(?:Sources?:|[Aa]uthority:|[Aa]uthorized by|[Pp]ermitted by|[Aa]llowed by|[Aa]s (?:specified|defined) (?:in|by)).*$/gm)) {
      // A rejection can cite its denial; prose elsewhere is left to the model judge.
      if (/\b(?:denied|rejected|not permitted|not part of the language)\b/i.test(m[0])) continue
      const ids = [...m[0].matchAll(/VIP-(\d+)/g)]
      for (const id of ids) {
        const vip = vips.get(Number(id[1]))
        if (!vip || vip.status !== "accepted") findings.push(issue("authority", path, text, m.index + id.index, "VIP-" + id[1] + " is " + (vip?.status ?? "missing") + " and cannot authorize a chapter rule"))
      }
    }
  }
  return findings
}

export function generateShared(root) {
  const output = "<!-- Generated from VIP-39 by //:spec-shared-tables. -->\n\n" + table(read(root, sharedTables[0].source), sharedTables[0].header)
  mkdirSync(join(root, "docs/design/generated"), { recursive: true })
  writeFileSync(join(root, "docs/design/generated/resolution.md"), output)
}

export function lint(root, kind) {
  const checks = { registry: lintRegistry, tables: lintTables, copies: lintCopies, authority: lintAuthority }
  if (!checks[kind]) throw new Error("unknown spec linter " + kind)
  return checks[kind](root)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, ...flags] = process.argv.slice(2)
  if (kind === "generate" && !flags.length) { generateShared(repository); process.exit(0) }
  if (flags.some(x => x !== "--write") || (flags.length && kind !== "copies")) throw new Error("usage: spec-rules.mjs registry|tables|copies|authority [--write for copies]")
  const findings = flags.includes("--write") ? lintCopies(repository, true) : lint(repository, kind)
  for (const f of findings) console.log(f.path + ":" + f.line + ": " + f.severity + ": " + f.message)
  console.log(kind + ": " + findings.filter(f => f.severity === "error").length + " errors, " + findings.filter(f => f.severity === "warning").length + " warnings")
  process.exitCode = findings.some(f => f.severity === "error") ? 1 : 0
}
