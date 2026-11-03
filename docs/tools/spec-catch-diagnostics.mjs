// VIP-5 and Appendix A: closed handlers reject a trailing call/member access.
// Keep every published diagnostic surface in sync with the grammar boundary.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const paths = [
  "docs/design/vips/0005-try-runs-effects.md",
  "docs/design/src/002-running.md",
  "docs/design/src/900-appendices.md",
]
export const closedForms = [
  "parenthesized handler", "function-expression handler", "block-bodied arrow handler",
]
const normalize = text => text.replaceAll("-", " ").replace(/\s+/g, " ").toLowerCase()

export function checkClosedCatchDiagnostics(sources) {
  const findings = []
  for (const path of paths) {
    const text = sources.get(path) ?? ""
    const lines = text.split("\n")
    const index = lines.findIndex(line => path.includes("/vips/")
      ? normalize(line).includes("remaining `catch` grammar code")
      : line.startsWith("|") && line.includes("`EK0512`"))
    if (index < 0) {
      findings.push({ path, line: 1, message: "missing EK0512 diagnostic rule" })
      continue
    }
    const rule = normalize(lines[index])
    for (const form of closedForms) {
      if (!rule.includes(normalize(form))) findings.push({
        path, line: index + 1, message: "EK0512 omits " + form,
      })
    }
    if (!rule.includes("parenthesize the whole catch expression")) findings.push({
      path, line: index + 1, message: "EK0512 must repair the whole catch expression",
    })
  }
  return findings
}

export function loadClosedCatchSources(root) {
  return new Map(paths.map(path => [path, readFileSync(resolve(root, path), "utf8")]))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? fileURLToPath(new URL("../../", import.meta.url))
  const findings = checkClosedCatchDiagnostics(loadClosedCatchSources(root))
  for (const f of findings) console.error(f.path + ":" + f.line + ": " + f.message)
  if (findings.length) process.exitCode = 1
  else console.log("closed catch diagnostic contracts: pass")
}
