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

// The codes of forms the VIPs (docs/design/vips) remove or respell. The user docs
// describe the VIP language, so these have no reference until the compiler retires
// or respells them; delete an entry when its code goes.
export const retiredByVips: Record<string, string> = {
  EK1004: "VIP-8: using keeps TypeScript's meaning",
  EK1008: "VIP-23: the topic is the Effect value, with no by-name operand",
  EK1022: "VIP-11: no block params",
  EK2005: "VIP-35: handlers are open",
  EK2006: "VIP-5: effect code has no try statements",
  EK2103: "VIP-9: service X: T is not a form",
  EK2104: "VIP-11: no layer declarations",
  EK2105: "VIP-5: no typed catch clauses",
  EK2107: "VIP-35: handlers are open",
  EK2110: "VIP-35: handlers are open",
  EK2113: "VIP-5: no catch clauses in effect code",
  EK2116: "VIP-2: factories return Effect values, not programs",
  EK2117: "VIP-13: an error never extends another error",
  EK2120: "VIP-9: no service class spelling",
  EK2121: "VIP-11: no layer declarations",
  EK3202: "VIP-24: wire is denied",
  EK4202: "VIP-35: handlers are open",
  EK4405: "VIP-6: no hatches",
  EK4501: "no VIP adds data-type method calls",
  EK4601: "VIP-5: await is only for Promises",
  EK4602: "VIP-5: await is only for Promises",
  EK4604: "VIP-6: no hatches",
  EK4607: "VIP-18: no select",
  EK4608: "VIP-18: try.race and its siblings take arrays",
  EK4612: "VIP-6: no hatches",
  EK4706: "VIP-16: variants are matched with object patterns",
  EK4707: "VIP-16: variants are matched with object patterns",
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

if (import.meta.main) {
  const missing = checkDiagnosticDocs()
  if (missing.length) {
    console.error("User docs have no diagnostic reference for: " + missing.join(", "))
    process.exitCode = 1
  } else console.log(`Every registered diagnostic is documented (EK4407 deferred, ${Object.keys(retiredByVips).length} retired by the VIPs).`)
}
