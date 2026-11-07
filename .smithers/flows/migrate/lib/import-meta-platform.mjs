// Spec 005 EK4402: move host code to a fresh sibling, preserving run phase,
// captures, receiver and public types. VIP-40 bodies cannot hold import.meta.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"

function inSourceChildHelper(node, ts) {
  for (let at = node; at; at = at.parent) if (ts.isFunctionDeclaration(at) && /^__vibelangSourceChild\d*$/.test(at.name?.text ?? "")) return true
  return false
}

// The members a companion can serve. A member that depends on the module
// gets the module's own import.meta.url as an argument (VIP-40: "receives it
// as an argument"); the rest read host state that is the same in every
// module of the build.
// - import.meta.resolve(x) and import.meta.resolve(x, parent): the companion
//   is a sibling, so relative and package resolution give the same URL. The
//   arguments stay where they were, in order: nothing left in the module can
//   change import.meta, so looking up resolve after them instead of before is
//   not observable.
// - import.meta.filename and import.meta.dirname: Node defines them from a
//   file: URL with fileURLToPath and path.dirname, and leaves them undefined
//   for any other URL; Bun and Deno agree.
// - import.meta.env: the build's environment (Vite's define, Bun's
//   process.env), read where the module read it. A write stays refused.
// import.meta.main and every other member depend on the module in a way no
// argument carries, and an alias, destructuring or computed key hides which
// member is read: those are refused.
const helperBases = { resolve: "$importMetaResolve", filename: "$importMetaFilename", dirname: "$importMetaDirname", env: "$importMetaEnv" }

// Whether node, a reference, is written: assigned, updated, deleted or a
// destructuring or for-in/of target.
function isWritten(node, ts) {
  let at = node
  while (at.parent && ts.isParenthesizedExpression(at.parent)) at = at.parent
  const parent = at.parent
  if (!parent) return false
  if (ts.isBinaryExpression(parent) && parent.left === at &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) return true
  if (ts.isDeleteExpression(parent)) return true
  if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === at) return true
  // A destructuring assignment target: an element of an array or object
  // literal that is itself assigned to.
  if (ts.isArrayLiteralExpression(parent) || ts.isSpreadElement(parent) || ts.isShorthandPropertyAssignment(parent) ||
      ts.isPropertyAssignment(parent) && parent.initializer === at) {
    let literal = parent
    while (literal.parent && (ts.isArrayLiteralExpression(literal.parent) || ts.isObjectLiteralExpression(literal.parent) ||
        ts.isSpreadElement(literal.parent) || ts.isPropertyAssignment(literal.parent) || ts.isSpreadAssignment(literal.parent))) literal = literal.parent
    if (!ts.isArrayLiteralExpression(literal) && !ts.isObjectLiteralExpression(literal)) literal = literal.parent ?? literal
    return isWritten(literal, ts)
  }
  return false
}

// The outermost static member chain over node: import.meta.env.API_URL for
// import.meta.env.
function accessTop(node, ts) {
  let at = node
  while (at.parent && (ts.isPropertyAccessExpression(at.parent) || ts.isElementAccessExpression(at.parent)) && at.parent.expression === at) at = at.parent
  return at
}

export function splitImportMeta(text, file, sibling, ts) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.(?:tsx|vibex)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const sites = [], taken = new Set()
  let refused
  const refuse = (node, why) => {
    if (refused) return
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    refused = file + ":" + line + ": " + why
  }
  const visit = node => {
    if (ts.isIdentifier(node)) taken.add(node.text)
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      const member = node.parent, call = member?.parent
      const name = ts.isPropertyAccessExpression(member) && member.expression === node && !member.questionDotToken ? member.name.text : undefined
      if (name === "url") return
      if (name && /\/[*\/]/.test(member.getText(source))) refuse(node, "import.meta use has comments that cannot be moved unchanged")
      else if (name === "resolve" && ts.isCallExpression(call) && call.expression === member && !call.questionDotToken &&
          !call.typeArguments?.length && (call.arguments.length === 1 || call.arguments.length === 2) && !call.arguments.some(a => ts.isSpreadElement(a))) sites.push({ node: member, kind: "resolve", parent: call.arguments.length === 2 })
      else if ((name === "filename" || name === "dirname") && !isWritten(member, ts)) sites.push({ node: member, kind: name })
      else if (name === "env" && !isWritten(accessTop(member, ts), ts)) sites.push({ node: member, kind: "env" })
      else refuse(node, "import.meta use cannot move while preserving module identity, receiver and public types; a companion serves only a direct import.meta.resolve call and reads of import.meta.filename, import.meta.dirname and import.meta.env")
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (refused) return { refused }
  if (!sites.length) return null
  if (source.parseDiagnostics.length) return { refused: file + ": cannot safely parse the import.meta use" }
  const fresh = base => { let name = base; for (let n = 2; taken.has(name); n++) name = base + n; taken.add(name); return name }
  const kinds = new Set(sites.map(site => site.kind))
  const helpers = {}
  for (const kind of ["resolve", "filename", "dirname", "env"]) if (kinds.has(kind)) helpers[kind] = fresh(helperBases[kind])
  const fileUrlToPath = kinds.has("filename") || kinds.has("dirname") ? fresh("$fileURLToPath") : null
  const pathDirname = kinds.has("dirname") ? fresh("$dirname") : null
  const names = Object.values(helpers)
  const importText = "import { " + [...names].sort().join(", ") + " } from \"./" + posix.basename(sibling) + "\""
  // Only the member read changes: inputs, callbacks and catch stay where they ran.
  const replacement = site => {
    const text = site.kind === "resolve" ? helpers.resolve
      : site.kind === "env" ? helpers.env + "()"
      : helpers[site.kind] + "(import.meta.url)"
    // new import.meta.env.X() constructs X; new $importMetaEnv().X() would not.
    const top = accessTop(site.node, ts)
    return text.endsWith(")") && top.parent && ts.isNewExpression(top.parent) && top.parent.expression === top ? "(" + text + ")" : text
  }
  let module = text
  for (const site of sites.sort((a, b) => b.node.pos - a.node.pos)) module = module.slice(0, site.node.getStart(source)) + replacement(site) + module.slice(site.node.end)
  const at = source.statements[0]?.getStart(source) ?? text.length
  module = module.slice(0, at) + importText + "\n" + module.slice(at)
  const lines = []
  if (fileUrlToPath) lines.push("import { fileURLToPath as " + fileUrlToPath + " } from \"node:url\"")
  if (pathDirname) lines.push("import { dirname as " + pathDirname + " } from \"node:path\"")
  // A parent argument passes through as written; a call without one still
  // passes none, so the host's own default applies.
  if (helpers.resolve) lines.push(sites.some(site => site.parent)
    ? "export function " + helpers.resolve + "(...args: Parameters<ImportMeta[\"resolve\"]>): ReturnType<ImportMeta[\"resolve\"]> { return import.meta.resolve(...args) }"
    : "export function " + helpers.resolve + "(specifier: string): string { return import.meta.resolve(specifier) }")
  if (helpers.filename) lines.push("export function " + helpers.filename + "(url: string): ImportMeta[\"filename\"] { return (url.startsWith(\"file:\") ? " + fileUrlToPath + "(url) : undefined) as ImportMeta[\"filename\"] }")
  if (helpers.dirname) lines.push("export function " + helpers.dirname + "(url: string): ImportMeta[\"dirname\"] { return (url.startsWith(\"file:\") ? " + pathDirname + "(" + fileUrlToPath + "(url)) : undefined) as ImportMeta[\"dirname\"] }")
  if (helpers.env) lines.push("export function " + helpers.env + "(): ImportMeta[\"env\"] { return import.meta.env }")
  const platform = lines.join("\n") + "\n"
  // A generated source-child helper keeps its own private boundary in a VIP-40
  // body. Only an authored import.meta use may add a null export to the manifest.
  return { module, platform, moved: names, wrapped: [], importMeta: sites.some(site => !inSourceChildHelper(site.node, ts)), importText,
    // The helpers that carry the module's URL. Code that calls them cannot
    // move to the companion, whose own URL differs.
    identity: [helpers.filename, helpers.dirname].filter(Boolean),
    members: Object.fromEntries(Object.entries(helpers).map(([kind, name]) => [name, kind])) }
}

// An exact null export keeps the fresh resolver private under a source
// wildcard. Unknown layouts still refuse; no existing subpath may be hidden.
export function privateResolverExports(root, file, sibling, { exists, read }) {
  const boundary = resolve(root)
  let dir = dirname(resolve(root, file))
  while (dir === boundary || dir.startsWith(boundary + "/")) {
    const manifest = posix.relative(boundary, join(dir, "package.json"))
    if (exists(manifest)) {
      const pkg = JSON.parse(read(manifest)), exports = pkg.exports
      if (!exports || Array.isArray(exports) || typeof exports !== "object") return null
      const strings = value => typeof value === "string" ? [value]
        : Array.isArray(value) ? value.flatMap(strings)
        : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []
      const local = "./" + posix.relative(dir, resolve(root, sibling)), keys = new Set()
      for (const [key, value] of Object.entries(exports)) {
        if (!key.includes("*")) continue
        if (key.split("*").length !== 2) return null
        const targets = strings(value)
        let anchored = false
        for (const target of targets) {
          const [start, end] = target.split("*")
          if (target.split("*").length !== 2 || !local.startsWith(start) || !local.endsWith(end)) continue
          anchored = true
          const capture = local.slice(start.length, local.length - end.length)
          const subpath = key.replace("*", capture)
          if (Object.hasOwn(exports, subpath)) {
            if (exports[subpath] !== null) return null
            continue
          }
          if (targets.some(t => !t.startsWith("./") || t.split("*").length !== 2 ||
              exists(posix.relative(boundary, resolve(dir, t.replace("*", capture)))) ||
              exists(posix.relative(boundary, resolve(dir, t.replace("*", capture).replace(/\.(?:m?ts|js)$/, ".d.ts")))))) return null
          keys.add(subpath)
        }
        if (!anchored) return null
      }
      if (!keys.size) return null
      return { manifest, keys: [...keys].sort() }
    }
    if (dir === boundary) break
    dir = dirname(dir)
  }
  return null
}

export function restorePrivateResolverExports(root, split) {
  const edit = split?.privateExports
  if (!edit) return
  const path = join(root, edit.manifest), pkg = JSON.parse(readFileSync(path, "utf8"))
  for (const key of edit.keys) {
    if (pkg.exports?.[key] !== null) throw new Error(edit.manifest + ": private resolver export changed during migration")
    delete pkg.exports[key]
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
}
