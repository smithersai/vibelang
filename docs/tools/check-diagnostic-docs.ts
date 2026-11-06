import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

const repo = resolve(import.meta.dir, "../..")

function files(root: string, extension: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? files(path, extension) : path.endsWith(extension) ? [path] : []
  })
}

// Message declarations are registered across several files, not just diagnostics.go.
export function diagnosticCodes(sources: string[]): string[] {
  return [...new Set(sources.flatMap(source =>
    [...source.matchAll(/^\s*(?:var\s+)?(EK\d+)\s*=\s*message\(/gm)].map(match => match[1])))].sort()
}

// Imported rules have a registry of their own rather than message declarations.
// Keep full codes: EK3810 and EK38100 name different rules (detail 142).
export function importedLintRules(source: string): { code: string, rule: string }[] {
  const body = source.match(/var VibeImportedLintCodes = map\[string\]string\{([\s\S]*?)\n\}/)?.[1]
  if (body === undefined) throw new Error("Missing VibeImportedLintCodes registry")
  const rules = [...body.matchAll(/^\s*"(EK[0-9]+)":\s*"([^"]+)",?\s*$/gm)]
    .map(([, code, rule]) => ({ code, rule }))
  if (!rules.length || rules.some(({ code }) => !/^EK38[0-9]{2,}$/.test(code)) ||
      new Set(rules.map(({ code }) => code)).size !== rules.length ||
      new Set(rules.map(({ rule }) => rule)).size !== rules.length) {
    throw new Error("Invalid or duplicate imported lint registry entry")
  }
  return rules
}

// The registry test's specAhead map lists the codes Appendix B assigns before the
// compiler declares them. Only its keys are codes: a comment such as "VIP-7: ..."
// or a quoted reason is not.
export function pendingRegistryCodes(source: string): string[] {
  const body = source.match(/var specAhead = map\[int32\]string\{([\s\S]*?)\n\}/)?.[1] ?? ""
  const code = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|`[^`]*`/g, " ")
  return [...code.matchAll(/(?:^|,)\s*([0-9]+)\s*:/g)].map(([, key]) => "EK" + key.padStart(4, "0")).sort()
}

// The codes of forms the VIPs (docs/design/vips) remove or respell. The user docs
// describe the VIP language, so these have no reference until the compiler retires
// or respells them; delete an entry when its code goes.
export const retiredByVips: Record<string, string> = {
  EK2006: "VIP-5: effect code has no try statements",
  EK9207: "VIP-9: service X: T is not a form",
  EK2104: "VIP-11: no layer declarations",
  EK2105: "VIP-5: no typed catch clauses",
  EK2107: "VIP-35: handlers are open",
  EK2110: "VIP-35: handlers are open",
  EK2113: "VIP-5: no catch clauses in effect code",
  EK2117: "VIP-13: an error never extends another error",
  EK2120: "VIP-9: no service class spelling",
  EK2121: "VIP-11: no layer declarations",
  EK3202: "VIP-24: wire is denied",
  EK4202: "VIP-35: handlers are open",
  EK4501: "no VIP adds data-type method calls",
  EK4601: "VIP-5: await is only for Promises",
  EK4602: "VIP-5: await is only for Promises",
  EK4604: "VIP-6: no hatches",
  EK4607: "VIP-18: no select",
  EK4612: "VIP-6: no hatches",
  EK4807: "VIP-24: the quick fix writes wire"
}

export function undocumentedCodes(codes: string[], pages: string[]): string[] {
  const documented = new Set(pages.flatMap(page => [...page.matchAll(/\bEK\d+\b/g)].map(match => match[0])))
  // EK4407's module-name resolution is being reworked; document it when settled.
  return codes.filter(code => code !== "EK4407" && !(code in retiredByVips) && !documented.has(code))
}

export function checkDiagnosticDocs(root = repo): string[] {
  const sources = files(join(root, "typescript/tsc/internal/vibelang"), ".go")
    .filter(path => !path.endsWith("_test.go")).map(path => readFileSync(path, "utf8"))
  const pages = files(join(root, "docs/user/src"), ".md").map(path => readFileSync(path, "utf8"))
  return undocumentedCodes(diagnosticCodes(sources), pages)
}


// Services: "Legacy service class Name { members } ... reports EK0909."
// The retained EK2120 warning belongs to control class in editor semantics.
export function editorMigrationDiagnosticProblems(text: string, file = "document"): string[] {
  const problems: string[] = []
  let fence = "", paragraph: string[] = [], start = 1
  const check = () => {
    const prose = paragraph.join(" ").replaceAll("\x60", "").replace(/\s+/g, " ")
    if (/\b(?:class(?:-|\s+)only\s+service|service\s+class)\b/i.test(prose) &&
        /\bEK2120\b/.test(prose) && !/\bEK0909\b/.test(prose) &&
        !/\b(?:no longer|never|not)\b.{0,60}\bEK2120\b|\bEK2120\b.{0,35}\b(?:no longer|never|not)\b/i.test(prose)) {
      problems.push(file + ":" + start + ": retired service class uses error EK0909; EK2120 is the control-class editor warning")
    }
    paragraph = []
  }
  for (const [index, line] of text.split("\n").entries()) {
    const marker = line.match(/^\s*(\x60{3,}|~{3,})/)
    if (marker) {
      check()
      if (!fence) fence = marker[1]
      else if (fence[0] === marker[1][0] && marker[1].length >= fence.length) fence = ""
      continue
    }
    if (fence) continue
    if (!line.trim()) { check(); continue }
    if (!paragraph.length) start = index + 1
    paragraph.push(line)
  }
  check()
  return problems
}

export function checkEditorMigrationDiagnostics(root = repo): string[] {
  const source = readFileSync(join(root, "docs/design/src/005-services.md"), "utf8").replaceAll("\x60", "")
  if (!/service class[^\n.]*reports EK0909\b/.test(source)) {
    throw new Error("review editor migration diagnostic policy against the service chapter")
  }
  return ["docs/user/src/setup/vscode.md", "docs/user/src/setup/other-editors.md"].flatMap(file =>
    editorMigrationDiagnosticProblems(readFileSync(join(root, file), "utf8"), file))
}

if (import.meta.main) {
  const missing = checkDiagnosticDocs()
  const claims = checkEditorMigrationDiagnostics()
  for (const problem of claims) console.error(problem)
  if (claims.length) process.exitCode = 1
  if (missing.length) {
    console.error("User docs have no diagnostic reference for: " + missing.join(", "))
    process.exitCode = 1
  } else console.log(`Every registered diagnostic is documented (EK4407 deferred, ${Object.keys(retiredByVips).length} retired by the VIPs).`)
}
