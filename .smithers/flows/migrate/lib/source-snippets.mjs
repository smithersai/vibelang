import { createRequire } from "node:module"
import * as Jj from "./jj.mjs"
import { isProtectedFile } from "./test-diff.mjs"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"

const normalized = text => text.replaceAll("\r\n", "\n").replace(/\n?$/, "\n")
const hash = text => createHash("sha256").update(text).digest("hex")
const inside = path => !isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\")
const opening = line => /^ {0,3}(\x60{3,}|~{3,})[^\r\n]*$/.exec(line.trimEnd())?.[1]
const closing = (line, fence) => {
  const match = /^ {0,3}([\x60~]+)[ \t]*$/.exec(line.trimEnd())
  return match && match[1].length >= fence.length && [...match[1]].every(c => c === fence[0])
}

function blocks(text) {
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(m => m[0])
  const found = []
  for (let i = 0; i < lines.length; i++) {
    const marker = /^<!-- source: ([^#\s]+)(?:#([\w$]+))? -->$/.exec(lines[i][0].trim())
    if (marker) {
      let start = i + 1
      while (start < lines.length && !lines[start][0].trim()) start++
      const fence = start < lines.length && opening(lines[start][0])
      if (!fence) continue
      let end = start + 1
      while (end < lines.length && !closing(lines[end][0], fence)) end++
      if (end === lines.length) continue
      const from = lines[start].index + lines[start][0].length, to = lines[end].index
      found.push({ path: marker[1], fragment: marker[2], pathFrom: lines[i].index + lines[i][0].indexOf(marker[1]), pathTo: lines[i].index + lines[i][0].indexOf(marker[1]) + marker[1].length, languageFrom: lines[start].index + lines[start][0].indexOf(fence) + fence.length, languageTo: lines[start].index + lines[start][0].trimEnd().length, language: lines[start][0].trimEnd().slice(lines[start][0].indexOf(fence) + fence.length), from, to, body: text.slice(from, to), fence, eol: lines[start][0].endsWith("\r\n") ? "\r\n" : "\n" })
      i = end
    } else {
      // A marker quoted inside an ordinary code fence is only an example.
      const fence = opening(lines[i][0])
      if (fence) while (++i < lines.length && !closing(lines[i][0], fence)) {}
    }
  }
  return found
}

const typescript = root => {
  try { return createRequire(resolve(root, "package.json"))("typescript") } catch { return undefined }
}

function excerpt(file, text, name, ts) {
  if (!name) return text
  if (typeof ts === "function") { try { ts = ts() } catch { return undefined } }
  if (!ts) return undefined
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.(?:tsx|vibex)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const matches = node => ts.isVariableStatement(node)
    ? node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name)
    : (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node))
      ? node.name?.getText(source) === name
      : ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === name
  const find = node => matches(node) ? node : ts.forEachChild(node, find)
  const node = source.statements.find(matches) ?? find(source)
  if (!node) return undefined
  const lines = text.replace(/\n$/, "").split("\n")
  const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line
  const last = source.getLineAndCharacterOfPosition(node.getEnd()).line
  const above = lines.slice(0, first).findLastIndex(line => !/^\s*(\/\/|\/\*|\*)/.test(line)) + 1
  const picked = lines.slice(above, last + 1)
  const indent = Math.min(...picked.filter(line => line.trim()).map(line => /^\s*/.exec(line)[0].length))
  return picked.map(line => line.slice(indent)).join("\n") + "\n"
}

export async function captureTrackedSourceSnippets(root, { ts } = {}) {
  if (!existsSync(resolve(root, ".jj"))) return []
  return captureSourceSnippets(root, (await Jj.trackedFiles(root)).filter(file => !isProtectedFile(file)), { ts, named: true })
}

/** Capture only tracked, owned source links before setup changes any source. */
export function captureSourceSnippets(root, files, { ts, named = false } = {}) {
  const owned = new Set(files), physicalRoot = realpathSync(root), snapshots = []
  for (const doc of files.filter(file => /\.mdx?$/.test(file))) {
    const document = resolve(root, doc)
    if (!existsSync(document) || !inside(relative(physicalRoot, realpathSync(document)))) continue
    const original = readFileSync(document, "utf8"), linked = []
    for (const block of blocks(original)) {
      if (block.fragment && !named) continue
      const source = resolve(root, dirname(doc), block.path)
      const file = relative(root, source).replaceAll("\\", "/")
      if (!inside(file) || !owned.has(file) || !/\.(?:[cm]?[jt]sx?|vibex?)$/.test(file) || !existsSync(source)) continue
      if (!inside(relative(physicalRoot, realpathSync(source)))) continue
      const before = readFileSync(source, "utf8")
      const selected = excerpt(file, before, block.fragment, ts ?? (block.fragment && typescript(root)))
      if (block.fragment && (selected === undefined || normalized(block.body) !== normalized(selected))) continue
      linked.push({ ...block, source: file, before, selected: selected ?? before })
    }
    if (linked.length) snapshots.push({ doc, original, linked })
  }
  return snapshots
}

/** Refresh valid whole-file links after formatting and every setup rewrite. */
export function refreshSourceSnippets(root, snapshots, { ts, renames = [], read, write } = {}) {
  const renamed = new Map(renames.map(({ from, to }) => [from, to]))
  const changed = [], warnings = [], refreshed = []
  for (const { doc, original, linked } of snapshots) {
    const file = resolve(root, doc)
    if (!existsSync(file) || readFileSync(file, "utf8") !== original) {
      warnings.push(doc + ": source snippet document changed during setup; retain it for review")
      continue
    }
    const edits = []
    for (const block of linked) {
      const destination = renamed.get(block.source) ?? block.source
      if (!inside(destination)) continue
      const source = resolve(root, destination)
      if (!read && !existsSync(source)) continue
      if (existsSync(source) && !inside(relative(realpathSync(root), realpathSync(source)))) continue
      const after = read ? read(destination) : readFileSync(source, "utf8")
      if (after === null || after === undefined) continue
      if (after === block.before && destination === block.source) continue
      const selected = excerpt(destination, after, block.fragment, ts ?? (block.fragment && typescript(root)))
      if (selected === undefined) { warnings.push(doc + ": source snippet name no longer exists: " + destination + "#" + block.fragment); continue }
      if (normalized(block.body) !== normalized(block.selected ?? block.before)) {
        warnings.push(doc + ": source snippet for " + block.source + " did not match before setup; retain it for review")
        continue
      }
      if (selected.split("\n").some(line => closing(line, block.fence))) {
        warnings.push(doc + ": source snippet for " + block.source + " contains its closing fence; retain it for review")
        continue
      }
      edits.push({ from: block.from, to: block.to, text: normalized(selected).replaceAll("\n", block.eol) })
      if (destination !== block.source) {
        const path = relative(dirname(doc), destination).replaceAll("\\", "/")
        edits.push({ from: block.pathFrom, to: block.pathTo, text: block.path.startsWith("./") && !path.startsWith(".") ? "./" + path : path })
        if (/^(?:ts|tsx|typescript|vibe|vibex)$/.test(block.language)) {
          const language = destination.endsWith(".vibex") ? "vibex" : destination.endsWith(".vibe") ? "vibe" : destination.endsWith(".tsx") ? "tsx" : "ts"
          edits.push({ from: block.languageFrom, to: block.languageTo, text: language })
        }
      }
      refreshed.push({ doc, destination, source: block.source, before: hash(block.before), after: hash(after) })
    }
    let next = original
    for (const edit of edits.sort((a, b) => b.from - a.from)) next = next.slice(0, edit.from) + edit.text + next.slice(edit.to)
    if (next !== original) { if (write) write(doc, next); else writeFileSync(file, next); changed.push(doc) }
  }
  return { changed, warnings, refreshed }
}
