// Shared by the spec's existing table-row check and the user-docs check.
// A Markdown table has exactly one header row before its delimiter.
import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const cells = line => line.replace(/\\./g, "").split("|").length
const delimiter = line => /^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)


let typeScript
const nativeFileReaders = new Set(["fs.readFile", "fs.promises.readFile", "fs.readFileSync"])

// Parse options rather than mistaking a filename or nested argument for an encoding.
// Explicit text encodings and options with an unknown encoding remain outside this check.
function nativeFileReadUsesBytes(source) {
  const ts = typeScript ??= createRequire(import.meta.url)("typescript")
  const unwrap = node => {
    while (node && ts.isParenthesizedExpression(node)) node = node.expression
    return node
  }
  const staticName = node => {
    if (!node) return undefined
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text
    if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(unwrap(node.expression))) return unwrap(node.expression).text
    return undefined
  }
  const dottedName = node => {
    node = unwrap(node)
    if (!node) return undefined
    if (ts.isIdentifier(node)) return node.text
    if (ts.isPropertyAccessExpression(node)) {
      const parent = dottedName(node.expression)
      return parent && parent + "." + node.name.text
    }
    if (ts.isElementAccessExpression(node)) {
      const key = unwrap(node.argumentExpression), parent = dottedName(node.expression)
      return parent && key && ts.isStringLiteralLike(key) ? parent + "." + key.text : undefined
    }
    return undefined
  }
  const file = ts.createSourceFile("platform-table.ts", "(" + source + ")", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (file.parseDiagnostics.length) return false
  const expression = unwrap(file.statements[0]?.expression)
  if (!expression) return false
  const call = ts.isCallExpression(expression) ? expression : undefined
  if (!nativeFileReaders.has(dottedName(call?.expression ?? expression))) return false
  if (!call || !call.arguments[1]) return true
  const absent = node => {
    node = unwrap(node)
    return node && (node.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(node) && node.text === "undefined" || ts.isVoidExpression(node))
  }
  const options = unwrap(call.arguments[1])
  if (absent(options)) return true
  if (!ts.isObjectLiteralExpression(options)) return false
  if (options.properties.some(property => ts.isSpreadAssignment(property) || staticName(property.name) === undefined || staticName(property.name) === "__proto__")) return false
  const encoding = options.properties.filter(property => staticName(property.name) === "encoding").at(-1)
  return !encoding || ts.isPropertyAssignment(encoding) && absent(encoding.initializer)
}

export function tableRowProblems(text, file, { checkWidths = true, checkPlatformReplacements = false } = {}) {
  const lines = text.split("\n"), problems = []
  let fence, width = 0, platformReplacements = false
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
      const header = line.split("|").slice(1, -1).map(cell => cell.trim())
      platformReplacements = checkPlatformReplacements && ["Call|Effect|Layer", "Global|Use instead"].includes(header.join("|"))
      continue
    }
    if (delimiter(line)) continue
    if (checkWidths && cells(line) !== width) problems.push(file + ":" + (i + 1) + ": " + (cells(line) - 2) + " cells, the header has " + (width - 2))
    if (platformReplacements) {
      const row = line.split("|").slice(1, -1).map(cell => cell.trim())
      const sourceCall = row[0]?.replaceAll(String.fromCharCode(96), "")
      const call = sourceCall?.replace(/\s/g, "")
      if (/\bFileSystem\b/.test(row[1] ?? "") && /\.\s*readFileString\s*\(/.test(row[1] ?? "") &&
          nativeFileReadUsesBytes(sourceCall ?? "")) {
        problems.push(file + ":" + (i + 1) + ": the native file read supplies bytes; its replacement must not decode them as text")
      }
      // The native query reads a location. Effect's temporary directory/file
      // factories allocate resources, including their scoped variants.
      if ((call === "os.tmpdir" || call === "os.tmpdir()") &&
          /\.\s*makeTemp(?:Directory|File)(?:Scoped)?\s*\(/.test(row[1] ?? "")) {
        problems.push(file + ":" + (i + 1) + ": os.tmpdir reads the system temporary-directory location; its replacement must not create a temporary resource")
      }
      // Node Stdio supplies the user arguments after the executable and script.
      // Advice for the full native array must state that narrower replacement.
      if (/^process\.argv(?:\.slice\((?:0|1)?\))?$/.test(call ?? "") &&
          /\bStdio\b.*\.\s*args\b/.test(row[1] ?? "") &&
          !/process\s*\.\s*argv\s*\.\s*slice\s*\(\s*2\s*\)/.test(row[1] ?? "")) {
        problems.push(file + ":" + (i + 1) + ": Stdio args omit the executable and script entries; identify user arguments as process.argv.slice(2)")
      }

    }
  }
  return problems
}

export function userTableProblems(root = fileURLToPath(new URL("../user/src", import.meta.url))) {
  const pages = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(join(directory, entry.name)) : entry.name.endsWith(".md") ? [join(directory, entry.name)] : [])
  return pages(root).flatMap(file => tableRowProblems(readFileSync(file, "utf8"), file, { checkPlatformReplacements: true }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = userTableProblems()
  for (const problem of problems) console.error(problem)
  console.log("user tables: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
