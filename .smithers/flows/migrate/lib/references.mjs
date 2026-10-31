// Non-import paths (scripts, build entrypoints and configuration) that follow a rename.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { packageDirOf } from "./codemod.mjs"
import { commentRanges, parseImports } from "./imports.mjs"
import { isDeclarationFile } from "./util.mjs"

const token = /(?<![\w@/.$-])((?:\.{1,2}\/)*[\w@][\w@.\/-]*?)\.ts(?![\w.\/-])/g
const eligible = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|jsonc|ya?ml|toml|sh|nix|vibe)$/
const strings = /(["'`])([^"'\`\s]*?)\.(ts|js|vibe)\1/g
const code = /\.(?:[cm]?[jt]sx?|vibe)$/
const literal = /(["'`])(?:\\.|(?!\1)[^\\])*?\1/g
function commentsOf(file,source) {
  const comments = commentRanges(source)
  if (/\.(?:sh|ya?ml|toml|nix)$/.test(file)) {
    const quoted = [...source.matchAll(literal)]
    for (const m of source.matchAll(/#[^\n]*/g)) if (!quoted.some(q=>q.index<=m.index && m.index<q.index+q[0].length)) comments.push([m.index,m.index+m[0].length])
  }
  return comments
}
const moduleCall = before => /\b(?:vi\.(?:mock|doMock|importActual|importMock|unmock)|require(?:\.resolve)?)\s*(?:<[^>]*>)?\s*\(\s*$/.test(before)
const testFile = /(^|\/)(?:tests?|__tests__|fixtures?|__fixtures__|e2e)\/|\.(?:test|spec)\.[^/]+$/

function pathTarget(root, file, source, at, whole, stem) {
  const before = source.slice(Math.max(0, at - 200), at)
  if (/\brequire\.resolve\s*\(\s*$/.test(before)) return posix.normalize(posix.join(posix.dirname(file),stem)) + ".ts"
  const call = /(?:\bnew\s+URL|\b(?:[\w$]+\.)?(?:join|resolve))\s*\([^()]*$/.exec(before)?.[0]
  if (call) {
    if (/new\s+URL/.test(call)) {
      if (!/^\s*,\s*import\.meta\.url\b/.test(source.slice(at + whole.length))) return null
    } else if (!/\(\s*(?:__dirname|import\.meta\.dirname)\s*,\s*$/.test(call)) return null
    return posix.normalize(posix.join(posix.dirname(file), stem)) + ".ts"
  }
  if (stem.startsWith("./") || stem.startsWith("../")) return posix.normalize(posix.join(posix.dirname(file), stem)) + ".ts"
  if (stem.includes("/")) return posix.normalize(posix.join(packageDirOf(root, file), stem)) + ".ts"
  return null
}

// Calls enclosing the literal, including multiline readFile(new URL(...)).
function readsText(source, at) {
  const masked = source.replace(/(["'`])(?:\\.|(?!\1)[^\\])*?\1|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => " ".repeat(m.length))
  const stack = []
  for (const m of masked.slice(0, at).matchAll(/\b(?:readFileSync|readFile|Bun\.file)\s*\(|[()]/g)) {
    if (m[0] === ")") stack.pop()
    else stack.push(m[0] !== "(")
  }
  return stack.includes(true)
}

export function pathReadDeferrals(root, modules, files) {
  const want = new Set(modules), causes = new Map()
  for (const file of files) {
    if (!code.test(file) || !testFile.test(file) || !existsSync(join(root,file))) continue
    const source = readFileSync(join(root,file),"utf8"), comments = commentRanges(source), imports = parseImports(source)
    for (const m of source.matchAll(strings)) {
      if (m[3] !== "ts") continue
      if (comments.some(([a,b]) => a <= m.index && m.index < b) || imports.some(i => i.start <= m.index && m.index < i.end)) continue
      const target = pathTarget(root,file,source,m.index,m[0],m[2])
      if (want.has(target) && readsText(source,m.index)) causes.set(target,{ file: target, reason: "PATHNAME-READS: " + file + ":" + source.slice(0,m.index).split("\n").length + " asserts on the source text; keep .ts (detail 272 addendum 4)" })
    }
  }
  return [...causes.values()]
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function rewriteReferences(root, renames, files, { read = file => existsSync(join(root,file)) ? readFileSync(join(root,file),"utf8") : null, write = (file,text) => writeFileSync(join(root,file),text) } = {}) {
  const moved = new Set(renames.map(r => r.from))
  const all = new Set(files.map(f => f.endsWith(".vibe") && moved.has(f.replace(/\.vibe$/, ".ts")) ? f.replace(/\.vibe$/, ".ts") : f))
  const edits = []
  for (const file of files) {
    if (!eligible.test(file) || isDeclarationFile(file) || /(^|\/)node_modules\//.test(file)) continue
    const path = join(root, file)
    const source = read(file)
    if (source === null) continue
    const imports = parseImports(source)
    const comments = commentsOf(file,source)
    const changes = []
    const quoted = [...source.matchAll(code.test(file) ? literal : strings)]
    source.replace(strings, (whole, q, stem, ext, offset) => {
      if (ext === "js" && !moduleCall(source.slice(Math.max(0,offset-150),offset))) return whole
      if (comments.some(([a,b]) => a <= offset && offset < b) || imports.some(i => offset >= i.start && offset < i.end)) return whole
      const module = pathTarget(root, file, source, offset, whole, stem)
      if (!moved.has(module)) return whole
      if (testFile.test(file) && readsText(source,offset)) throw new Error("source text test requires .ts: " + module)
      const to = stem + ".vibe", from = stem + "." + ext
      edits.push({ file, from, to, module, quoted: true })
      changes.push({start:offset,end:offset+whole.length,text:q+to+q})
      return whole
    })
    // Shell commands and configuration command values retain their existing path support.
    // Offsets below refer to the original source; collect edits before applying.
    source.replace(token, (from, stem, offset) => {
      if (quoted.some(m => m.index <= offset && offset < m.index + m[0].length)) return from
      if (comments.some(([start, end]) => start <= offset && offset < end)) return from
      if (imports.some(i => offset >= i.start && offset < i.end)) return from
      const tries = [posix.join(posix.dirname(file), stem), posix.join(packageDirOf(root, file), stem), posix.normalize(stem)].map(x => posix.normalize(x) + ".ts")
      let module = tries.find(x => all.has(x))
      if (!module && stem.includes("/") && !stem.startsWith(".")) {
        const matches = [...all].filter(f => f.endsWith("/" + stem + ".ts"))
        if (matches.length === 1) module = matches[0]
      }
      if (!moved.has(module)) return from
      const to = stem + ".vibe"
      edits.push({ file, from, to, module })
      changes.push({start:offset,end:offset+from.length,text:to})
      return to
    })
    let next = source
    for (const edit of changes.sort((a,b)=>b.start-a.start)) next = next.slice(0,edit.start)+edit.text+next.slice(edit.end)
    if (next !== source) write(file, next)
  }
  return edits
}

export function restoreReferences(root, edits, module) {
  const restored = []
  for (const edit of edits.filter(e => e.module === module)) {
    // An importer in the same bulk revert may already be back to .ts.
    const file = existsSync(join(root, edit.file)) ? edit.file : edit.file.replace(/\.vibe$/, ".ts")
    if (!existsSync(join(root, file))) throw new Error(`path-reference importer missing: ${edit.file}`)
    const source = readFileSync(join(root, file), "utf8")
    const comments = commentsOf(file,source)
    const next = edit.quoted ? source.replace(strings, (whole,q,stem,ext,at) => {
      if (comments.some(([a,b]) => a <= at && at < b)) return whole
      return stem + "." + ext === edit.to && pathTarget(root,file,source,at,whole,stem) === module ? q + edit.from + q : whole
    }) : source.replace(new RegExp("(?<![\\w@/.$-])" + escape(edit.to) + "(?![\\w.\\/-])", "g"), (match, offset) => comments.some(([start, end]) => start <= offset && offset < end) ? match : edit.from)
    if (next !== source) { writeFileSync(join(root, file), next); restored.push({ ...edit, file }) }
  }
  return restored
}

