// Declaration identity: a package's public API is its emitted .d.ts files,
// and a migrated batch must leave them as they were. Both sides are emitted by
// the same vibelang, then compared after the normalizations the Smithers
// package migration's identity gate accepts and nothing more: comments
// dropped, nodes reprinted, union members and uniquely named property members
// in a stable order, and parentheses around a whole generic type argument
// removed. One normalization is the migration's own: a relative specifier
// spelled ./x.ts becomes ./x.js, because a renamed module's importers declare
// it that way (D298) and TypeScript resolves both spellings to the same x.d.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve, sep } from "node:path"
import { assertFinished } from "./diagnostics.mjs"
import { quote, rel, run } from "./util.mjs"

/** The TypeScript compiler API (5.x or 6.x; TypeScript 7's package has no such API), from the first directory that has it. */
export function loadTypeScript(directories) {
  const tried = []
  for (const dir of directories) {
    try {
      const ts = createRequire(join(dir, "package.json"))("typescript")
      if (typeof ts.createSourceFile === "function" && typeof ts.createPrinter === "function") return ts
      tried.push(`${dir}: typescript ${ts.version} has no compiler API`)
    } catch (error) {
      tried.push(`${dir}: ${error.code ?? error.message}`)
    }
  }
  throw new Error(`no TypeScript compiler API to read declarations:\n${tried.join("\n")}`)
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Whether a string literal is the module name of an import, export, `import()` type, `require` or augmentation, not a string in a type. */
const isModuleName = (ts, node) => {
  const parent = node.parent
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return parent.moduleSpecifier === node
  if (ts.isModuleDeclaration(parent)) return parent.name === node
  if (ts.isLiteralTypeNode(parent)) return ts.isImportTypeNode(parent.parent) && parent.parent.argument === parent
  return ts.isExternalModuleReference(parent)
}

/** A declaration file's canonical text. */
export function canonicalize(ts, text, fileName = "file.d.ts") {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
  // Reprint from the tree, never from the source's own spelling of a literal.
  const detach = (ctx) => {
    const visit = (node) => {
      const clone = ts.factory.cloneNode(node)
      ts.setTextRange(clone, { pos: -1, end: -1 })
      return ts.visitEachChild(clone, visit, ctx)
    }
    return (node) => ts.visitNode(node, visit)
  }
  const print = (node) => {
    const out = ts.transform(node, [detach])
    try {
      return printer.printNode(ts.EmitHint.Unspecified, out.transformed[0], source)
    } finally {
      out.dispose()
    }
  }
  const sortMembers = (members) => {
    const name = (m) => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isNumericLiteral(m.name)) ? m.name.text : undefined)
    const counts = new Map()
    for (const m of members) if (name(m) !== undefined) counts.set(name(m), (counts.get(name(m)) ?? 0) + 1)
    const eligible = (m) => (ts.isPropertySignature(m) || (ts.isPropertyDeclaration(m) && !m.initializer)) && name(m) !== undefined && counts.get(name(m)) === 1
    const sorted = members.filter(eligible).sort((a, b) => compare(print(a), print(b)))
    let i = 0
    return ts.factory.createNodeArray(members.map((m) => (eligible(m) ? sorted[i++] : m)))
  }
  const normalize = (ctx) => {
    const f = ctx.factory
    const visit = (node) => {
      let x = ts.visitEachChild(node, visit, ctx)
      if (ts.isStringLiteral(x) && /^\.\.?\/.*(?<!\.d)\.ts$/.test(x.text) && isModuleName(ts, node)) return f.createStringLiteral(x.text.replace(/\.ts$/, ".js"))
      if (ts.isTypeReferenceNode(x) && x.typeArguments) {
        x = f.updateTypeReferenceNode(x, x.typeName, f.createNodeArray(x.typeArguments.map((t) => (ts.isParenthesizedTypeNode(t) ? t.type : t))))
      }
      if (ts.isUnionTypeNode(x)) x = f.updateUnionTypeNode(x, f.createNodeArray([...x.types].sort((a, b) => compare(print(a), print(b)))))
      else if (ts.isTypeLiteralNode(x)) x = f.updateTypeLiteralNode(x, sortMembers(x.members))
      else if (ts.isInterfaceDeclaration(x)) x = f.updateInterfaceDeclaration(x, x.modifiers, x.name, x.typeParameters, x.heritageClauses, sortMembers(x.members))
      else if (ts.isClassDeclaration(x)) x = f.updateClassDeclaration(x, x.modifiers, x.name, x.typeParameters, x.heritageClauses, sortMembers(x.members))
      return x
    }
    return (node) => ts.visitNode(node, visit)
  }
  const out = ts.transform(source, [normalize])
  try {
    return out.transformed[0].statements.map((statement) => print(statement)).join("\n") + "\n"
  } finally {
    out.dispose()
  }
}

/** Every .d.ts file under dir, relative to it. */
export function listDeclarations(dir) {
  const out = []
  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.d\.[cm]?ts$/.test(entry.name)) out.push(rel(dir, path))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

/** The first lines where two texts differ, as a short unified-style excerpt. */
export function lineDiff(before, after, limit = 12) {
  const a = before.split("\n")
  const b = after.split("\n")
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) out.push(`-${i + 1}: ${a[i]}`)
    if (b[i] !== undefined) out.push(`+${i + 1}: ${b[i]}`)
  }
  return out
}

/** Compares two declaration trees after canonicalizing every file. */
export function compareDeclarations(ts, baselineDir, currentDir) {
  const before = listDeclarations(baselineDir)
  const after = listDeclarations(currentDir)
  const afterSet = new Set(after)
  const beforeSet = new Set(before)
  const changed = []
  for (const file of before.filter((f) => afterSet.has(f))) {
    const a = canonicalize(ts, readFileSync(join(baselineDir, file), "utf8"), file)
    const b = canonicalize(ts, readFileSync(join(currentDir, file), "utf8"), file)
    if (a !== b) changed.push({ file, diff: lineDiff(a, b) })
  }
  const removed = before.filter((f) => !afterSet.has(f))
  const added = after.filter((f) => !beforeSet.has(f))
  return { identical: !changed.length && !removed.length && !added.length, files: before.length, added, removed, changed }
}

/** Emits a project's declarations, and only them, into outDir with vibelang. */
export async function emitDeclarations({ compiler, tsconfig, cwd, outDir, log }) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const flags = "--noEmit false --declaration --emitDeclarationOnly --declarationMap false --sourceMap false --composite false --incremental false --noEmitOnError false --pretty false --listEmittedFiles"
  const result = await run(`${quote(compiler)} -p ${quote(tsconfig)} ${flags} --outDir ${quote(outDir)}`, { cwd, log })
  assertFinished(result, log)
  // A file outside the project's rootDir emits beside its source, where a batch's commit would pick it up.
  const inside = `${resolve(outDir)}${sep}`
  for (const [, file] of result.stdout.matchAll(/^TSFILE: (.+)$/gm)) if (!file.startsWith(inside)) rmSync(file, { force: true })
  const files = listDeclarations(outDir)
  if (!files.length) throw new Error(`vibelang emitted no declarations for ${tsconfig} (exit ${result.code}${log ? `, log ${log}` : ""})`)
  return { code: result.code, files: files.length }
}
