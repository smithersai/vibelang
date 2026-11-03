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
// A run names the earlier passes' receipts in its config.json,
// "platformCauses": [paths to settle-causes.json or reverted.json], and
// platformGlobalsFromCauses turns them into the split's globalsOf.
import { builtinModules } from "node:module"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"

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

/**
 * globalsOf(file) for splitBatchPlatform, from earlier passes' receipts:
 * settle-causes.json ({ "src/a.vibe": { diagnostics: [{ code, message }] } })
 * or reverted.json ([{ file, reason: "compile error: EK4402 ..." }]). A
 * receipt names a module by its .vibe or .ts path; file is the TypeScript
 * path the split reads. Only EK4402 messages count.
 */
export function platformGlobalsFromCauses(receipts) {
  const messages = new Map()
  const add = (file, message) => {
    if (typeof file !== "string" || typeof message !== "string") return
    for (const key of /\.vibe$/.test(file) ? [file.replace(/\.vibe$/, ".ts"), file.replace(/\.vibe$/, ".mts")] : [file]) {
      messages.set(key, [...(messages.get(key) ?? []), message])
    }
  }
  for (const receipt of receipts) {
    if (Array.isArray(receipt)) {
      for (const r of receipt) {
        const m = /\bEK4402:?\s+(.*)$/s.exec(String(r?.reason ?? ""))
        if (m) add(r.file, m[1])
      }
    } else if (receipt && typeof receipt === "object") {
      for (const [file, cause] of Object.entries(receipt)) {
        for (const d of cause?.diagnostics ?? []) if (d?.code === "EK4402") add(file, d.message)
      }
    }
  }
  return (file) => platformGlobalsOf(messages.get(file) ?? [])
}

/**
 * The run's "platformCauses" (config.json), read relative to the run
 * directory, as globalsOf for splitBatchPlatform. A listed receipt that is
 * missing is an error, not an empty hand-off.
 */
export function platformCausesOf(config, runDir) {
  const listed = config.platformCauses ?? []
  if (!Array.isArray(listed) || listed.some((p) => typeof p !== "string")) throw new Error("platformCauses must be a list of receipt paths")
  return platformGlobalsFromCauses(listed.map((p) => {
    const file = resolve(runDir, p)
    if (!existsSync(file)) throw new Error("platformCauses receipt missing: " + file)
    return JSON.parse(readFileSync(file, "utf8"))
  }))
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
    declarations.push({ statement, names: declaredNames(statement, ts), reads: readNames(statement, ts), valueReads: valueReadNames(statement, ts), exported: isExported(statement, ts) })
  }
  const typeOnly = (d) => ts.isInterfaceDeclaration(d.statement) || ts.isTypeAliasDeclaration(d.statement)
  // A name can have a value and a type of its own, Effect's schema pattern
  // `const Shape = Schema.String` with `type Shape = typeof Shape.Type`.
  const byName = new Map(), valueByName = new Map(), typeByName = new Map()
  for (const d of declarations) for (const name of d.names) {
    byName.set(name, d)
    ;(typeOnly(d) ? typeByName : valueByName).set(name, d)
  }
  // A value read takes the value; a name read only as a type takes the type.
  const declarationRead = (d, name) => {
    const value = valueByName.get(name), type = typeByName.get(name)
    return value && type ? (d.valueReads.has(name) ? value : type) : (value ?? type)
  }
  const moved = new Set(declarations.filter((d) => [...d.reads].some((n) => platform.has(n) && !byName.has(n))))
  if (!moved.size) return null
  // The moved code takes the module's own declarations it reads, values and types.
  // Types stay in the module, whose declarations name them: the sibling
  // imports an exported type, and has its own copy of a private type alias or
  // interface, which is the same type structurally.
  const typesFromModule = new Set()
  const copied = new Set()
  for (let grew = true; grew; ) {
    grew = false
    for (const d of [...moved, ...copied]) {
      // valueReads adds a type's read of its own name's value, `typeof X.Type`.
      for (const name of new Set([...d.reads, ...d.valueReads])) {
        const needed = declarationRead(d, name)
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
  // A kept type that reads a moved value, `type Shape = typeof Shape.Type`,
  // would make the module's declaration import it from the sibling.
  const movedValues = new Set([...moved].filter((d) => !typeOnly(d)).flatMap((d) => [...d.names]))
  for (const d of kept) {
    if (!typeOnly(d)) continue
    const read = [...d.valueReads].find((name) => movedValues.has(name))
    if (read) return { refused: `${file}: the type ${[...d.names].join(", ")} reads the value ${read}, which ${posix.basename(platformPath(file))} would take, so the module's declarations would change` }
  }
  // A type stays in the module, and its declaration carries the value of the
  // same name with it (TypeScript emits the merged symbol).
  const twin = [...movedValues].find((name) => typeByName.has(name))
  if (twin) return { refused: `${file}: the value ${twin} would move to ${posix.basename(platformPath(file))} but the type ${twin} stays, so the module's declarations would change` }
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

// A sibling is a new public entry point when a published package admits
// arbitrary subpaths. Do not create that API accidentally. Explicit export
// maps still go through the declaration graph gate, which rejects any new
// reachable declaration. An unknown wildcard mapping is deliberately refused
// rather than guessed from one tsconfig: packages may publish multiple builds.
function publishedSiblingRisk(root, file, { exists, read }) {
  const boundary = resolve(root)
  let dir = dirname(resolve(root, file))
  while (dir === boundary || dir.startsWith(boundary + "/")) {
    const path = posix.relative(boundary, join(dir, "package.json"))
    if (exists(path)) {
      let manifest
      try { manifest = JSON.parse(read(path)) }
      catch { return "cannot establish the package's published module surface" }
      if (manifest.private === true) return null
      const open = value => typeof value === "string"
        ? value.includes("*") || value.endsWith("/")
        : Array.isArray(value) ? value.some(open)
        : value && typeof value === "object" ? Object.values(value).some(open) : false
      if (manifest.exports === undefined || open(manifest.exports)) {
        return "a new published module could be exposed by the package's wildcard exports or open subpaths"
      }
      return null
    }
    if (dir === boundary) break
    dir = dirname(dir)
  }
  return null
}

/**
 * Splits each batch file that imports a builtin as a value, or reads a host
 * global globalsOf(file) names, writing <Name>.platform.ts beside it.
 * Returns { splits, refused }: the files written, and why each other file
 * keeps its platform code. With moduleBodies a module a sibling cannot serve
 * takes a VIP-40 module body instead: its split has platform null and module
 * the body's name.
 */
export function splitBatchPlatform(root, files, ts, {
  globalsOf = () => [],
  moduleBodies = false,
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
    const risk = result.refused ? null : publishedSiblingRisk(root, file, { exists, read })
    const refusal = result.refused ?? (risk && file + ": refusing " + sibling + ": " + risk + "; keep the platform code in TypeScript")
    if (refusal) {
      // A sibling cannot serve this module. With moduleBodies, a VIP-40 body may.
      const body = moduleBodies ? splitPlatformToModule(read(file), file, ts, { globals: globalsOf(file) }) : null
      if (!body || body.refused) { refused.push(body?.refused ? refusal + "; " + body.refused : refusal); continue }
      write(file, body.module)
      splits.push({ file, platform: null, module: body.name, moved: body.moved, wrapped: [] })
      continue
    }
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

// The identifiers statement reads as values: outside types, plus the first
// name of a `typeof X` query and a class's `extends` expression. A value
// declaration's own names are left out; a type's are not, since
// `type Shape = typeof Shape.Type` reads the value Shape.
function valueReadNames(statement, ts) {
  const reads = new Set()
  const visit = (node, inType) => {
    if (ts.isTypeQueryNode(node)) {
      let name = node.exprName
      while (ts.isQualifiedName(name)) name = name.left
      if (ts.isIdentifier(name)) reads.add(name.text)
      for (const t of node.typeArguments ?? []) visit(t, true)
      return
    }
    if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent)) {
      for (const t of node.types) { visit(t.expression, false); for (const a of t.typeArguments ?? []) visit(a, true) }
      return
    }
    const type = inType || ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeParameterDeclaration(node) || ts.isHeritageClause(node)
    if (!type && ts.isIdentifier(node)) {
      const parent = node.parent
      const declares = parent && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === node
      const member = parent && ((ts.isPropertyAccessExpression(parent) && parent.name === node) || ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent)) && parent.name === node))
      if (!declares && !member) reads.add(node.text)
    }
    if (!type && ts.isShorthandPropertyAssignment(node)) reads.add(node.name.text)
    ts.forEachChild(node, (child) => visit(child, type))
  }
  visit(statement, false)
  if (!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) for (const name of declaredNames(statement, ts)) reads.delete(name)
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

// VIP-40's target for the same split. A module body is a TypeScript file
// stored inside the .vibe file, so what a sibling must refuse, to keep from
// adding a published file, a body can hold: an export that is not a function
// with written types, a value and a type of one name, a default export, a
// wildcard package. The moved code stays verbatim in `module platform { }`, the
// module re-exports what moved, and its declarations name the same declarations.
//
// What moves is closed under reads, types included: a body sees nothing of the
// file (VIP-40, "No shared lexical scope"), and a kept type reading a moved
// value moves with it, since a declaration cannot read it through a body's
// value otherwise. A body cannot hold import.meta (EK4009), nor a module export = (EK4008).
// A top-level statement keeps its place only among its neighbours, and a body
// evaluates when imported, so a module with one to move stays TypeScript. So
// does a module left with no value of its own: a body holding the whole file is
// a .ts file with a harder name.

/**
 * Splits the TypeScript module text of file into a module with a module body.
 * Returns { module, moved, kept, name }, or { refused } saying why the module
 * keeps its platform code, or null when it reaches no platform code.
 */
export function splitPlatformToModule(text, file, ts, { globals = [] } = {}) {
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
  const declarations = source.statements.filter((s) => !ts.isImportDeclaration(s)).map((statement) => ({
    statement, names: declaredNames(statement, ts), reads: freeNames(statement, ts), valueReads: intersect(valueReadNames(statement, ts), freeNames(statement, ts, true)), exported: isExported(statement, ts)
  }))
  const declared = new Map()
  for (const d of declarations) for (const name of d.names) declared.set(name, [...(declared.get(name) ?? []), d])
  for (const name of globals) if (!imported.has(name) && !declared.has(name)) platform.add(name)
  if (!platform.size && !declarations.some((d) => importsPlatform(d.statement, ts))) return null
  if (source.statements.some((s) => ts.isExportAssignment(s) && s.isExportEquals)) return { refused: `${file}: export = has no place beside a module body (EK4008)` }
  const typeOnly = (d) => ts.isInterfaceDeclaration(d.statement) || ts.isTypeAliasDeclaration(d.statement)
  const reexport = (d) => ts.isExportDeclaration(d.statement)
  const moved = new Set(declarations.filter((d) => !reexport(d) && ([...d.reads].some((n) => platform.has(n) && !declared.has(n)) || importsPlatform(d.statement, ts))))
  if (!moved.size) return null
  for (let grew = true; grew; ) {
    grew = false
    const add = (d) => { if (!moved.has(d)) { moved.add(d); grew = true } }
    for (const d of [...moved]) {
      for (const name of new Set([...d.reads, ...d.valueReads])) for (const needed of declared.get(name) ?? []) add(needed)
      for (const name of d.names) for (const twin of declared.get(name) ?? []) add(twin)
    }
    const values = new Set([...moved].filter((d) => !typeOnly(d)).flatMap((d) => [...d.names]))
    for (const d of declarations) if (typeOnly(d) && [...d.valueReads].some((n) => values.has(n))) add(d)
    // An import is read-only (TS2632): whatever writes a moved binding moves with it.
    for (const d of declarations) if (!reexport(d) && [...writtenNames(d.statement, ts)].some((n) => values.has(n))) add(d)
  }
  const movable = (s) => ts.isVariableStatement(s) || ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s) || ts.isExportAssignment(s)
  for (const d of moved) {
    if (!movable(d.statement)) return { refused: `${file}: ${firstLine(source, d.statement)} runs in order among the module's statements, so it cannot move to a module body` }
    if (readsImportMeta(d.statement, ts)) return { refused: `${file}: ${firstLine(source, d.statement)} reads import.meta, which a module body cannot (EK4009)` }
  }
  const kept = declarations.filter((d) => !moved.has(d))
  if (!kept.some((d) => !typeOnly(d) && !reexport(d))) return { refused: `${file} is platform code only` }
  const keptReads = new Set(kept.flatMap((d) => [...d.reads]))
  const taken = new Set([...declared.keys(), ...imported, ...declarations.flatMap((d) => [...d.reads])])
  const name = uniqueName("platform", taken)
  const isDefault = (d) => ts.isExportAssignment(d.statement) || (d.statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  const movedList = declarations.filter((d) => moved.has(d))
  // What the module reads from the body, and what it re-exports, by meaning.
  const imports_ = [], typeImports = [], exports_ = [], typeExports = []
  let reexportsDefault = false
  const seen = new Set()
  for (const d of movedList) {
    if (isDefault(d)) {
      reexportsDefault = true
      for (const n of d.names) if (keptReads.has(n)) imports_.push(`default as ${n}`)
      continue
    }
    for (const n of d.names) {
      if (seen.has(n)) continue
      seen.add(n)
      const all = declared.get(n)
      const value = all.some((x) => !typeOnly(x))
      if (keptReads.has(n)) (value ? imports_ : typeImports).push(n)
      if (all.some((x) => x.exported && !typeOnly(x))) exports_.push(n)
      else if (all.some((x) => x.exported)) typeExports.push(n)
    }
  }
  const moduleReads = keptReads
  // A comment before the first import belongs to the file, not to a body's copy of that import.
  const bare = (i, keep) => {
    const whole = i.importClause && bindingsOf(i, ts).every(keep)
    if (!whole) return importText(i, source, ts, keep)
    return i === source.statements[0] ? source.text.slice(i.getStart(source), i.end) : statementText(source, i)
  }
  const fileComment = imports[0] === source.statements[0] ? leadingComments(source, imports[0]).trimEnd() : ""
  const head = imports.map((i) => bare(i, (b) => moduleReads.has(b.name))).filter(Boolean)
  if (fileComment) head.unshift(fileComment)
  const movedReads = new Set(movedList.flatMap((d) => [...d.reads]))
  const bodyImports = imports.map((i) => i.importClause ? bare(i, (b) => movedReads.has(b.name)) : null).filter(Boolean)
  // Every name a body declares is exported, read or not: a kept declaration's
  // inferred type may name it, which TypeScript could do in one file (TS4023 across two).
  const bodyStatements = movedList.map((d) => (!d.exported && !isDefault(d) && d.names.size ? exportedText(source, d.statement) : statementText(source, d.statement)))
  const body = [`module ${name} {`, joinParts(fileDirectives(source, ts), bodyImports, bodyStatements).trimEnd(), "}"].join("\n")
  const from = []
  if (imports_.length) from.push(`import { ${[...imports_].sort().join(", ")} } from ${name}`)
  if (typeImports.length) from.push(`import type { ${[...typeImports].sort().join(", ")} } from ${name}`)
  if (exports_.length) from.push(`export { ${[...exports_].sort().join(", ")} } from ${name}`)
  if (typeExports.length) from.push(`export type { ${[...typeExports].sort().join(", ")} } from ${name}`)
  if (reexportsDefault) from.push(`export { default } from ${name}`)
  const module = joinParts(leadingHeader(source), head, [body], from, kept.map((d) => statementText(source, d.statement)))
  return { module, name, moved: movedList.flatMap((d) => [...d.names]), kept: kept.flatMap((d) => [...d.names]) }
}

const intersect = (a, b) => new Set([...a].filter((x) => b.has(x)))

// The names statement reads that it does not bind itself at the read: a
// parameter or local of the name is no read of the top-level binding, and an
// import no kept code reads would be TS6133. Values and types have scopes of
// their own, `(session: session) => session`. With valuesOnly, value reads alone.
function freeNames(statement, ts, valuesOnly = false) {
  const free = new Set()
  const bindingNames = (name, into) => {
    if (ts.isIdentifier(name)) into.add(name.text)
    else if (name.elements) for (const e of name.elements) if (!ts.isOmittedExpression(e)) bindingNames(e.name, into)
  }
  const lexical = (statements, into) => {
    for (const s of statements) {
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) bindingNames(d.name, into)
      else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) into.add(s.name.text)
    }
  }
  const isDeclarationName = (node, parent) => (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isTypeParameterDeclaration(parent) || ts.isNamedTupleMember(parent) || ts.isLabeledStatement(parent)) && parent.name === node || (ts.isNamedTupleMember(parent) && parent.name === node) || (ts.isLabeledStatement(parent) && parent.label === node) || (ts.isBindingElement(parent) && parent.propertyName === node) || ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
  const isMemberName = (node, parent) => (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isQualifiedName(parent) && parent.right === node) || ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent)) && parent.name === node)
  const walk = (node, values, types, inType) => {
    let v = values, t = types
    if (ts.isExportDeclaration(node)) {
      // `export { a as b } from "./x"` and `export * as X from "./x"` read nothing here; `export { a as b }` reads a.
      if (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) for (const e of node.exportClause.elements) free.add((e.propertyName ?? e.name).text)
      return
    }
    const scopeV = () => { if (v === values) v = [...values, new Set()]; return v[v.length - 1] }
    const scopeT = () => { if (t === types) t = [...types, new Set()]; return t[t.length - 1] }
    if (ts.isFunctionLike(node)) {
      const own = scopeV()
      for (const p of node.parameters ?? []) bindingNames(p.name, own)
      if (ts.isFunctionExpression(node) && node.name) own.add(node.name.text)
    }
    if (node.typeParameters) { const own = scopeT(); for (const p of node.typeParameters) own.add(p.name.text) }
    if (ts.isClassLike(node) && node.name) { scopeV().add(node.name.text); scopeT().add(node.name.text) }
    if (ts.isBlock(node) || ts.isModuleBlock(node)) lexical(node.statements, scopeV())
    if (ts.isCaseBlock(node)) for (const c of node.clauses) lexical(c.statements, scopeV())
    if ((ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)) for (const d of node.initializer.declarations) bindingNames(d.name, scopeV())
    if (ts.isCatchClause(node) && node.variableDeclaration) bindingNames(node.variableDeclaration.name, scopeV())
    if (ts.isMappedTypeNode(node)) scopeT().add(node.typeParameter.name.text)
    if (ts.isConditionalTypeNode(node)) {
      const own = scopeT()
      const infers = (n) => { if (ts.isInferTypeNode(n)) own.add(n.typeParameter.name.text); ts.forEachChild(n, infers) }
      infers(node.extendsType)
    }
    if (ts.isTypeQueryNode(node)) {
      let name = node.exprName
      while (ts.isQualifiedName(name)) name = name.left
      if (ts.isIdentifier(name) && !v.some((s) => s.has(name.text))) free.add(name.text)
      for (const a of node.typeArguments ?? []) walk(a, v, t, true)
      return
    }
    const typeHere = inType || ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
    if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent)) {
      for (const h of node.types) { walk(h.expression, v, t, false); for (const a of h.typeArguments ?? []) walk(a, v, t, true) }
      return
    }
    if (ts.isIdentifier(node) && node.parent && !isDeclarationName(node, node.parent) && !isMemberName(node, node.parent)) {
      const parent = node.parent
      const typeRead = typeHere || (ts.isHeritageClause(parent.parent ?? parent)) || ts.isExpressionWithTypeArguments(parent) && !ts.isClassLike(parent.parent?.parent ?? parent)
      if (typeRead && !ts.isTypePredicateNode(parent)) { if (!valuesOnly && !t.some((s) => s.has(node.text))) free.add(node.text) }
      else if (!v.some((s) => s.has(node.text))) free.add(node.text)
    }
    if (ts.isShorthandPropertyAssignment(node) && !v.some((s) => s.has(node.name.text))) free.add(node.name.text)
    ts.forEachChild(node, (child) => walk(child, v, t, typeHere))
  }
  walk(statement, [], [], false)
  if (!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) for (const name of declaredNames(statement, ts)) free.delete(name)
  return free
}

// The names statement assigns: x = 1, x += 1, x++, [x] = a, ({ x } = a).
function writtenNames(statement, ts) {
  const written = new Set()
  const target = (node) => {
    if (ts.isParenthesizedExpression(node)) return target(node.expression)
    if (ts.isIdentifier(node)) written.add(node.text)
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(target)
    else if (ts.isObjectLiteralExpression(node)) for (const p of node.properties) {
      if (ts.isShorthandPropertyAssignment(p)) written.add(p.name.text)
      else if (ts.isPropertyAssignment(p)) target(p.initializer)
    }
    else if (ts.isSpreadElement(node)) target(node.expression)
  }
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target(node.left)
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) target(node.operand)
    ts.forEachChild(node, visit)
  }
  visit(statement)
  return written
}

// import("node:fs/promises"): EK4402 reports a dynamic import of a builtin as it does a static one.
function importsPlatform(node, ts) {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && isPlatformModule(node.arguments[0].text)) return true
  return !!ts.forEachChild(node, (child) => importsPlatform(child, ts) || undefined)
}

function readsImportMeta(node, ts) {
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return true
  return !!ts.forEachChild(node, (child) => readsImportMeta(child, ts) || undefined)
}
