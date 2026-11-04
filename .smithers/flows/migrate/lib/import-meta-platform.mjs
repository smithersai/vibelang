// Spec 005 EK4402: move host code to a fresh sibling, preserving run phase,
// captures, receiver and public types. VIP-40 bodies cannot hold import.meta.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"

export function splitImportMeta(text, file, sibling, ts) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.(?:tsx|vibex)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const sites = [], taken = new Set()
  let refused
  const visit = node => {
    if (ts.isIdentifier(node)) taken.add(node.text)
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      const member = node.parent, call = member?.parent
      if (ts.isPropertyAccessExpression(member) && member.expression === node && !member.questionDotToken && member.name.text === "url") return
      if (ts.isPropertyAccessExpression(member) && member.expression === node && !member.questionDotToken && member.name.text === "resolve" &&
          ts.isCallExpression(call) && call.expression === member && !call.questionDotToken && !call.typeArguments?.length &&
          call.arguments.length === 1 &&
          (ts.isIdentifier(call.arguments[0]) || ts.isStringLiteral(call.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(call.arguments[0])) && !/\/[*\/]/.test(member.getText(source))) {
        sites.push(member)
      } else {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        refused = file + ":" + line + ": import.meta use cannot move while preserving module identity, receiver and public types; only a direct import.meta.resolve(specifier) call with an identifier or literal input is supported"
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (refused) return { refused }
  if (!sites.length) return null
  if (source.parseDiagnostics.length) return { refused: file + ": cannot safely parse the import.meta call" }
  let name = "$importMetaResolve"
  for (let n = 2; taken.has(name); n++) name = "$importMetaResolve" + n
  const importText = 'import { ' + name + ' } from "./' + posix.basename(sibling) + '"'
  // Only the callee changes: inputs, callbacks and catch stay where they ran.
  let module = text
  for (const site of sites.sort((a, b) => b.pos - a.pos)) module = module.slice(0, site.getStart(source)) + name + module.slice(site.end)
  const at = source.statements[0]?.getStart(source) ?? text.length
  module = module.slice(0, at) + importText + "\n" + module.slice(at)
  const platform = "export function " + name + "(specifier: string): string { return import.meta.resolve(specifier) }\n"
  return { module, platform, moved: [name], wrapped: [], importMeta: true, importText }
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
