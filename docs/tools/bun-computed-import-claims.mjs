import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const bunImportGuides = [
  "docs/user/src/setup/vibelang-cli.md",
  "docs/user/src/setup/developer-tools.md",
  "packages/compiler/README.md",
  "packages/unplugin/README.md"
]

const blank = text => text.replace(/[^\n]/g, " ")

// Keep offsets for diagnostics, and keep periods inside code out of sentence boundaries.
export function findComputedAliasClaims(markdown) {
  const prose = markdown
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, blank)
    .replace(/`+[^`\n]*`+/g, code => code.replace(/[.!?]/g, " "))
  const findings = []
  for (const paragraph of prose.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g)) {
    let offset = paragraph.index
    for (const sentence of paragraph[0].split(/(?<=[.!?])\s+/)) {
      const text = sentence.replace(/\s+/g, " ")
      const subject = /\bBun\s+(?:does\s+not|doesn't|never|cannot|can't|fails\s+to)\s+(?:invoke|call|trigger|run|reach)\b/i.exec(sentence)
      if (subject &&
          /\b(?:resolver hooks?|onResolve)\b/i.test(text) &&
          /\bcomputed\b/i.test(text) &&
          /\bbare (?:aliases|imports|specifiers)\b/i.test(text) &&
          !/\b(?:extensionless|without (?:a file )?extensions?)\b/i.test(text)) {
        findings.push({
          line: prose.slice(0, offset + subject.index).split("\n").length,
          message: "Qualify Bun's missing computed-alias resolver hook as extensionless; a .ts alias can reach onResolve."
        })
      }
      offset += sentence.length
      const following = paragraph[0].slice(offset - paragraph.index).match(/^\s+/)?.[0] ?? ""
      offset += following.length
    }
  }
  return findings
}

export function checkBunImportGuides(root) {
  return bunImportGuides.flatMap(path =>
    findComputedAliasClaims(readFileSync(resolve(root, path), "utf8")).map(finding => ({ path, ...finding })))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const findings = checkBunImportGuides(root)
  for (const finding of findings) console.error(finding.path + ":" + finding.line + ": " + finding.message)
  process.exitCode = findings.length ? 1 : 0
}
