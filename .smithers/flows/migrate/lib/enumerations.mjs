// Code that enumerates a folder's *.ts files. vibelang writes x.d.vibe.ts
// beside each x.vibe (VIP-27), and such code selects that sidecar as a
// module, as Smithers' test/coding-stable-plan.test.ts:57 did: it keeps
// `path.endsWith(".ts") && !path.endsWith(".d.ts")` and imports each file.
// Setup moves the sidecars into vibe.sidecarDir where it finds such code, and
// the plan keeps the .ts modules it enumerates as .ts, because a selector of
// *.ts files no longer selects x.vibe (decided detail 268).
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, posix, relative } from "node:path"
import { sidecarSettings, sidecarRootLayout } from "./sidecar-config.mjs"
export { removeSupersededSidecars, sidecarSettings } from "./sidecar-config.mjs"

/** The directory setup names in vibe.sidecarDir and adds to rootDirs. */
export const sidecarDirectory = ".vibe/declarations"

const code = /\.(?:[cm]?[jt]sx?)$/
// A glob whose last segment is *.ts or *.{…ts…}: its * also matches x.d.vibe,
// unlike *.test.ts or *.d.ts.
const tsGlob = /(["'`])((?:[^"'`\s]*\/)?\*{1,2}(?:\/\*)?\.(?:ts|\{[^}"'`]*\bts\b[^}"'`]*\}))\1/g
// A .ts filter on names a walk lists.
const tsFilter = /\.endsWith\(\s*(["'`])\.ts\1\s*\)|\/\\\.ts\$\/|\/\\\.\(\?:?[^/]*\bts\b[^/]*\)\$\/|extname\([^()]*\)\s*===?\s*(["'`])\.ts\2/
const walkNames = ["readdirSync", "readdir", "opendirSync", "opendir", "globSync", "glob", "Glob", "walk", "walkSync", "scandir"]
const walks = new RegExp(`\\b(?:${walkNames.join("|")})\\b`)
// A glob's first argument is a pattern; it walks its `cwd` option.
const globNames = new Set(["globSync", "glob", "Glob"])
// The selector already knows the sidecars or the .vibe sources.
const vibeAware = /\.d\.vibe\.ts|endsWith\(\s*["'`]\.vibe["'`]|\\\.vibe\b|\*\.vibe\b|\{[^}]*\bvibe\b[^}]*\}/

const lineOf = (text, index) => text.slice(0, index).split("\n").length

// The flow's own TypeScript, as the codemod loads it, when the caller passes none.
const defaultTypeScript = () => {
  for (const dir of ["../../../../packages/runtime/", "../../../../docs/tools/"]) {
    try { return createRequire(new URL(dir + "package.json", import.meta.url))("typescript") } catch {}
  }
  throw new Error("no TypeScript compiler API to read walks; run (cd packages/runtime && bun install --frozen-lockfile)")
}

/**
 * The folder each walk call in source starts at, relative to the file's own
 * folder, or null where its argument is no literal root: new URL("../coding/",
 * import.meta.url), join(import.meta.dirname | __dirname, "coding"), either
 * through a const, or a parameter every other caller passes the same root.
 */
function walkRoots(ts, file, text) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?jsx?$/.test(file) ? (/x$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.JS) : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const nameOf = node => ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : undefined
  const literal = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null
  const metaDir = node => ts.isIdentifier(node) && node.text === "__dirname" ||
    ts.isPropertyAccessExpression(node) && ["dirname", "dir"].includes(node.name.text) && ts.isMetaProperty(node.expression)
  const metaUrl = node => ts.isPropertyAccessExpression(node) && node.name.text === "url" && ts.isMetaProperty(node.expression)
  const declarations = new Map()
  const calls = []
  const visit = node => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      if (!declarations.has(node.name.text)) declarations.set(node.name.text, [])
      declarations.get(node.name.text).push(node)
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const declared = name => declarations.get(name)?.length === 1 ? declarations.get(name)[0] : null
  const rootOf = (node, seen) => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node)) node = node.expression
    if (metaDir(node)) return "."
    if (ts.isPropertyAccessExpression(node) && node.name.text === "pathname") return rootOf(node.expression, seen)
    if (ts.isNewExpression(node) && nameOf(node.expression) === "URL" && node.arguments?.length === 2 && metaUrl(node.arguments[1])) return literal(node.arguments[0])
    if (!ts.isCallExpression(node) && !ts.isIdentifier(node)) return null
    if (ts.isCallExpression(node)) {
      const callee = nameOf(node.expression)
      if (callee === "fileURLToPath" && node.arguments.length === 1) return rootOf(node.arguments[0], seen)
      if (!["join", "resolve"].includes(callee) || !node.arguments.length) return null
      const base = rootOf(node.arguments[0], seen)
      if (base === null) return null
      // A part the code computes names a folder under the root: the root covers it.
      const parts = []
      for (const part of node.arguments.slice(1)) { const text = literal(part); if (text === null) break; parts.push(text) }
      return posix.join(base, ...parts)
    }
    const declaration = declared(node.text)
    if (!declaration || seen.has(declaration)) return null
    seen = new Set(seen).add(declaration)
    if (ts.isVariableDeclaration(declaration)) {
      const constant = ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const
      return constant && declaration.initializer ? rootOf(declaration.initializer, seen) : null
    }
    if (!ts.isParameter(declaration)) return null
    // A parameter: the roots every caller outside the function passes.
    const fn = declaration.parent, index = fn.parameters.indexOf(declaration)
    const name = fn.name && ts.isIdentifier(fn.name) ? fn.name.text : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : undefined
    if (!name || declaration.dotDotDotToken || declared(name) !== (ts.isFunctionDeclaration(fn) ? fn : fn.parent)) return null
    const roots = new Set()
    for (const call of calls) {
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== name) continue
      let inside = false
      for (let up = call.parent; up && !inside; up = up.parent) inside = up === fn
      if (inside) continue
      if (!call.arguments[index]) return null
      roots.add(rootOf(call.arguments[index], seen))
    }
    return roots.size === 1 ? [...roots][0] : null
  }
  const found = []
  for (const call of calls) {
    const callee = nameOf(call.expression)
    if (!walkNames.includes(callee)) continue
    let start = call.arguments?.[0]
    if (globNames.has(callee)) {
      const options = call.arguments?.[1]
      const cwd = options && ts.isObjectLiteralExpression(options) && options.properties.find(p => ts.isPropertyAssignment(p) && nameOf(p.name) === "cwd")
      start = cwd?.initializer
    }
    found.push({ index: call.getStart(source), root: start ? rootOf(start, new Set()) : null })
  }
  return found
}

// A glob that walks folders for a file name or a compound suffix, as drizzle-kit's
// schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"]. A sidecar never matches it, so
// no sidecar directory follows; the module keeps its name for the tool that reads it.
const namedGlob = /(["'`])((?:[^"'`\s*]*\/)?\*\*\/(\*\.)?([\w-]+(?:\.[\w-]+)*)\.[cm]?ts)\1/g
const testSuffix = /^(?:test|spec|d|stories|bench|e2e)$/

/**
 * The places code selects modules by a named glob. Each finding has the file,
 * its line, what matched, the folder it walks and `named`, a test of a file's
 * base name. Test-suffix globs are skipped: tests already keep their names.
 */
export function namedSelectors(files, read) {
  const findings = [], tracked = new Set(files)
  const packageOf = (file) => {
    let dir = posix.dirname(file)
    while (dir !== "." && !tracked.has(posix.join(dir, "package.json"))) dir = posix.dirname(dir)
    return dir
  }
  for (const file of files) {
    if (!code.test(file) || /\.d\.[cm]?ts$/.test(file) || /(?:^|\/)node_modules\//.test(file)) continue
    const text = read(file) ?? ""
    for (const match of text.matchAll(namedGlob)) {
      if (match[3] && testSuffix.test(match[4])) continue
      const prefix = match[2].slice(0, match[2].indexOf("**")).replace(/\/$/, "")
      const base = match[2].startsWith(".") ? posix.dirname(file) : packageOf(file)
      const escaped = match[4].replace(/\./g, "\\.")
      findings.push({ file, line: lineOf(text, match.index), match: match[2], kind: "named", directory: posix.normalize(posix.join(base, prefix)), named: new RegExp((match[3] ? "\\." : "^") + escaped + "\\.[cm]?ts$") })
    }
  }
  return findings
}

/**
 * The places tracked code enumerates *.ts files. files are the repository's
 * tracked paths; read returns a file's text. Each finding has the
 * enumerating file, its line, what matched, and the folder it enumerates
 * (repository-relative), else the enumerating file's package folder. A walk
 * filtered by .ts is found for each walk call in the file, at the folder its
 * own argument names. ts is TypeScript's compiler API.
 */
export function tsEnumerations(files, read, ts = undefined) {
  const findings = []
  const tracked = new Set(files)
  const packageOf = (file) => {
    let dir = posix.dirname(file)
    while (dir !== "." && !tracked.has(posix.join(dir, "package.json"))) dir = posix.dirname(dir)
    return dir
  }
  for (const file of files) {
    const yaml = /\.ya?ml$/.test(file)
    const scanned = code.test(file) && !/\.d\.[cm]?ts$/.test(file) || posix.basename(file) === "package.json" || yaml
    if (!scanned || /(?:^|\/)node_modules\//.test(file)) continue
    const text = read(file)
    if (text === undefined || vibeAware.test(text)) continue
    if (yaml) {
      const language = /^language:[ \t]*(["']?)(?:typescript|tsx|ts)\1[ \t]*(?:#.*)?$/im.exec(text)
      if (!language || !/^id:/m.test(text) || !/^rule:/m.test(text)) continue
      const roots = files.filter(path => /(?:^|\/)sgconfig\.ya?ml$/.test(path)).map(posix.dirname).filter(dir => dir === "." || file.startsWith(dir + "/")).sort((a, b) => b.length - a.length)
      const base = roots[0] ?? packageOf(file)
      let selecting = false
      const parts = []
      for (const line of text.split("\n")) {
        const field = /^files:[ \t]*(.*)$/.exec(line)
        if (field) { selecting = true; parts.push(field[1]); continue }
        if (!selecting) continue
        if (/^[ \t]*-[ \t]/.test(line)) parts.push(line)
        else if (line.trim() && !/^[ \t]*#/.test(line)) selecting = false
      }
      const globs = []
      for (const token of parts.join("\n").matchAll(/[^\s"'`\[\]#]+/g)) {
        const literal = JSON.stringify(token[0].replace(/,$/, ""))
        for (const match of literal.matchAll(tsGlob)) globs.push(match[2])
      }
      for (const glob of globs.length ? globs : ["**/*.ts"]) {
        const prefix = glob.split("/").filter((part, index, all) => !/[*?{]/.test(part) && all.slice(0, index).every(p => !/[*?{]/.test(p))).join("/")
        findings.push({ file, line: lineOf(text, language.index), match: glob, kind: "glob", tool: "ast-grep", directory: posix.normalize(posix.join(base, prefix)) })
      }
      continue
    }
    if (posix.basename(file) === "package.json") {
      let scripts = {}
      try { scripts = JSON.parse(text).scripts ?? {} } catch {}
      for (const command of Object.values(scripts).filter(value => typeof value === "string")) {
        for (const word of command.matchAll(/[^\s"'`]+/g)) {
          const token = word[0].replace(/^--[^=]+=/, "").replace(/[);,]+$/, "")
          for (const match of JSON.stringify(token).matchAll(tsGlob)) {
            const glob = match[2]
            const prefix = glob.split("/").filter((part, index, all) => !/[*?{]/.test(part) && all.slice(0, index).every(p => !/[*?{]/.test(p))).join("/")
            // An explicit shell cd makes the static cwd uncertain. Retain the
            // containing package rather than claim an unproved narrower root.
            const directory = /(?:^|[;&|]\s*)cd\s/.test(command) ? packageOf(file) : posix.normalize(posix.join(packageOf(file), prefix))
            findings.push({ file, line: lineOf(text, Math.max(0, text.indexOf(JSON.stringify(command)))), match: glob, kind: "glob", directory })
          }
        }
      }
    }
    const here = posix.dirname(file)
    for (const match of text.matchAll(tsGlob)) {
      const glob = match[2]
      const prefix = glob.split("/").filter((part, index, parts) => !/[*?{]/.test(part) && parts.slice(0, index).every((p) => !/[*?{]/.test(p))).join("/")
      const base = glob.startsWith(".") ? here : packageOf(file)
      findings.push({ file, line: lineOf(text, match.index), match: glob, kind: "glob", directory: posix.normalize(posix.join(base, prefix)) })
    }
    const filters = [...text.matchAll(new RegExp(tsFilter.source, "g"))]
    if (filters.length && walks.test(text)) {
      ts ??= defaultTypeScript()
      const roots = walkRoots(ts, file, text)
      // A walk name the parser finds no call of still walks somewhere: the whole package.
      for (const { index, root } of roots.length ? roots : [{ index: filters[0].index, root: null }]) {
        // The filter the walk's names reach: the first after the walk, else the last before it.
        const filter = filters.find(m => m.index >= index) ?? filters.at(-1)
        const directory = root === null ? packageOf(file) : posix.normalize(posix.join(here, root)).replace(/\/$/, "")
        findings.push({ file, line: lineOf(text, filter.index), match: filter[0], kind: "walk", directory })
      }
    }
  }
  return [...new Map(findings.map(finding => [JSON.stringify([finding.file, finding.kind, finding.directory, finding.match]), finding])).values()]
}

const within = (directory, path) => directory === "." || path === directory || path.startsWith(directory + "/")

/** Whether an enumerated directory holds path, and a named selector picks it. */
export const enumerates = (finding, path) => within(finding.directory, path) && (!finding.named || finding.named.test(posix.basename(path)))

/**
 * The findings whose folder holds, or will hold, .vibe files: a .vibe file, or
 * a .ts source that imports Effect, which the plan may migrate.
 */
export function relevantEnumerations(findings, files, read) {
  const holders = files.filter((path) => /\.vibex?$/.test(path) ||
    /\.(?:ts|tsx|mts|cts)$/.test(path) && !/\.d\.[^/]*ts$/.test(path) && /\bfrom\s*["']effect(?:\/[^"']*)?["']|\bimport\(\s*["']effect["']/.test(read(path) ?? ""))
  return findings.filter((finding) => holders.some((path) => enumerates(finding, path) && path !== finding.file))
}

/** One line per finding, for setup's record and its warnings. */
export const describe = (finding) => finding.named ? `${finding.file}:${finding.line} selects modules by the named glob ${finding.match}` : `${finding.file}:${finding.line} enumerates *.ts files under ${finding.directory === "." ? "the repository" : finding.directory + "/"} (${finding.kind === "glob" ? "glob" : "a walk filtered by"} ${finding.match})`

/**
 * Turns vibe.sidecarDir on in a tsconfig's text (JSON with comments) and adds
 * the directory to compilerOptions.rootDirs with ".", so stock TypeScript
 * resolves ./x.vibe to the mirrored sidecar. A tsconfig that already sets
 * rootDirs gets the missing entries appended. ts is TypeScript's compiler
 * API. Returns the text unchanged when both are already set.
 */
export function addSidecarDir(text, ts, directory = sidecarDirectory, fileName) {
  const file = ts.parseJsonText("tsconfig.json", text)
  const root = file.statements[0]?.expression
  if (!root || !ts.isObjectLiteralExpression(root)) throw new Error("not a tsconfig object")
  const nameOf = (p) => ts.isPropertyAssignment(p) && p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) ? p.name.text : undefined
  const find = (object, name) => object.properties.find((p) => nameOf(p) === name)
  const indentOf = (object, fallback) => /\n([ \t]+)\S/.exec(text.slice(object.getStart(file) + 1))?.[1] ?? fallback
  const edits = []
  // Properties to insert first in each object, written as one edit per object.
  const inserts = new Map()
  const insert = (object, key, value, fallback) => {
    if (!inserts.has(object)) inserts.set(object, { fallback, entries: [] })
    inserts.get(object).entries.push(`${JSON.stringify(key)}: ${value}`)
  }
  const vibe = find(root, "vibe")
  const own = vibe && ts.isObjectLiteralExpression(vibe.initializer) ? find(vibe.initializer, "sidecarDir") : undefined
  const effective = fileName ? sidecarSettings(fileName, ts, text, { sourceRootOnly: true }) : undefined
  const inherited = effective !== undefined && !own
  if (effective) directory = relative(dirname(fileName), effective.directory).replaceAll("\\", "/") || "."
  else if (own && ts.isStringLiteral(own.initializer)) directory = own.initializer.text || "."
  directory = posix.normalize(directory)
  const sourceRoot = fileName ? relative(dirname(fileName), (effective ?? sidecarRootLayout(fileName, ts, text)).sourceRoot).replaceAll("\\", "/") || "." : "."
  const compiler = find(root, "compilerOptions")
  const rootDirs = compiler && ts.isObjectLiteralExpression(compiler.initializer) ? find(compiler.initializer, "rootDirs") : undefined
  if (rootDirs && ts.isArrayLiteralExpression(rootDirs.initializer)) {
    const present = rootDirs.initializer.elements.filter(ts.isStringLiteral).map((e) => posix.normalize(e.text))
    const missing = [...new Set([sourceRoot, directory])].filter((entry) => !present.includes(entry))
    if (missing.length) {
      const list = rootDirs.initializer
      const last = list.elements.at(-1)
      edits.push(last
        ? { at: last.end, text: missing.map((entry) => `, ${JSON.stringify(entry)}`).join("") }
        : { at: list.getStart(file) + 1, text: missing.map((entry) => JSON.stringify(entry)).join(", ") })
    }
  } else if (compiler && ts.isObjectLiteralExpression(compiler.initializer)) {
    insert(compiler.initializer, "rootDirs", JSON.stringify([...new Set([sourceRoot, directory])]), "    ")
  } else {
    insert(root, "compilerOptions", `{ "rootDirs": ${JSON.stringify([...new Set([sourceRoot, directory])])} }`, "  ")
  }
  if (vibe && ts.isObjectLiteralExpression(vibe.initializer)) {
    if (!inherited && !find(vibe.initializer, "sidecarDir")) insert(vibe.initializer, "sidecarDir", JSON.stringify(directory), "    ")
  } else if (!vibe && !inherited) {
    insert(root, "vibe", `{ "sidecarDir": ${JSON.stringify(directory)} }`, "  ")
  }
  for (const [object, { fallback, entries }] of inserts) {
    const indent = indentOf(object, fallback)
    const empty = object.properties.length === 0
    edits.push({ at: object.getStart(file) + 1, text: entries.map((entry) => `\n${indent}${entry}`).join(",") + (empty ? "\n" : ",") })
  }
  let out = text
  for (const edit of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at)
  return out
}

/** Reads a tracked file's text under root, or undefined. */
export const reader = (root) => (path) => {
  try {
    return existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined
  } catch {
    return undefined
  }
}
