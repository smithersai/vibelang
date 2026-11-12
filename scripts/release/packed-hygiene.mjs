// Inspect the archive bytes, including source maps, rather than only staged sources.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export function productMentions(text, file) {
  const findings = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const prose = line
      .replace(/\b(?:https?:\/\/|git\+https?:\/\/)?github\.com\/smithersai\/[\w./#?=&%+~:@-]+/gi, "")
      .replace(/@[a-z0-9._~-]+\/[a-z0-9._~-]+/gi, "")
    if (/smithers|\bsmthrs\b/i.test(prose)) findings.push(`${file}:${index + 1}: ${line.slice(0, 400)}`)
  }
  return findings
}

const reviewerNames = "(?:Codex|Fable|Opus|Astra|Sol|Luna)"
const reviewerCredit = new RegExp("\\b" + reviewerNames + "\\s+(?:review\\b|R\\d+\\b|finding\\b|design\\b)"
  + "|\\b(?:reviewed\\s+by|reviewer\\s*:?|design\\s+by)\\s+" + reviewerNames + "\\b", "i")

export function reviewerMentions(text, file) {
  const findings = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (reviewerCredit.test(line) || /\breview\s+R\d+\b|\bfinding\s+\d+\b/i.test(line)) {
      findings.push(file + ":" + (index + 1) + ": [reviewer provenance] " + line.slice(0, 400))
    }
  }
  return findings
}

export function packedHygiene(archive) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-packed-hygiene-"))
  const findings = []
  try {
    execFileSync("tar", ["-xzf", archive, "-C", root])
    const walk = (dir, relative = "") => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = relative ? relative + "/" + entry.name : entry.name
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path, file)
        else if (entry.isFile()) {
          const text = readFileSync(path, "utf8")
          findings.push(...productMentions(text, file), ...reviewerMentions(text, file))
          if (file.endsWith(".map")) {
            const map = JSON.parse(text)
            for (const [index, source] of (map.sourcesContent ?? []).entries()) {
              if (source != null) {
                const location = file + "#sourcesContent[" + index + "]"
                findings.push(...productMentions(source, location), ...reviewerMentions(source, location))
              }
            }
          }
        }
      }
    }
    walk(root)
    return findings
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
