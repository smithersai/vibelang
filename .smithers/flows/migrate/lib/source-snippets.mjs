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
    const marker = /^<!-- source: ([^#\s]+) -->$/.exec(lines[i][0].trim())
    if (marker) {
      let start = i + 1
      while (start < lines.length && !lines[start][0].trim()) start++
      const fence = start < lines.length && opening(lines[start][0])
      if (!fence) continue
      let end = start + 1
      while (end < lines.length && !closing(lines[end][0], fence)) end++
      if (end === lines.length) continue
      const from = lines[start].index + lines[start][0].length, to = lines[end].index
      found.push({ path: marker[1], from, to, body: text.slice(from, to), fence, eol: lines[start][0].endsWith("\r\n") ? "\r\n" : "\n" })
      i = end
    } else {
      // A marker quoted inside an ordinary code fence is only an example.
      const fence = opening(lines[i][0])
      if (fence) while (++i < lines.length && !closing(lines[i][0], fence)) {}
    }
  }
  return found
}

/** Capture only tracked, owned source links before setup changes any source. */
export function captureSourceSnippets(root, files) {
  const owned = new Set(files), physicalRoot = realpathSync(root), snapshots = []
  for (const doc of files.filter(file => /\.mdx?$/.test(file))) {
    const document = resolve(root, doc)
    if (!existsSync(document) || !inside(relative(physicalRoot, realpathSync(document)))) continue
    const original = readFileSync(document, "utf8"), linked = []
    for (const block of blocks(original)) {
      const source = resolve(root, dirname(doc), block.path)
      const file = relative(root, source).replaceAll("\\", "/")
      if (!inside(file) || !owned.has(file) || !/\.(?:[cm]?[jt]sx?|vibex?)$/.test(file) || !existsSync(source)) continue
      if (!inside(relative(physicalRoot, realpathSync(source)))) continue
      linked.push({ ...block, source: file, before: readFileSync(source, "utf8") })
    }
    if (linked.length) snapshots.push({ doc, original, linked })
  }
  return snapshots
}

/** Refresh valid whole-file links after formatting and every setup rewrite. */
export function refreshSourceSnippets(root, snapshots) {
  const changed = [], warnings = [], refreshed = []
  for (const { doc, original, linked } of snapshots) {
    const file = resolve(root, doc)
    if (!existsSync(file) || readFileSync(file, "utf8") !== original) {
      warnings.push(doc + ": source snippet document changed during setup; retain it for review")
      continue
    }
    const edits = []
    for (const block of linked) {
      const source = resolve(root, block.source)
      if (!existsSync(source)) continue
      const after = readFileSync(source, "utf8")
      if (after === block.before) continue
      if (normalized(block.body) !== normalized(block.before)) {
        warnings.push(doc + ": source snippet for " + block.source + " did not match before setup; retain it for review")
        continue
      }
      if (after.split("\n").some(line => closing(line, block.fence))) {
        warnings.push(doc + ": source snippet for " + block.source + " contains its closing fence; retain it for review")
        continue
      }
      edits.push({ from: block.from, to: block.to, text: normalized(after).replaceAll("\n", block.eol) })
      refreshed.push({ doc, source: block.source, before: hash(block.before), after: hash(after) })
    }
    let next = original
    for (const edit of edits.sort((a, b) => b.from - a.from)) next = next.slice(0, edit.from) + edit.text + next.slice(edit.to)
    if (next !== original) { writeFileSync(file, next); changed.push(doc) }
  }
  return { changed, warnings, refreshed }
}
