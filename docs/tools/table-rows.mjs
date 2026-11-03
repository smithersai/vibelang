// Shared by the spec's existing table-row check and the user-docs check.
// A Markdown table has exactly one header row before its delimiter.
import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const cells = line => line.replace(/\\./g, "").split("|").length
const delimiter = line => /^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)

export function tableRowProblems(text, file, { checkWidths = true } = {}) {
  const lines = text.split("\n"), problems = []
  let fence, width = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      width = 0
      continue
    }
    if (fence || !line.startsWith("|")) { width = 0; continue }
    if (width === 0) {
      if (!delimiter(lines[i + 1] ?? "")) problems.push(file + ":" + (i + 1) + ": a row outside a table")
      width = cells(line)
      continue
    }
    if (delimiter(line)) continue
    if (checkWidths && cells(line) !== width) problems.push(file + ":" + (i + 1) + ": " + (cells(line) - 2) + " cells, the header has " + (width - 2))
  }
  return problems
}

export function userTableProblems(root = fileURLToPath(new URL("../user/src", import.meta.url))) {
  const pages = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(join(directory, entry.name)) : entry.name.endsWith(".md") ? [join(directory, entry.name)] : [])
  // This user-docs rule checks row placement; the spec also checks widths.
  return pages(root).flatMap(file => tableRowProblems(readFileSync(file, "utf8"), file, { checkWidths: false }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = userTableProblems()
  for (const problem of problems) console.error(problem)
  console.log("user tables: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
