// Printed diagnostic identities, independently inventoried from compiler source.
// The ordinary spec-lint graph enforces this complete Appendix B inventory.
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

// Split Go call/signature arguments without treating nested calls, literals or
// strings as delimiters. Helpers that forward a code register their call-site
// constants, rather than their generic parameter.
function argumentsAt(ts, open) {
  const args = [], current = []
  let depth = 0
  for (let i = open + 1; i < ts.length; i++) {
    const value = ts[i].value
    if (value === ")" && depth === 0) {
      if (current.length) args.push(current.splice(0))
      return { args, end: i }
    }
    if (value === "," && depth === 0) { args.push(current.splice(0)); continue }
    if (["(", "{", "["].includes(value)) depth++
    if ([")", "}", "]"].includes(value)) depth--
    current.push(ts[i])
  }
  throw new Error("Unclosed Go diagnostic helper arguments")
}

function mapperForwarders(sources) {
  const result = new Map()
  for (const {path, tokens: ts} of sources) {
    if (!path.split("/").includes("vibelangmapper")) continue
    const pkg = path.slice(0, path.lastIndexOf("/"))
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].value !== "func") continue
      let name = i + 1
      if (ts[name]?.value === "(") name = argumentsAt(ts, name).end + 1
      if (ts[name + 1]?.value !== "(") continue
      const params = argumentsAt(ts, name + 1)
      let begin = params.end + 1
      while (begin < ts.length && ts[begin].value !== "{") begin++
      let end = begin + 1, depth = 1
      while (end < ts.length && depth) {
        if (ts[end].value === "{") depth++
        if (ts[end].value === "}") depth--
        end++
      }
      for (let j = begin + 1; j < end; j++) {
        if (ts[j].value !== "Diagnostic" || ts[j + 1]?.value !== "{") continue
        let d = 1
        for (let k = j + 2; k < end && d; k++) {
          if (ts[k].value === "{") d++
          else if (ts[k].value === "}") d--
          else if (d === 1 && ts[k].value === "Code" && ts[k + 1]?.value === ":") {
            const param = params.args.findIndex(a => a[0]?.value === ts[k + 2]?.value &&
              ["int32", "int"].includes(a.at(-1)?.value))
            if (param >= 0) result.set(pkg + "/" + ts[name].value, param)
          }
        }
      }
      i = end - 1
    }
  }
  return result
}

export function compilerCodes(sources) {
  const registered = new Map()
  const tokens = sources.map(({ path, text }) => ({ path, text, tokens: goTokens(text) }))
  const forwarders = mapperForwarders(tokens)
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
  const add = (code, path, offset, kind, details = {}) => {
    if (!/^EK\d{4,}$/.test(code)) throw new Error(path + ": invalid diagnostic code " + code)
    if (!registered.has(code)) registered.set(code, [])
    registered.get(code).push({ path, offset, kind, ...details })
  }
  for (const { path, tokens: ts } of tokens) {
    // Classify the file once: there are millions of tokens.
    const parserSource = /(?:^|\/)parser\/vibelang[^/]*\.go$/.test(path)
    const compilerSource = /(?:^|\/)vibelang\//.test(path)
    const mapperSource = path.split("/").includes("vibelangmapper")
    const packageDirectory = directory(path)
    for (let i = 0; i < ts.length; i++) {
      const token = ts[i].value
      if (parserSource && /Code$/.test(token)) {
        const j = ts[i + 1]?.value === "int32" ? i + 2 : i + 1
        if (ts[j]?.value === "=" && /^\d+$/.test(ts[j + 1]?.value ?? ""))
          add(codeName(Number(ts[j + 1].value)), path, ts[i].offset, "parser")
      }
      if (compilerSource && ["message", "messageOff", "registryMessage", "registryVariant"].includes(token) && ts[i + 1]?.value === "(") {
        let arg = ts[i + 2]?.value
        // A named function declaration is not a message construction.
        if (ts[i - 1]?.value === "func") continue
        if (ts[i + 3]?.value === ".") arg = ts[i + 4]?.value
        const n = /^\d+$/.test(arg ?? "") ? Number(arg) : constants.get(arg)
        if (n !== undefined) add(codeName(n), path, ts[i].offset, "message")
        else if (/^"EK\d{4,}"$/.test(arg ?? "")) add(JSON.parse(arg), path, ts[i].offset, "message")
        else throw new Error(path + ": unresolved diagnostic constructor argument " + arg)
      }
      if (mapperSource && ts[i + 1]?.value === "(" && forwarders.has(packageDirectory + "/" + token)) {
        const call = argumentsAt(ts, i + 1)
        const arg = call.args[forwarders.get(packageDirectory + "/" + token)] ?? []
        const value = arg.length === 1 ? arg[0].value :
          arg.length === 3 && arg[1].value === "." ? arg[2].value : undefined
        const local = mapperConstants.get(packageDirectory)
        const n = /^\d+$/.test(value ?? "") ? Number(value) : local?.get(value) ?? constants.get(value)
        if (n > 0) add(codeName(n), path, ts[i].offset, "mapper", {forwarder: token})
      }
      // The stock TypeScript content mapper reports its own EK diagnostics
      // as Diagnostic records. A native message's removal must not hide one.
      if (mapperSource && ["Diagnostic", "OptionDiagnosticResult"].includes(token) && ts[i + 1]?.value === "{") {
        let depth = 1
        for (let j = i + 2; j < ts.length && depth; j++) {
          if (ts[j].value === "{") depth++
          else if (ts[j].value === "}") depth--
          else if (depth === 1 && ts[j].value === "Code" && ts[j + 1]?.value === ":") {
            const arg = ts[j + 2]?.value
            if (![",", "}"].includes(ts[j + 3]?.value)) continue
            const local = mapperConstants.get(packageDirectory)
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
            add(JSON.parse(ts[j].value), path, ts[j].offset, token,
              token === "VibeImportedLintCodes" ? { rule: JSON.parse(ts[j + 2].value) } : {classification: JSON.parse(ts[j + 2].value), category: JSON.parse(ts[j + 2].value).replace(/^lint /, "")})
        }
      }
    }
  }
  if (!registered.size) throw new Error("No compiler diagnostic registrations found")
  return registered
}

// Category assignments are read from compiler declarations independently of the
// generated reservation table. A reservation must never hide a contrary emitter.
export function compilerCategories(sources, registered = compilerCodes(sources)) {
  const aliases = new Map([
    ["errorCategory", "error"], ["warningCategory", "warning"],
    ["CategoryError", "error"], ["CategoryWarning", "warning"],
    ["CategorySuggestion", "suggestion"], ["CategoryMessage", "suggestion"]
  ])
  const tokenized = sources.map(s => ({ ...s, tokens: goTokens(s.text) }))
  const assignments = []
  for (const { tokens: ts } of tokenized) for (let i = 0; i < ts.length; i++) {
    if (ts[i + 1]?.value !== "=") continue
    assignments.push([ts[i].value, ts[i + 3]?.value === "." ? ts[i + 4]?.value : ts[i + 2]?.value])
  }
  for (let pass = 0; pass < assignments.length; pass++) {
    let changed = false
    for (const [name, value] of assignments) if (!aliases.has(name) && aliases.has(value)) {
      aliases.set(name, aliases.get(value)); changed = true
    }
    if (!changed) break
  }
  // Imported defaults come from the pinned rule implementations, independently
  // of both Appendix B and its generated category-reservation map.
  const imported = new Map()
  const severities = new Map([["SeverityError","error"],["SeverityWarning","warning"],
    ["SeveritySuggestion","suggestion"],["SeverityOff","off"]])
  for (const {path, tokens: ts} of tokenized) {
    if (!path.includes("/effecttsgo/internal/rules/")) continue
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].value !== "rule" || ts[i+1]?.value !== "." || ts[i+2]?.value !== "Rule" || ts[i+3]?.value !== "{") continue
      let depth=1, name, category, offset
      for (let j=i+4; j<ts.length && depth; j++) {
        if (ts[j].value === "{") depth++
        else if (ts[j].value === "}") depth--
        else if (depth===1 && ts[j+1]?.value === ":") {
          if (ts[j].value === "Name" && ts[j+2]?.value.startsWith('"')) name=JSON.parse(ts[j+2].value)
          if (ts[j].value === "DefaultSeverity") {
            const value=ts[j+3]?.value === "." ? ts[j+4]?.value : ts[j+2]?.value
            category=severities.get(value);offset=ts[j].offset
            if (!category) throw new Error(path+": unresolved pinned lint severity "+value)
          }
        }
      }
      if (name && category) imported.set(name,{path,offset,kind:"imported-rule",category})
    }
  }
  const result = new Map()
  for (const [code, sites] of registered) {
    // contentmapper/hostimpl.go materializes projection diagnostics as errors.
    // The same projector records can also feed native editor-only advice; keep
    // both hosts rather than allowing the editor's category to hide an error.
    const categories = sites.filter(s => s.kind === "mapper")
      .map(site => ({...site, category: "error", host: "content-mapper"}))
    for (const site of sites) if (site.kind === "VibeImportedLintCodes" && imported.has(site.rule))
      categories.push(imported.get(site.rule))
    for (const site of sites.filter(s => s.kind === "message")) {
      const ts = tokenized.find(s => s.path === site.path).tokens
      let i = ts.findIndex(t => t.offset === site.offset)
      const constructor = ts[i].value
      if (constructor === "messageOff") {
        categories.push({ ...site, category: "off" }); continue
      }
      if (constructor.startsWith("registry")) continue // category comes from the reservation itself
      while (i < ts.length && ts[i].value !== ",") i++
      const name = ts[i + 2]?.value === "." ? ts[i + 3]?.value : ts[i + 1]?.value
      if (!aliases.has(name)) throw new Error(code + ": unresolved diagnostic category " + name)
      categories.push({ ...site, category: aliases.get(name) })
    }
    for(const site of sites.filter(s=>s.kind==="VibeDiagnosticCategories")) {
      if(!["error","warning","suggestion","off"].includes(site.category))throw Error(code+": unknown reservation category")
      categories.push(site)
    }
    result.set(code, categories)
  }
  // A cloned Message can change category at a report site. Its registered
  // primary must not hide that second default (the former EK4408 collision).
  const namedByPackage=new Map(), constructorCodes=new Map()
  for(const [code,sites] of registered) for(const site of sites.filter(s=>s.kind==="message")) {
    const source=tokenized.find(s=>s.path===site.path),ts=source.tokens
    const i=ts.findIndex(t=>t.offset===site.offset)
    constructorCodes.set(site.path+":"+site.offset,code)
    let depth=0;for(let j=0;j<i;j++){if(ts[j].value==="{")depth++;if(ts[j].value==="}")depth--}
    if(depth || ts[i-1]?.value!=="=") continue
    const pkg=site.path.slice(0,site.path.lastIndexOf("/"))
    if(!namedByPackage.has(pkg)) namedByPackage.set(pkg,new Map())
    namedByPackage.get(pkg).set(ts[i-2].value,code)
  }
  for(const {path,tokens:ts} of tokenized) {
    const pkg=path.slice(0,path.lastIndexOf("/"))
    const scopes=[new Map(namedByPackage.get(pkg)??[])]
    for(let i=0;i<ts.length;i++) {
      const value=ts[i].value,scope=scopes.at(-1)
      if(value==="{"){scopes.push(new Map(scope));continue}
      if(value==="}"){if(scopes.length>1)scopes.pop();continue}
      const short=ts[i+1]?.value===":"&&ts[i+2]?.value==="="
      const assignment=short?i+3:ts[i+1]?.value==="="&&ts[i-1]?.value!=="."?i+2:-1
      if(assignment>=0) {
        let rhsIndex=assignment
        while(["*","&","("].includes(ts[rhsIndex]?.value))rhsIndex++
        const rhs=ts[rhsIndex]
        const code=constructorCodes.get(path+":"+rhs?.offset)??scope.get(rhs?.value)
        if(code)scope.set(value,code)
        else if(scopes.length>1)scope.delete(value)
      }
      if(ts[i+1]?.value!=="."||ts[i+2]?.value!=="Category"||ts[i+3]?.value!=="=")continue
      const code=scope.get(value);if(!code)continue
      const severity=ts[i+5]?.value==="."?ts[i+6]?.value:ts[i+4]?.value
      if(!aliases.has(severity))throw Error(code+": unresolved local category override "+severity)
      const disabled=result.get(code).some(s=>s.category==="off")
      result.get(code).push({path,offset:ts[i].offset,kind:"category-override",category:disabled?"off":aliases.get(severity)})
    }
  }
  return result
}

export function appendixCategory(row) {
  // Escaped pipes belong to the rule, not to a table-cell boundary.
  const cells = row.replaceAll("\\|", "\0").split("|").map(x => x.trim())
  if (cells[0].startsWith("`effecttsgo/")) {
    const last = cells.filter(Boolean).at(-1)?.replaceAll("`", "")
    if (!["error", "warning", "suggestion", "off"].includes(last)) throw new Error("Missing imported default category")
    return last
  }
  return /^(?:lint )?warning\b/.test(cells[0]) ? "warning" :
    /^suggestion\b/.test(cells[0]) ? "suggestion" : /^off\b/.test(cells[0]) ? "off" : "error"
}

export function appendixCategories(row) {
  const primary=appendixCategory(row)
  const declared=/Category variants: ((?:`(?:error|warning|suggestion|off)`(?:, )?)+)/.exec(row)
  if(!declared)return [primary]
  const variants=[...declared[1].matchAll(/`([^`]+)`/g)].map(m=>m[1])
  if(!variants.includes(primary)||variants.length!==new Set(variants).size)throw Error("Invalid Appendix category variants")
  return variants
}

export function auditCategories(categories, appendix) {
  const findings = []
  for (const [code, sites] of categories) {
    if (!appendix.has(code)) continue
    const expected = appendixCategory(appendix.get(code))
    const allowed=appendixCategories(appendix.get(code))
    for (const site of sites) {
      // Imported rules are assigned separately; an own-code reservation would
      // invent a second default instead of the pinned plugin's severity.
      if(site.kind==="VibeDiagnosticCategories"&&code.startsWith("EK38")) {
        findings.push({kind:"classification-mismatch",code,path:site.path,expected:"separate imported allocation",actual:site.classification})
        continue
      }
      if (!(site.kind==="VibeDiagnosticCategories"?[expected]:allowed).includes(site.category)) findings.push({
        kind: "severity-mismatch", code, path: site.path,
        expected, actual: site.category, ...(site.host ? {host: site.host} : {})
      })
    }
  }
  return findings
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
  const retiredCodes = new Set(documents.filter(d => d.path === "docs/design/src/900-appendices.md")
    .flatMap(d => [...d.text.matchAll(/The old `(EK\d{4,})` is retired and will never be reassigned:/g)].map(m => m[1])))

  for (const code of retiredCodes) {
    if (registered.has(code)) findings.push({kind: "retired-registered", code, path: registered.get(code)[0].path})
    if (appendix.has(code)) findings.push({kind: "retired-row", code, path: "docs/design/src/900-appendices.md"})
  }
  for (const [code, sites] of registered) {
    if (!appendix.has(code)) findings.push({ kind: "registered-missing", code, path: sites[0].path })
    for (const site of sites.filter(s => s.rule && appendix.has(code))) {
      if (!appendix.get(code).includes("`effecttsgo/" + site.rule + "`"))
        findings.push({kind: "meaning-mismatch", code, path: site.path, actual: site.rule, expected: appendix.get(code)})
    }
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
      const historical = retiredCodes.has(match[0]) &&
        /\bold (?:lint warning )?`$/.test(text.slice(0, match.index)) &&
        /^` (?:retires|is retired)\b/.test(text.slice(match.index + match[0].length))
      if (!registered.has(match[0]) && !retired && !historical) findings.push({
        kind: "cited-unknown", code: match[0], path, line: text.slice(0, match.index).split("\n").length
      })
    }
  }
  return findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code) || a.path.localeCompare(b.path))
}

// One process inventories a root once: the sources do not change under a check,
// and each retired-identity test asks about the same inventory.
const inventories = new Map()
export function loadIdentity(root = repository) {
  const key = resolve(root)
  if (!inventories.has(key)) inventories.set(key, inventory(root))
  return inventories.get(key)
}

function inventory(root) {
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
  const categories = compilerCategories(sources, registered)
  return { registered, appendix, documents, categories, findings: [...auditIdentity(registered, appendix, documents), ...auditCategories(categories, appendix)] }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const audit = loadIdentity(process.argv[2] ?? repository)
  for (const finding of audit.findings)
    console.error(finding.path + (finding.line ? ":" + finding.line : "") + ": " + finding.kind + ": " + finding.code)
  const count = kind => new Set(audit.findings.filter(f => f.kind === kind).map(f => f.code)).size
  console.log(JSON.stringify({ registered: audit.registered.size, appendix: audit.appendix.size,
    registeredMissing: count("registered-missing"), appendixUnregistered: count("appendix-unregistered"), citedUnknown: count("cited-unknown"), severityMismatch: count("severity-mismatch"), classificationMismatch: count("classification-mismatch"), meaningMismatch: count("meaning-mismatch") }))
  process.exitCode = audit.findings.length ? 1 : 0
}
