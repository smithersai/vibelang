// Non-import paths (scripts, build entrypoints and configuration) that follow a rename.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { packageDirOf } from "./codemod.mjs"
import { commentRanges, parseImports } from "./imports.mjs"
import { isDeclarationFile } from "./util.mjs"

const token = /(?<![\w@/.$-])((?:\.{1,2}\/)*[\w@][\w@.\/-]*?)\.(tsx?)(?![\w.\/-])/g
const eligible = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|jsonc|ya?ml|toml|sh|nix|vibe|vibex)$/
const strings = /(["'`])([^"'\`\s]*?)\.(tsx?|js|vibex?)\1/g
// The sources a literal's extension can name: x.js names a module of either kind.
const namedSources = { ts: [".ts"], vibe: [".ts"], tsx: [".tsx"], vibex: [".tsx"], js: [".ts", ".tsx"] }
const code = /\.(?:[cm]?[jt]sx?|vibex?)$/
const literal = /(["'`])(?:\\.|(?!\1)[^\\])*?\1/g
// Ranges arrive in source order from commentRanges or matchAll. Build the
// masked text once so documentation-heavy generated modules take linear work.
function maskRanges(source, ranges) {
  const parts = []
  let cursor = 0
  for (const [start, end] of ranges) {
    parts.push(source.slice(cursor, start), " ".repeat(end - start))
    cursor = end
  }
  parts.push(source.slice(cursor))
  return parts.join("")
}

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

function pathTarget(root, file, source, at, whole, stem, extension) {
  const before = source.slice(Math.max(0, at - 200), at)
  if (/\brequire\.resolve\s*\(\s*$/.test(before)) return posix.normalize(posix.join(posix.dirname(file),stem)) + extension
  const call = /(?:\bnew\s+URL|\b(?:[\w$]+\.)?(?:join|resolve))\s*\([^()]*$/.exec(before)?.[0]
  if (call) {
    if (/new\s+URL/.test(call)) {
      if (!/^\s*,\s*import\.meta\.url\b/.test(source.slice(at + whole.length))) return null
    } else if (!/\(\s*(?:__dirname|import\.meta\.dirname)\s*,\s*$/.test(call)) return null
    return posix.normalize(posix.join(posix.dirname(file), stem)) + extension
  }
  if (stem.startsWith("./") || stem.startsWith("../")) return posix.normalize(posix.join(posix.dirname(file), stem)) + extension
  if (stem.includes("/")) return posix.normalize(posix.join(packageDirOf(root, file), stem)) + extension
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

// Bundle metadata exposes resolved source filenames too. Conservatively retain
// the package when a protected test names an owned input: routing an unrelated
// migration can otherwise move that native input into the emitted graph.
// This is a scope restriction, not a rewrite of the test or the runtime graph.
function observesBundleInputs(source, comments) {
  const masked = maskRanges(source, comments)
  const quoted = [...masked.matchAll(literal)]
  const code = maskRanges(masked, quoted.map(m => [m.index, m.index + m[0].length]))
  const names = new Set(code.match(/\b(?:metafile|inputs)\b/g) ?? [])
  for (const m of quoted) {
    const name = m[0].slice(1,-1)
    if ((name === "metafile" || name === "inputs") && /\[\s*$/.test(code.slice(0,m.index)) && /^\s*\]/.test(code.slice(m.index+m[0].length))) names.add(name)
  }
  return names.has("metafile") && names.has("inputs")
}

// A runtime host can derive virtual module names from a resolved entry's
// directory and extension. Renaming or relocating any source changes that
// enumeration, even when a disconnected native export keeps its path.
function observesRuntimeEnumeration(source, comments) {
  let masked = maskRanges(source, comments)
  const names = new Set()
  masked = masked.replace(literal, text => {
    names.add(text.slice(1,-1))
    return " ".repeat(text.length)
  })
  const resolver = /\b(?:Bun\s*\.\s*resolveSync|require\s*\.\s*resolve|import\s*\.\s*meta\s*\.\s*resolve)\s*\(/.exec(masked)
  const enumerate = /\b(?:scanSync|scan|readdirSync|readdir)\s*\(/.test(masked)
  const extension = /\bextname\s*\(/.test(masked)
  return resolver && enumerate && extension ? { at: resolver.index, names } : null
}

// A regex literal: after an operator, never a division after a value.
const regexLiteral = /(^|[(,=:[!&|?{};]|\breturn)(\s*)\/(?![*/])((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuvy]*)/g

// A test may assert a module's file name with a pattern, as
// assert.match(hook, /scripts[\\/]lib[\\/]windows-jsign\.ts$/) does on an
// electron-builder hook path. Renaming the module fails that unchanged oracle.
// A pattern names a module when it matches the module's path, not its native
// path, and not a sibling's: /\.tsx?$/ selects every module and is widened by
// regex-selectors, not deferred.
function filenamePatterns(source, comments) {
  const masked = maskRanges(source, comments)
  const code = maskRanges(masked, [...masked.matchAll(literal)].map(m => [m.index, m.index + m[0].length]))
  const patterns = []
  for (const m of code.matchAll(regexLiteral)) {
    const at = m.index + m[1].length + m[2].length, text = source.slice(at + 1, at + 1 + m[3].length)
    try { patterns.push({ at, text: text.replaceAll("\\", ""), re: new RegExp(text, m[4].replace(/[gy]/g, "")) }) } catch {}
  }
  return patterns
}

// A module's path, file stem and native path, for namesModule.
function patternTarget(module) {
  const ext = posix.extname(module)
  return { module, stem: posix.basename(module, ext), native: module.slice(0, -ext.length) + (ext === ".tsx" ? ".vibex" : ".vibe"), sibling: posix.join(posix.dirname(module), "vibelang-sibling" + ext) }
}

function namesModule(pattern, { module, stem, native, sibling }) {
  if (!pattern.text.includes(stem)) return false
  const matches = path => pattern.re.test(path) || pattern.re.test("/" + path)
  return matches(module) && !matches(native) && !matches(sibling)
}

export function pathReadDeferrals(root, modules, files, { pinned } = {}) {
  const want = new Set(modules), available = new Set(files), causes = new Map(), inputs = new Map()
  let modulesOf = null
  for (const file of files) {
    if (!code.test(file) || !existsSync(join(root,file))) continue
    const source = readFileSync(join(root,file),"utf8"), comments = commentRanges(source), imports = parseImports(source)
    const enumeration = observesRuntimeEnumeration(source, comments)
    if (enumeration) {
      const owned = new Set([packageDirOf(root,file)])
      for (const candidate of modules) {
        const dir = packageDirOf(root,candidate), manifest = join(root,dir,"package.json")
        if (existsSync(manifest) && enumeration.names.has(JSON.parse(readFileSync(manifest,"utf8")).name)) owned.add(dir)
      }
      for (const candidate of modules) if (owned.has(packageDirOf(root,candidate))) causes.set(candidate,{
        file:candidate, reason:"RUNTIME-SOURCE-ENUMERATION: "+file+":"+source.slice(0,enumeration.at).split("\n").length+" derives runtime module names from a resolved entry's directory and extension; keep this package native (VIP-34)"
      })
    }
    if (!testFile.test(file)) continue
    // A test observes its own package's modules: /adapter\.(ts|js)$/ in one
    // package names no other package's adapter.
    if (!modulesOf) {
      modulesOf = new Map()
      for (const target of want) if (/\.tsx?$/.test(target)) {
        const dir = packageDirOf(root,target)
        if (!modulesOf.has(dir)) modulesOf.set(dir, [])
        modulesOf.get(dir).push(patternTarget(target))
      }
    }
    for (const pattern of filenamePatterns(source, comments)) for (const target of modulesOf.get(packageDirOf(root,file)) ?? []) {
      if (!causes.has(target.module) && namesModule(pattern, target)) causes.set(target.module,{ file: target.module, reason: "PATHNAME-PATTERN: " + file + ":" + source.slice(0,pattern.at).split("\n").length + " matches its file name with a pattern; keep .ts (detail 272 addendum 4)" })
    }
    const bundleInputs = observesBundleInputs(source, comments)
    for (const m of source.matchAll(strings)) {
      if (!/^tsx?$/.test(m[3])) continue
      if (comments.some(([a,b]) => a <= m.index && m.index < b) || imports.some(i => i.start <= m.index && m.index < i.end)) continue
      const target = pathTarget(root,file,source,m.index,m[0],m[2],"." + m[3])
      if (bundleInputs && !moduleCall(source.slice(Math.max(0,m.index-150),m.index))) {
        // Metafiles may use a package or repository working directory.
        // Retain every statically identified owner when those bases overlap.
        const targets = new Set([target, posix.normalize(m[2] + "." + m[3])])
        if (m[2].startsWith(root + "/")) targets.add(m[2].slice(root.length+1) + "." + m[3])
        for (const observed of targets) if (available.has(observed)) {
          if (pinned) {
            inputs.set(file, (inputs.get(file) ?? new Set()).add(observed))
            continue
          }
          const owner = packageDirOf(root,observed)
          for (const candidate of modules) if (packageDirOf(root,candidate) === owner) causes.set(candidate,{
            file: candidate, reason: "BUNDLE-INPUT-PATHS: " + file + ":" + source.slice(0,m.index).split("\n").length + " observes " + observed + "; keep this package native to preserve input filenames (detail 272)"
          })
        }
      }
      if (want.has(target) && readsText(source,m.index)) causes.set(target,{ file: target, reason: "PATHNAME-READS: " + file + ":" + source.slice(0,m.index).split("\n").length + " asserts on the source text; keep .ts (detail 272 addendum 4)" })
    }
  }
  for (const [reader, observed] of inputs) for (const candidate of pinned(observed)) if (want.has(candidate) && !causes.has(candidate)) causes.set(candidate,{
    file: candidate, reason: "BUNDLE-INPUT-PATHS: " + reader + " observes " + [...observed].sort().join(", ") + "; keep this module native to preserve input filenames (detail 272)"
  })
  return [...causes.values()]
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const sourceOf = file => file.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")

export function rewriteReferences(root, renames, files, { read = file => existsSync(join(root,file)) ? readFileSync(join(root,file),"utf8") : null, write = (file,text) => writeFileSync(join(root,file),text), literals = true } = {}) {
  const moved = new Set(renames.map(r => r.from))
  const all = new Set(files.map(f => /\.vibex?$/.test(f) && moved.has(sourceOf(f)) ? sourceOf(f) : f))
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
      if (!literals) return whole
      if (ext === "js" && !moduleCall(source.slice(Math.max(0,offset-150),offset))) return whole
      if (comments.some(([a,b]) => a <= offset && offset < b) || imports.some(i => offset >= i.start && offset < i.end)) return whole
      const module = namedSources[ext].map(extension => pathTarget(root, file, source, offset, whole, stem, extension)).find(path => moved.has(path))
      if (!module) return whole
      if (testFile.test(file) && readsText(source,offset)) throw new Error("source text test requires .ts: " + module)
      const to = stem + (module.endsWith(".tsx") ? ".vibex" : ".vibe"), from = stem + "." + ext
      edits.push({ file, from, to, module, quoted: true })
      changes.push({start:offset,end:offset+whole.length,text:q+to+q})
      return whole
    })
    // Shell commands and configuration command values retain their existing path support.
    // Offsets below refer to the original source; collect edits before applying.
    source.replace(token, (from, stem, extension, offset) => {
      if (quoted.some(m => m.index <= offset && offset < m.index + m[0].length)) return from
      if (comments.some(([start, end]) => start <= offset && offset < end)) return from
      if (imports.some(i => offset >= i.start && offset < i.end)) return from
      const tries = [posix.join(posix.dirname(file), stem), posix.join(packageDirOf(root, file), stem), posix.normalize(stem)].map(x => posix.normalize(x) + "." + extension)
      let module = tries.find(x => all.has(x))
      if (!module && stem.includes("/") && !stem.startsWith(".")) {
        const matches = [...all].filter(f => f.endsWith("/" + stem + "." + extension))
        if (matches.length === 1) module = matches[0]
      }
      if (!moved.has(module)) return from
      const to = stem + (extension === "tsx" ? ".vibex" : ".vibe")
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
    const file = existsSync(join(root, edit.file)) ? edit.file : sourceOf(edit.file)
    if (!existsSync(join(root, file))) throw new Error(`path-reference importer missing: ${edit.file}`)
    const source = readFileSync(join(root, file), "utf8")
    const comments = commentsOf(file,source)
    const next = edit.quoted ? source.replace(strings, (whole,q,stem,ext,at) => {
      if (comments.some(([a,b]) => a <= at && at < b)) return whole
      return stem + "." + ext === edit.to && pathTarget(root,file,source,at,whole,stem,posix.extname(module)) === module ? q + edit.from + q : whole
    }) : source.replace(new RegExp("(?<![\\w@/.$-])" + escape(edit.to) + "(?![\\w.\\/-])", "g"), (match, offset) => comments.some(([start, end]) => start <= offset && offset < end) ? match : edit.from)
    if (next !== source) { writeFileSync(join(root, file), next); restored.push({ ...edit, file }) }
  }
  return restored
}

