// Platform code in a module the batch migrates (spec 005, EK4402: "The quick
// fix and the codemod move the code into a sibling `.ts` module, or point to
// the Effect service"). A .vibe file does not import a Node or Bun builtin as
// a value, so before the rename the codemod moves each top-level declaration
// that uses one, with the module's own declarations it needs, into
// <Name>.platform.ts beside the module, verbatim. The module keeps every
// export: an exported function that moved stays as a function with the same
// written signature that calls the moved one, so the module's declarations
// are unchanged. A module whose moved exports are not such functions keeps
// its platform code, and EK4402 sends it back to TypeScript as before.
//
// A host global (process.env, globalThis.fetch) is moved only when the
// caller names it: vibelang --fix first rewrites what an Effect service
// covers (Config, Console, Clock), and the EK4402 sites it leaves send the
// module back with their messages. platformGlobalsOf reads the globals from
// those messages, and the next pass splits only the declarations that read
// them (the hand-off agreed with migfix-t3code-2, inbox migfix-smithers.md).
import { builtinModules } from "node:module"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"

const builtins = new Set(builtinModules)

/** Whether a module specifier names a Node or Bun builtin, with or without node:. */
export function isPlatformModule(specifier) {
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun") return true
  return builtins.has(specifier) || builtins.has(specifier.split("/")[0])
}

/**
 * The host globals that EK4402 messages name, as the identifiers a
 * declaration reads: "process.env is platform code" names process,
 * "globalThis.crypto.subtle is platform code" names globalThis. A builtin
 * import ("createHash from node:crypto is platform code") is split without
 * being named, and a message about anything else names nothing.
 */
export function platformGlobalsOf(messages) {
  const names = new Set()
  for (const message of messages) {
    const text = String(message).replace(/^\s*(?:error\s+)?EK4402:\s*/, "")
    if (/^\S+ from \S+ is platform code/.test(text)) continue
    const m = /^([A-Za-z_$][\w$]*)(?:\??\.[\w$.?]*|\[[^\]]*\])* is platform code/.exec(text)
    if (m && m[1] !== "import") names.add(m[1])
  }
  return [...names].sort()
}

/** The sibling module a split writes for file, src/Open.ts: src/Open.platform.ts. */
export const platformPath = (file) => file.replace(/\.(m?ts)$/, ".platform.$1")

/**
 * Splits the TypeScript module text of file (repository-relative). Returns
 * { module, platform, moved, wrapped } with the two texts, or { refused }
 * saying why the module keeps its platform code, or null when it imports no
 * builtin as a value and reads none of globals, the host globals to move
 * (platformGlobalsOf).
 */
export function splitPlatform(text, file, ts, { globals = [] } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const imports = source.statements.filter((s) => ts.isImportDeclaration(s))
  const platform = new Set()
  const imported = new Set()
  for (const i of imports) {
    const builtin = ts.isStringLiteral(i.moduleSpecifier) && isPlatformModule(i.moduleSpecifier.text)
    for (const b of bindingsOf(i, ts)) {
      imported.add(b.name)
      if (builtin && !b.type) platform.add(b.name)
    }
  }
  const declaredAtTop = new Set(source.statements.flatMap((s) => (ts.isImportDeclaration(s) ? [] : [...declaredNames(s, ts)])))
  for (const name of globals) if (!imported.has(name) && !declaredAtTop.has(name)) platform.add(name)
  if (!platform.size) return null
  // Each top-level declaration: the names it declares and the names it reads.
  const declarations = []
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) continue
    declarations.push({ statement, names: declaredNames(statement, ts), reads: readNames(statement, ts), exported: isExported(statement, ts) })
  }
  const byName = new Map()
  for (const d of declarations) for (const name of d.names) byName.set(name, d)
  const moved = new Set(declarations.filter((d) => [...d.reads].some((n) => platform.has(n) && !byName.has(n))))
  if (!moved.size) return null
  // The moved code takes the module's own declarations it reads, values and types.
  // Types stay in the module, whose declarations name them: the sibling
  // imports an exported type, and has its own copy of a private type alias or
  // interface, which is the same type structurally.
  const typeOnly = (d) => ts.isInterfaceDeclaration(d.statement) || ts.isTypeAliasDeclaration(d.statement)
  const typesFromModule = new Set()
  const copied = new Set()
  for (let grew = true; grew; ) {
    grew = false
    for (const d of [...moved, ...copied]) {
      for (const name of d.reads) {
        const needed = byName.get(name)
        if (!needed || moved.has(needed) || copied.has(needed)) continue
        if (typeOnly(needed)) {
          if (needed.exported) typesFromModule.add(name)
          else { copied.add(needed); grew = true }
          continue
        }
        if (copied.has(d)) return { refused: `${file}: the type ${[...d.names].join(", ")} reads the value ${name}` }
        moved.add(needed); grew = true
      }
    }
  }
  for (const d of moved) {
    if (!isMovable(d.statement, ts)) return { refused: `${file}: ${firstLine(source, d.statement)} cannot move to ${posix.basename(platformPath(file))}` }
  }
  const kept = declarations.filter((d) => !moved.has(d))
  const keptReads = new Set(kept.flatMap((d) => [...d.reads]))
  // A moved export stays in the module as a function with its written
  // signature; any other moved export means the module cannot keep its API.
  const wrappers = []
  for (const d of moved) {
    if (!d.exported) continue
    const wrapper = wrapperOf(d.statement, source, ts)
    if (!wrapper) return { refused: `${file}: export ${[...d.names].join(", ")} uses platform code and is not a function with written parameter and return types, so it cannot stay in the .vibe module` }
    wrappers.push({ d, ...wrapper })
  }
  if (moved.size === declarations.length && !wrappers.length) return { refused: `${file} is platform code only` }
  const namespace = uniqueName("$platform", new Set([...byName.keys(), ...imports.flatMap((i) => bindingsOf(i, ts).map((b) => b.name))]))
  const sibling = "./" + posix.basename(platformPath(file))
  // The module: kept imports, the import of the moved code, kept declarations and wrappers, in source order.
  const movedReadsByKept = [...moved].filter((d) => !d.exported).flatMap((d) => [...d.names].filter((n) => keptReads.has(n)))
  const fromSibling = [...new Set(movedReadsByKept)].sort()
  const moduleReads = new Set([...keptReads, ...wrappers.flatMap((w) => [...w.reads])])
  const moduleImports = imports.map((i) => importText(i, source, ts, (b) => moduleReads.has(b.name))).filter(Boolean)
  const head = [...moduleImports]
  if (wrappers.length) head.push(`import * as ${namespace} from "${sibling}"`)
  if (fromSibling.length) head.push(`import { ${fromSibling.join(", ")} } from "${sibling}"`)
  const body = []
  for (const d of declarations) {
    if (!moved.has(d)) body.push(statementText(source, d.statement))
    else if (d.exported) body.push(wrappers.find((w) => w.d === d).text(namespace))
  }
  const moduleText = joinParts(leadingHeader(source), head, body)
  // The sibling: the imports the moved code reads, then the moved code, each
  // declaration the module reads exported.
  const movedList = declarations.filter((d) => moved.has(d) || copied.has(d))
  const movedReads = new Set(movedList.flatMap((d) => [...d.reads]))
  const platformImports = imports.map((i) => importText(i, source, ts, (b) => movedReads.has(b.name))).filter(Boolean)
  if (typesFromModule.size) platformImports.push(`import type { ${[...typesFromModule].sort().join(", ")} } from "./${posix.basename(file)}"`)
  const platformBody = movedList.map((d) => (!d.exported && fromSibling.some((n) => d.names.has(n)) ? exportedText(source, d.statement) : statementText(source, d.statement)))
  const note = `// The platform code of ${posix.basename(file).replace(/\.m?ts$/, ".vibe")}, which a .vibe file does not import as a value (EK4402).`
  // A file-wide directive governed the moved code too, so the sibling keeps it
  // (t3code Desktop: `// @effect-diagnostics nodeBuiltinImport:off`).
  const directives = fileDirectives(source, ts).filter((d) => !platformImports.some((i) => i.includes(d)))
  const platformText = joinParts(directives, [note], platformImports, platformBody)
  return { module: moduleText, platform: platformText, moved: movedList.filter((d) => moved.has(d)).map((d) => [...d.names]).flat(), wrapped: wrappers.map((w) => w.name) }
}

/**
 * Splits each batch file that imports a builtin as a value, or reads a host
 * global globalsOf(file) names, writing <Name>.platform.ts beside it.
 * Returns { splits, refused }: the files written, and why each other file
 * keeps its platform code.
 */
export function splitBatchPlatform(root, files, ts, {
  globalsOf = () => [],
  exists = file => existsSync(join(root, file)),
  read = file => readFileSync(join(root, file), "utf8"),
  write = (file, text) => writeFileSync(join(root, file), text)
} = {}) {
  const splits = []
  const refused = []
  for (const file of files) {
    if (!/\.m?ts$/.test(file) || /\.d\.m?ts$/.test(file)) continue
    const sibling = platformPath(file)
    if (exists(sibling)) { refused.push(`${file}: ${sibling} already exists`); continue }
    const result = splitPlatform(read(file), file, ts, { globals: globalsOf(file) })
    if (!result) continue
    if (result.refused) { refused.push(result.refused); continue }
    write(file, result.module)
    write(sibling, result.platform)
    splits.push({ file, platform: sibling, moved: result.moved, wrapped: result.wrapped })
  }
  return { splits, refused }
}

function bindingsOf(i, ts) {
  const clause = i.importClause
  if (!clause) return []
  const all = clause.isTypeOnly
  const out = []
  if (clause.name) out.push({ name: clause.name.text, kind: "default", type: all })
  const named = clause.namedBindings
  if (named && ts.isNamespaceImport(named)) out.push({ name: named.name.text, kind: "namespace", type: all })
  if (named && ts.isNamedImports(named)) {
    for (const e of named.elements) out.push({ name: e.name.text, kind: "named", property: e.propertyName?.text, type: all || e.isTypeOnly })
  }
  return out
}

function importText(i, source, ts, keep) {
  const clause = i.importClause
  if (!clause) return statementText(source, i) // a side-effect import stays where it was
  const bindings = bindingsOf(i, ts)
  const kept = bindings.filter(keep)
  if (!kept.length) return null
  if (kept.length === bindings.length) return statementText(source, i)
  const specifier = i.moduleSpecifier.getText(source)
  const parts = []
  const def = kept.find((b) => b.kind === "default")
  if (def) parts.push(def.name)
  const ns = kept.find((b) => b.kind === "namespace")
  if (ns) parts.push(`* as ${ns.name}`)
  const named = kept.filter((b) => b.kind === "named")
  if (named.length) parts.push(`{ ${named.map((b) => `${b.type && !clause.isTypeOnly ? "type " : ""}${b.property ? `${b.property} as ` : ""}${b.name}`).join(", ")} }`)
  return `import ${clause.isTypeOnly ? "type " : ""}${parts.join(", ")} from ${specifier}`
}

function declaredNames(statement, ts) {
  const names = new Set()
  if (ts.isVariableStatement(statement)) {
    for (const d of statement.declarationList.declarations) collectBindingNames(d.name, names, ts)
  } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
    names.add(statement.name.text)
  }
  return names
}

function collectBindingNames(name, names, ts) {
  if (ts.isIdentifier(name)) names.add(name.text)
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names, ts)
}

// The identifiers statement reads, other than names it declares itself, a
// property name or a member of a qualified type name.
function readNames(statement, ts) {
  const reads = new Set()
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const declares = parent && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isTypeParameterDeclaration(parent)) && parent.name === node
      const member = parent && ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isQualifiedName(parent) && parent.right === node) || ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent)) && parent.name === node))
      if (!declares && !member) reads.add(node.text)
    }
    if (ts.isShorthandPropertyAssignment(node)) reads.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(statement)
  for (const name of declaredNames(statement, ts)) reads.delete(name)
  return reads
}

const isExported = (statement, ts) => (statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

function isMovable(statement, ts) {
  if ((statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return false
  return ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)
}

// A function with written parameter and return types, written again in the
// module to call the moved one: export const f = (a: A, b = 1): R => ...,
// or export function f(a: A): R { ... }. The declaration file prints the
// same signature for both.
function wrapperOf(statement, source, ts) {
  let fn, name, kind
  if (ts.isFunctionDeclaration(statement) && statement.body && statement.name) {
    fn = statement; name = statement.name.text; kind = "function"
  } else if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const d = statement.declarationList.declarations[0]
    if (!ts.isIdentifier(d.name) || d.type || !d.initializer) return null
    let init = d.initializer
    while (ts.isParenthesizedExpression(init)) init = init.expression
    if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) return null
    fn = init; name = d.name.text; kind = "const"
  } else {
    return null
  }
  if (!fn.type || fn.asteriskToken) return null
  const params = []
  for (const p of fn.parameters) {
    if (!ts.isIdentifier(p.name) || p.name.text === "this") return null
    if (!p.type && !p.initializer) return null
    params.push(p)
  }
  const doc = leadingComments(source, statement)
  const typeParams = fn.typeParameters ? `<${fn.typeParameters.map((t) => t.getText(source)).join(", ")}>` : ""
  const paramText = params.map((p) => p.getText(source)).join(", ")
  const args = params.map((p) => (p.dotDotDotToken ? "..." : "") + p.name.text).join(", ")
  const ret = fn.type.getText(source)
  const asyncWord = (fn.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : ""
  const constKeyword = kind === "const" ? statement.declarationList.getText(source).match(/^(const|let|var)/)[1] : ""
  const reads = new Set()
  for (const p of params) for (const n of readNames(p, ts)) reads.add(n)
  for (const n of readNames(fn.type, ts)) reads.add(n)
  for (const t of fn.typeParameters ?? []) for (const n of readNames(t, ts)) reads.add(n)
  const text = (namespace) => {
    const call = `${namespace}.${name}(${args})`
    const declaration = kind === "const"
      ? `export ${constKeyword} ${name} = ${asyncWord}${typeParams}(${paramText}): ${ret} => ${asyncWord ? "await " : ""}${call}`
      : `export ${asyncWord}function ${name}${typeParams}(${paramText}): ${ret} {\n  return ${call}\n}`
    return doc + declaration
  }
  return { name, text, reads }
}

function exportedText(source, statement) {
  const start = statement.getStart(source)
  return leadingComments(source, statement) + "export " + source.text.slice(start, statement.end)
}

function statementText(source, statement) {
  const start = statement === source.statements[0] ? headerEnd(source) : statement.pos
  return source.text.slice(start, statement.end).replace(/^\s*\n/, "").replace(/^\n+/, "")
}

// Where the file's header comment ends: after the comments before the first
// statement that a blank line separates from it, or 0.
function headerEnd(source) {
  const first = source.statements[0]
  if (!first) return 0
  const leading = source.text.slice(0, first.getStart(source))
  const at = leading.lastIndexOf("\n\n")
  return at > 0 && leading.slice(0, at).trim() ? at : 0
}

function leadingComments(source, statement) {
  const leading = source.text.slice(statement === source.statements[0] ? headerEnd(source) : statement.pos, statement.getStart(source))
  const trimmed = leading.replace(/^\s*\n/, "").replace(/^\n+/, "")
  return trimmed.trim() ? trimmed : ""
}

// A comment that governs the whole file wherever its leading comments put it:
// Effect's `@effect-diagnostics x:off`, `@ts-nocheck`, a block `eslint-disable`
// or `oxlint-disable`, `biome-ignore-all`, a JSX pragma, a triple-slash
// directive. A -next-line or -line form governs one statement and moves with it.
const fileDirective = /^(?:\/\/\/\s*<(?:reference|amd-module|amd-dependency)\b|\/\/\s*@ts-(?:no)?check\b|(?:\/\/|\/\*+)\s*(?:@effect-diagnostics(?!-next-line)\b|(?:eslint|oxlint)-disable(?![-\w])|biome-ignore-all\b|@jsx(?:ImportSource|Runtime|Frag)?\b))/

// The file-wide directives among the comments before the first statement, in order.
function fileDirectives(source, ts) {
  return (ts.getLeadingCommentRanges(source.text, 0) ?? [])
    .map((r) => source.text.slice(r.pos, r.end))
    .filter((c) => fileDirective.test(c))
}

// The file's header comment, the comments before its first statement that a
// blank line separates from it.
function leadingHeader(source) {
  const at = headerEnd(source)
  return at ? [source.text.slice(0, at).trimEnd()] : []
}

function joinParts(...groups) {
  const lines = groups.filter((g) => g.length).map((g) => g.map((s) => s.replace(/\s+$/, "")).join("\n"))
  return lines.join("\n\n") + "\n"
}

function uniqueName(base, taken) {
  let name = base
  for (let i = 2; taken.has(name); i++) name = base + i
  return name
}

function firstLine(source, statement) {
  return source.text.slice(statement.getStart(source), statement.end).split("\n")[0].slice(0, 80)
}
