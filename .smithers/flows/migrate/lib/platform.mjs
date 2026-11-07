import { splitImportMeta, privateResolverExports, isWritten } from "./import-meta-platform.mjs"
// Platform code in a module the batch migrates (spec 005, EK4402: "The quick
// fix and the codemod move the code into a sibling `.ts` module, or point to
// the Effect service"). A .vibe file does not import a Node or Bun builtin as
// a value, so before the rename the codemod moves each top-level declaration
// that uses one, with the module's own declarations it needs, into
// <Name>.platform.ts beside the module, verbatim. The module keeps every
// export: an exported function that moved stays as a function with the same
// signature that calls the moved one, so the module's declarations are
// unchanged. A module whose moved exports are not such functions keeps
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

// The EK4402 texts whose {0} is a host global or a member path from one
// (typescript/tsc/internal/vibelang: diagnostics.go's EK4402, unlistedHostGlobal
// in host_global_declarations.go, checkPlatformHostMembers in
// platform_host_members.go). test/platform-globals-wording.test.mjs reads that
// table and fails on an EK4402 text this list does not classify.
export const globalWordings = ["is platform code", "reads a host global", "reaches the host"]
// EK0107 also covers legacy JavaScript. Only this explicit platform escape
// names a host global for the preserving TypeScript split.
const globalThisEscapeMessage = "Use globalThis only as the object of a statically named member access; move this use to a .ts file."
// Prelude collisions retain a TypeScript diagnostic code. Only the compiler's
// explicit platform note names a host value; the generic type error does not.
const preludePlatformNote = /^The global ([A-Za-z_$][\w$]*)(?: is| has \1\.[A-Za-z_$][\w$]*, and it is) platform code, which lives in a \.ts file\.$/
const platformGlobalCause = (code, message) => code === "EK4402" || code === "EK0107" && message === globalThisEscapeMessage ||
  /^TS\d+$/.test(code) && preludePlatformNote.test(message)
const diagnosticNotes = notes => Array.isArray(notes)
  ? notes.filter(note => typeof note === "string").map(note => note.trim())
  // Legacy receipts join diagnostic notes into one string. The compiler's
  // host-value explanation is its final sentence; retain that boundary.
  : typeof notes === "string" ? [notes.trim().split(/(?<=\.)\s+|\r?\n/).at(-1)] : []

// A clock or randomness read is named as written, with its call: crypto.randomUUID(), new Date().
const globalMessage = new RegExp(String.raw`^(?:new )?([A-Za-z_$][\w$]*)(?:\??\.[\w$.?]*|\[[^\]]*\])*(?:\(\))? (?:${globalWordings.join("|")})`)
// A read through a cast names the global it casts: "(globalThis as { readonly
// location?: … }).location is platform code" (smithers FetchFailures).
const castMessage = new RegExp(String.raw`^\(\s*([A-Za-z_$][\w$]*)\s+(?:as|satisfies)\s[\s\S]*\)(?:\??\.[\w$.?]*|\[[^\]]*\])*(?:\(\))? (?:${globalWordings.join("|")})`)

/**
 * The host globals that EK4402 messages name, as the identifiers a
 * declaration reads: "process.env is platform code" names process,
 * "globalThis.crypto.subtle is platform code" names globalThis and
 * globalThis.crypto (globalNames reads that entry against the source), "Blob
 * reads a host global" (a global VIP-33 derives) names Blob, and
 * "AbortSignal.timeout reaches the host" (a platform member) names
 * AbortSignal. A builtin import ("createHash from node:crypto is platform
 * code") is split without being named, and a message about anything else
 * names nothing. The explicit EK0107 globalThis escape names globalThis too.
 * A prelude-collision note names the host value the compiler identifies.
 * The diagnostic carries only its text, so these are the
 * wordings of the compiler's message table (globalWordings).
 */
export function platformGlobalsOf(messages) {
  const names = new Set()
  for (const message of messages) {
    const text = String(message).replace(/^\s*(?:error\s+)?EK4402:\s*/, "")
    if (text.replace(/^\s*(?:error\s+)?EK0107:\s*/, "") === globalThisEscapeMessage) { names.add("globalThis"); continue }
    const prelude = preludePlatformNote.exec(text)
    if (prelude) { names.add(prelude[1]); continue }
    if (/^\S+ from \S+ is platform code/.test(text)) continue
    const cast = castMessage.exec(text)
    if (cast) { names.add(cast[1]); continue }
    const m = globalMessage.exec(text)
    if (m && m[1] !== "import") names.add(m[1])
    // vibelang --fix qualifies a constructor the prelude hides, so
    // `new Response(…)` is checked as `new globalThis.Response(…)` and the
    // message names globalThis. The qualified member is named too, for the
    // split to read against the TypeScript, which may spell it bare.
    const member = m?.[1] === "globalThis" && /^(?:new )?globalThis(?:\??\.([A-Za-z_$][\w$]*)|\??\.?\[(["'`])([A-Za-z_$][\w$]*)\2\])/.exec(text)
    if (member) names.add("globalThis." + (member[1] ?? member[3]))
  }
  return [...names].sort()
}

/**
 * globalsOf(file) for splitBatchPlatform, from earlier passes' receipts:
 * settle-causes.json ({ "src/a.vibe": { diagnostics: [{ code, message }] } })
 * or reverted.json ([{ file, reason: "compile error: EK4402 ..." }]). A
 * receipt names a module by its .vibe or .ts path; file is the TypeScript
 * path the split reads. EK4402 messages and the explicit EK0107
 * globalThis platform escape count, as do exact platform notes attached to
 * TypeScript diagnostics. Unrelated type errors and legacy JavaScript do not.
 */
export function platformGlobalsFromCauses(receipts) {
  const messages = new Map()
  const add = (file, message) => {
    if (typeof file !== "string" || typeof message !== "string") return
    for (const key of /\.vibex$/.test(file) ? [file.replace(/\.vibex$/, ".tsx")] : /\.vibe$/.test(file) ? [file.replace(/\.vibe$/, ".ts"), file.replace(/\.vibe$/, ".mts")] : [file]) {
      messages.set(key, [...(messages.get(key) ?? []), message])
    }
  }
  for (const receipt of receipts) {
    if (Array.isArray(receipt)) {
      for (const r of receipt) {
        const m = /\b(EK4402|EK0107|TS\d+):?\s+(.*)$/s.exec(String(r?.reason ?? ""))
        if (m) for (const message of [m[2], ...diagnosticNotes(r.notes)]) {
          if (platformGlobalCause(m[1], message)) add(r.file, message)
        }
      }
    } else if (receipt && typeof receipt === "object") {
      for (const [file, cause] of Object.entries(receipt)) {
        for (const d of cause?.diagnostics ?? []) {
          for (const message of [d?.message, ...diagnosticNotes(d?.notes)]) {
            if (platformGlobalCause(d?.code, message)) add(file, message)
          }
        }
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
export const platformPath = (file) => file.replace(/\.(m?ts|tsx|vibex)$/, (_, extension) => ".platform." + (extension === "vibex" ? "tsx" : extension))

/**
 * Splits the TypeScript module text of file (repository-relative). Returns
 * { module, platform, moved, wrapped } with the two texts, or { refused }
 * saying why the module keeps its platform code, or null when it imports no
 * builtin as a value and reads none of globals, the host globals to move
 * (platformGlobalsOf).
 */
export function splitPlatform(text, file, ts, { globals = [], returnsAvoid } = {}) {
  const meta = splitImportMeta(text, file, platformPath(file), ts)
  if (!meta) return splitDeclarationsPlatform(text, file, ts, { globals, returnsAvoid })
  if (meta.refused) return meta
  const declarations = splitDeclarationsPlatform(meta.module, file, ts, { globals, returnsAvoid })
  if (declarations?.refused) return declarations
  const directives = fileDirectives(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), ts)
  meta.platform = [...directives, meta.platform].join("\n")
  if (!declarations) return meta
  // Both repairs share the fresh companion. Moved declarations call its local
  // helpers instead of importing the companion from itself.
  const companion = posix.basename(platformPath(file))
  const self = new RegExp("^import \\{[^}\\n]*\\} from \"\\./" + escapeRegExp(companion) + "\"\\n?", "m")
  const moved = declarations.platform.replace(self, "")
  return { ...declarations, importMeta: meta.importMeta, importText: meta.importText,
    platform: meta.platform + "\n" + moved,
    moved: [...meta.moved, ...declarations.moved] }
}

// The identifiers a split moves the readers of, for the globals the messages
// name. A "globalThis.X" entry is a qualified read the message reports: when
// the source spells it so, globalThis already names its readers; when the
// source never does, vibelang --fix qualified a bare X (a constructor the
// prelude hides), and the bare X is what the source reads.
function globalNames(globals, source, ts) {
  const qualified = new Set()
  const visit = (node) => {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === "globalThis") {
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined
      if (key !== undefined) qualified.add(key)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...new Set([...globals].flatMap((name) => !name.startsWith("globalThis.") ? [name] : qualified.has(name.slice("globalThis.".length)) ? [] : [name.slice("globalThis.".length)]))]
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function splitDeclarationsPlatform(text, file, ts, { globals = [], returnsAvoid } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.(?:tsx|vibex)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
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
  const hostGlobals = new Set(globalNames(globals, source, ts).filter((name) => !imported.has(name) && !declaredAtTop.has(name)))
  for (const name of hostGlobals) platform.add(name)
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
  // A type alias or interface names a host global only as a type, which a .vibe
  // file may write (`readonly signal?: AbortSignal`, `ReturnType<typeof
  // setTimeout>`), so it moves only for a builtin import it reads; moved code
  // that reads it takes a private copy, and the module keeps the declaration.
  const platformRead = (d, n) => platform.has(n) && !byName.has(n) && !(typeOnly(d) && hostGlobals.has(n))
  const moved = new Set(declarations.filter((d) => [...d.reads].some((n) => platformRead(d, n))))
  if (!moved.size) return null
  // The moved code takes the module's own declarations it reads, values and types.
  // Types stay in the module, whose declarations name them. The sibling has
  // its own private copy of a type alias or interface it needs, the same type
  // structurally, so it never imports the module that imports it: the
  // original was one module, with no cycle (t3code mobile's dependency-graph
  // test). An exported type is imported instead when the copy would read a
  // value of the module, merge with another declaration, or is a default export.
  // An exported const whose value is a primitive computed from literals,
  // `export const limit = 64`, is copied the same way: a primitive has no
  // identity, so the module keeps its export and the moved code reads an equal
  // private copy (constantCopies below keeps its temporal dead zone).
  const declarationCount = new Map()
  for (const d of declarations) for (const name of d.names) declarationCount.set(name, (declarationCount.get(name) ?? 0) + 1)
  const copiesExported = (d, seen = new Set()) => {
    if (seen.has(d)) return true
    seen.add(d)
    if (isDefaultExport(d.statement, ts) || [...d.names].some((n) => declarationCount.get(n) > 1)) return false
    for (const name of new Set([...d.reads, ...d.valueReads])) {
      const needed = declarationRead(d, name)
      if (!needed) continue
      if (!typeOnly(needed) || !copiesExported(needed, seen)) return false
    }
    return true
  }
  const constants = primitiveConstants(declarations, ts)
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
          if (needed.exported && !copiesExported(needed)) typesFromModule.add(name)
          else { copied.add(needed); grew = true }
          continue
        }
        // A copied const takes its own constants with it.
        if (constants.has(needed) && (needed.exported || copied.has(d))) { copied.add(needed); grew = true; continue }
        if (copied.has(d)) return { refused: `${file}: the type ${[...d.names].join(", ")} reads the value ${name}` }
        moved.add(needed); grew = true
      }
    }
    // An import is read-only (TS2632): whatever writes a moved binding moves with it.
    const movedNames = new Set([...moved].filter((d) => !typeOnly(d)).flatMap((d) => [...d.names]))
    for (const d of declarations) {
      if (moved.has(d) || typeOnly(d)) continue
      if ([...writtenNames(d.statement, ts)].some((n) => movedNames.has(n) && !d.names.has(n))) { moved.add(d); grew = true }
    }
  }
  for (const d of moved) {
    if (!isMovable(d.statement, ts)) return { refused: `${file}: ${firstLine(source, d.statement)} cannot move to ${posix.basename(platformPath(file))}` }
  }
  const early = earlyConstant(declarations, moved, copied, constants, ts)
  if (early) return { refused: `${file}: export ${[...early.names].join(", ")} uses platform code and is not a function with written parameter and return types, so it cannot stay in the .vibe module` }
  // import.meta.url names the module that reads it, so in the sibling it would
  // name the sibling. A URL resolved against it for a path beside the module
  // means the same in either file.
  const requires = createRequireNames(imports, ts)
  requires.directories = directoryNames(imports, ts)
  for (const d of moved) {
    if (namesModule(d.statement, ts, requires)) return { refused: `${file}: ${firstLine(source, d.statement)} reads import.meta, which would name ${posix.basename(platformPath(file))} after the move` }
  }
  const kept = declarations.filter((d) => !moved.has(d))
  const inferredTypes = inferredFactoryTypeText(source, kept, moved, declarations, imported, ts, file)
  if (inferredTypes.refused) return inferredTypes
  // A kept type that reads a moved value, `type Shape = typeof Shape.Type`,
  // would make the module's declaration import it from the sibling. A moved
  // export that stays as a wrapper of its own name and signature is still the
  // module's value, so `type Timer = ReturnType<typeof createTimer>` reads the
  // wrapper and its declaration does not change.
  const movedValues = new Set([...moved].filter((d) => !typeOnly(d)).flatMap((d) => [...d.names]))
  const wrapped = new Set([...moved].filter((d) => d.exported && !typeOnly(d) && wrapperOf(d.statement, source, ts)).flatMap((d) => [...d.names]))
  for (const d of kept) {
    if (!typeOnly(d)) continue
    const read = [...d.valueReads].find((name) => movedValues.has(name) && !wrapped.has(name))
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
    if (!wrapper) return { refused: `${file}: export ${[...d.names].join(", ")} uses platform code and is not a function with written parameter types, so it cannot stay in the .vibe module` }
    wrappers.push({ d, ...wrapper })
  }
  // An inferred return type is written into the module's declarations from
  // the sibling. A type only the sibling declares, a private copy or a moved
  // private class or enum, has no name there (TS4058), so an exported type the
  // moved code reads is imported from the module instead of copied, and a
  // private one keeps the module in TypeScript.
  // returnsAvoid(name, types), when the caller has a type checker, proves that
  // export name's return type names none of types; a proved export keeps its
  // wrapper beside them (splitBatchPlatform supplies it from the module's tsconfig).
  const inferredWrappers = wrappers.filter((w) => w.inferred && !returnsOnlyElements(w.d.statement, ts))
  if (inferredWrappers.length) {
    const unnamed = [...[...copied].filter((d) => typeOnly(d) && !d.exported),
      ...[...moved].filter((d) => !d.exported && (ts.isClassDeclaration(d.statement) || ts.isEnumDeclaration(d.statement)))]
    const unnamedNames = unnamed.flatMap((d) => [...d.names])
    const inferred = unnamed.length ? inferredWrappers.find((w) => !returnsAvoid?.(w.name, unnamedNames)) : undefined
    if (inferred) return { refused: `${file}: export ${inferred.name} has an inferred return type that may name ${[...unnamed[0].names].join(", ")}, which only ${posix.basename(platformPath(file))} would declare, so the module's declarations would change` }
    for (const d of [...copied]) if (typeOnly(d) && d.exported) { copied.delete(d); for (const name of d.names) typesFromModule.add(name) }
  }
  if (moved.size === declarations.length && !wrappers.length) return { refused: `${file} is platform code only` }
  // A private type the module kept for the moved code alone is the sibling's
  // copy now; left in the module, nothing reads it (TS6196 under
  // noUnusedLocals: opencode app runtime/persistence/storage). It goes, and so
  // does a private type only such a type read.
  const unread = new Set()
  for (let grew = true; grew; ) {
    grew = false
    for (const d of kept) {
      if (unread.has(d) || !typeOnly(d) || d.exported || !copied.has(d)) continue
      const reads = (names) => [...d.names].some((n) => names.has(n))
      if (kept.some((k) => k !== d && !unread.has(k) && reads(k.reads)) || wrappers.some((w) => reads(w.reads))) continue
      unread.add(d)
      grew = true
    }
  }
  const moduleKeptReads = new Set(kept.filter((d) => !unread.has(d)).flatMap((d) => [...d.reads]))
  const namespace = uniqueName("$platform", new Set([...byName.keys(), ...imports.flatMap((i) => bindingsOf(i, ts).map((b) => b.name))]))
  const sibling = "./" + posix.basename(platformPath(file))
  // The module: kept imports, the import of the moved code, kept declarations and wrappers, in source order.
  const movedReadsByKept = [...moved].filter((d) => !d.exported).flatMap((d) => [...d.names].filter((n) => moduleKeptReads.has(n)))
  const fromSibling = [...new Set(movedReadsByKept)].sort()
  const moduleReads = new Set([...moduleKeptReads, ...wrappers.flatMap((w) => [...w.reads])])
  const moduleImports = imports.map((i) => importText(i, source, ts, (b) => moduleReads.has(b.name))).filter(Boolean)
  const head = [...moduleImports]
  if (wrappers.length) head.push(`import * as ${namespace} from "${sibling}"`)
  // An import is not narrowed inside a closure the way a local const is, so a
  // moved const comes back under an alias and is bound to a local const of its
  // own name where it stood. Its explicit type retains unique-symbol identity
  // as well as the imported value type and local-const narrowing.
  const movedConsts = new Set([...moved].filter((d) => !d.exported && ts.isVariableStatement(d.statement) && (d.statement.declarationList.flags & ts.NodeFlags.Const)).flatMap((d) => [...d.names]))
  const taken = new Set([...byName.keys(), ...imports.flatMap((i) => bindingsOf(i, ts).map((b) => b.name)), namespace])
  const alias = new Map()
  for (const name of fromSibling) if (movedConsts.has(name)) { const a = uniqueName(name + "$platform", taken); taken.add(a); alias.set(name, a) }
  if (fromSibling.length) head.push(`import { ${fromSibling.map((n) => (alias.has(n) ? `${n} as ${alias.get(n)}` : n)).join(", ")} } from "${sibling}"`)
  const body = []
  for (const d of declarations) {
    if (unread.has(d)) continue
    if (!moved.has(d)) body.push(inferredTypes.text(d.statement))
    else if (d.exported) body.push(wrappers.find((w) => w.d === d).text(namespace))
    else for (const name of [...d.names].filter((n) => alias.has(n))) body.push(`const ${name}: typeof ${alias.get(name)} = ${alias.get(name)}`)
  }
  const moduleText = joinParts(leadingHeader(source), head, body)
  // The sibling: the imports the moved code reads, then the moved code, each
  // declaration the module reads exported.
  const movedList = declarations.filter((d) => moved.has(d) || copied.has(d))
  const movedReads = new Set(movedList.flatMap((d) => [...d.reads]))
  const platformImports = imports.map((i) => importText(i, source, ts, (b) => movedReads.has(b.name))).filter(Boolean)
  if (typesFromModule.size) platformImports.push(`import type { ${[...typesFromModule].sort().join(", ")} } from "./${posix.basename(file)}"`)
  const platformBody = movedList.map((d) => (copied.has(d) && d.exported ? unexportedText(source, d.statement, ts) : !d.exported && fromSibling.some((n) => d.names.has(n)) ? exportedText(source, d.statement) : statementText(source, d.statement)))
  const note = `// The platform code of ${posix.basename(file).replace(/\.tsx$/, ".vibex").replace(/\.m?ts$/, ".vibe")}, which a .vibe file does not import as a value (EK4402).`
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
function owningManifest(root, file, { exists, read }) {
  const boundary = resolve(root)
  for (let dir = dirname(resolve(root, file)); dir === boundary || dir.startsWith(boundary + "/"); dir = dirname(dir)) {
    const path = posix.relative(boundary, join(dir, "package.json"))
    if (exists(path)) { try { return JSON.parse(read(path)) } catch { return undefined } }
    if (dir === boundary) break
  }
  return undefined
}

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
      // A wildcard target whose text after * ends in a fixed file name, such
      // as "./dist/*/neon.js", matches only files of that name. A companion is
      // named <stem>.platform.<extension>, so no such target can publish it.
      const fixedFile = target => {
        const parts = target.split("*")
        if (parts.length !== 2) return false
        const slash = parts[1].lastIndexOf("/")
        return slash >= 0 && !parts[1].slice(slash + 1).includes(".platform.")
      }
      const open = value => typeof value === "string"
        ? value.includes("*") && !fixedFile(value) || value.endsWith("/")
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
 * A type checker over file as its tsconfig compiles it, or null when none can
 * be built. The returned returnsAvoid(name, types) says whether export name's
 * return type provably names none of types, the module's own private types:
 * it walks type arguments, unions, intersections and the structures this file
 * declares, and an `any` it meets (an import the checker could not resolve,
 * such as a .vibe module) proves nothing.
 */
export function checkedReturns(root, file, ts) {
  const path = resolve(root, file)
  let program
  try {
    const config = ts.findConfigFile(dirname(path), ts.sys.fileExists)
    const parsed = config ? ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }) : undefined
    program = ts.createProgram({ rootNames: [path], options: { ...(parsed?.options ?? {}), noEmit: true } })
  } catch {
    return null
  }
  const source = program.getSourceFile(path)
  const checker = program.getTypeChecker()
  const module = source && checker.getSymbolAtLocation(source)
  if (!module) return null
  return (name, types) => {
    const symbol = checker.getExportsOfModule(module).find((s) => s.name === name)
    if (!symbol) return false
    const wanted = new Set(types)
    const own = (s) => (s?.declarations ?? []).some((d) => d.getSourceFile() === source)
    const seen = new Set()
    let proven = true
    const visit = (type, depth) => {
      if (!proven || !type || seen.has(type)) return
      seen.add(type)
      if (depth > 16 || type.flags & ts.TypeFlags.Any) { proven = false; return }
      for (const s of [type.aliasSymbol, type.symbol]) if (s && wanted.has(s.name) && own(s)) { proven = false; return }
      for (const t of type.aliasTypeArguments ?? []) visit(t, depth + 1)
      for (const t of type.types ?? []) visit(t, depth + 1)
      if (!(type.flags & ts.TypeFlags.Object)) return
      if (type.objectFlags & ts.ObjectFlags.Reference) for (const t of checker.getTypeArguments(type)) visit(t, depth + 1)
      // Another module's named type cannot name this module's private types,
      // except through its type arguments, visited above.
      if (!own(type.symbol)) return
      for (const p of checker.getPropertiesOfType(type)) visit(checker.getTypeOfSymbolAtLocation(p, source), depth + 1)
      for (const info of checker.getIndexInfosOfType(type)) visit(info.type, depth + 1)
      for (const s of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
        visit(checker.getReturnTypeOfSignature(s), depth + 1)
        for (const p of s.parameters) visit(checker.getTypeOfSymbolAtLocation(p, source), depth + 1)
      }
    }
    for (const s of checker.getTypeOfSymbolAtLocation(symbol, source).getCallSignatures()) visit(checker.getReturnTypeOfSignature(s), 0)
    return proven
  }
}

/**
 * Splits each batch file that imports a builtin as a value, or reads a host
 * global globalsOf(file) names, writing <Name>.platform.ts beside it.
 * Returns { splits, refused }: the files written, and why each other file
 * keeps its platform code. With moduleBodies a module a sibling cannot serve
 * takes a VIP-40 module body instead: its split has platform null and module
 * the body's name. With throwBodies, on by default, the declarations that
 * throw in plain code move into `module throwing { }`, or into the module's
 * platform body when it takes one; a split with such a body lists them in
 * throwing. Without moduleBodies such a body may hold no export of the module.
 */
export function splitBatchPlatform(root, files, ts, {
  globalsOf = () => [],
  moduleBodies = false,
  throwBodies = true,
  exists = file => existsSync(join(root, file)),
  read = file => readFileSync(join(root, file), "utf8"),
  write = (file, text) => writeFileSync(join(root, file), text),
  returnsAvoidOf = file => checkedReturns(root, file, ts)
} = {}) {
  const splits = []
  const refused = []
  // A body cannot hold import.meta (EK4009): the import.meta reads the
  // companion serves keep it beside the body, private as for the sibling split.
  const bodySplit = (file, sibling) => {
    const text = read(file)
    const meta = splitImportMeta(text, file, sibling, ts)
    if (meta?.refused) return meta
    const body = splitPlatformToModule(meta ? meta.module : text, file, ts, { globals: globalsOf(file), throws: throwBodies })
    if (!body || body.refused || !meta) return body
    const risk = publishedSiblingRisk(root, file, { exists, read })
    const privateExports = risk && meta.importMeta ? privateResolverExports(root, file, sibling, { exists, read }) : null
    if (risk && !privateExports) return { refused: file + ": refusing " + sibling + " for the import.meta helpers beside module " + body.name + ": " + risk }
    const directives = fileDirectives(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), ts)
    return { ...body, platform: [...directives, meta.platform].join("\n"), privateExports, moved: [...meta.moved, ...body.moved] }
  }
  const writeBody = (file, sibling, body) => {
    write(file, body.module)
    if (body.platform) write(sibling, body.platform)
    if (body.privateExports) {
      const pkg = JSON.parse(read(body.privateExports.manifest))
      for (const key of body.privateExports.keys) pkg.exports[key] = null
      write(body.privateExports.manifest, JSON.stringify(pkg, null, 2) + "\n")
    }
    splits.push({ file, platform: body.platform ? sibling : null, ...(body.privateExports ? { privateExports: body.privateExports } : {}), module: body.name, moved: body.moved, wrapped: [], ...(body.throwing.length ? { throwing: body.throwing } : {}) })
  }
  for (const file of files) {
    if (!/\.(?:m?ts|tsx|vibex)$/.test(file) || /\.d\.(?:m?ts|tsx|vibex)$/.test(file)) continue
    const sibling = platformPath(file)
    if (exists(sibling)) { refused.push(`${file}: ${sibling} already exists`); continue }
    let result = splitPlatform(read(file), file, ts, { globals: globalsOf(file) })
    // A refusal only an inferred return type's possible private names caused
    // is retried with a type checker that proves which exports avoid them.
    if (result?.refused && / has an inferred return type that may name /.test(result.refused)) {
      const returnsAvoid = returnsAvoidOf(file)
      if (returnsAvoid) result = splitPlatform(read(file), file, ts, { globals: globalsOf(file), returnsAvoid })
    }
    // Code that throws in plain code reports EK0401 in a .vibe module; a body
    // keeps it TypeScript, the 2026-10-31 ruling's "ts module using module syntax".
    // An export the body holds is re-exported: its `x.vibe.throwing.d.ts`
    // ships with the package and joins no `exports` entry, and the module's
    // declarations keep its names, types and documentation.
    const throwing = (text) => throwBodies ? splitPlatformToModule(text, file, ts, { throws: true, platform: moduleBodies, reexports: true }) : null
    if (!result) {
      const body = throwing(read(file))
      if (body?.refused) refused.push(body.refused)
      else if (body) {
        write(file, body.module)
        splits.push({ file, platform: null, module: body.name, moved: body.moved, wrapped: [], throwing: body.throwing })
      }
      continue
    }
    const risk = result.refused ? null : publishedSiblingRisk(root, file, { exists, read })
    const privateExports = risk && result.importMeta ? privateResolverExports(root, file, sibling, { exists, read }) : null
    const refusal = result.refused ?? (risk && !privateExports && file + ": refusing " + sibling + ": " + risk + "; keep the platform code in TypeScript")
    // Every module of a private package is an API entry, so a sibling adds one;
    // a VIP-40 body adds none. With moduleBodies, prefer it and keep the sibling as fallback.
    // A body cannot hold import.meta (EK4009), so a module whose import.meta
    // reads need the companion's helpers keeps the sibling.
    if (!refusal && moduleBodies && !result.importText && owningManifest(root, file, { exists, read })?.private === true) {
      const body = splitPlatformToModule(read(file), file, ts, { globals: globalsOf(file), throws: throwBodies, wrap: true })
      if (body && !body.refused) {
        write(file, body.module)
        splits.push({ file, platform: null, module: body.name, moved: body.moved, wrapped: body.wrapped, ...(body.throwing.length ? { throwing: body.throwing } : {}) })
        continue
      }
    }
    if (refusal) {
      // A sibling cannot serve this module. With moduleBodies, a VIP-40 body may.
      const body = moduleBodies ? bodySplit(file, sibling) : null
      if (!body || body.refused) { refused.push(body?.refused ? refusal + "; " + body.refused : refusal); continue }
      writeBody(file, sibling, body)
      continue
    }
    const body = throwing(result.module)
    if (body?.refused) refused.push(body.refused)
    const kept = body && !body.refused ? body : null
    write(file, kept ? kept.module : result.module)
    write(sibling, result.platform)
    if (privateExports) {
      const pkg = JSON.parse(read(privateExports.manifest))
      for (const key of privateExports.keys) pkg.exports[key] = null
      write(privateExports.manifest, JSON.stringify(pkg, null, 2) + "\n")
    }
    splits.push({ file, platform: sibling, ...(privateExports ? { privateExports } : {}), moved: result.moved, wrapped: result.wrapped, ...(kept ? { module: kept.name, throwing: kept.throwing } : {}) })
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
  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name) && !(statement.flags & ts.NodeFlags.GlobalAugmentation)) {
    names.add(statement.name.text)
  }
  return names
}

// Type-only namespace companions erase at runtime. Moving their merged value
// must keep these declarations in the same lexical module. Runtime namespace
// initializers retain the conservative statement-order refusal.
function typeNamespace(statement, ts) {
  if (!ts.isModuleDeclaration(statement) || !ts.isIdentifier(statement.name) || (statement.flags & ts.NodeFlags.GlobalAugmentation)) return false
  const body = statement.body
  if (!body) return false
  if (ts.isModuleDeclaration(body)) return typeNamespace(body, ts)
  return ts.isModuleBlock(body) && body.statements.every(s =>
    ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || typeNamespace(s, ts))
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

// The top-level consts whose value is a primitive computed from literals and
// other such consts, with no written type: `const limit = 64`, `const name =
// "ps"`, `const bytes = 4 * 1024`. Evaluating one runs no code and gives an
// equal value each time, so a copy of it is the same constant.
function primitiveConstants(declarations, ts) {
  const candidates = new Map()
  for (const d of declarations) {
    const s = d.statement
    if (!ts.isVariableStatement(s) || !(s.declarationList.flags & ts.NodeFlags.Const)) continue
    const [v, ...rest] = s.declarationList.declarations
    if (rest.length || !ts.isIdentifier(v.name) || v.type || !v.initializer) continue
    candidates.set(v.name.text, d)
  }
  const primitive = (node, names) => {
    while (ts.isParenthesizedExpression(node) || ((ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) && constType(node.type, ts))) node = node.expression
    if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true
    if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true
    if (ts.isIdentifier(node)) { names.push(node.text); return true }
    if (ts.isPrefixUnaryExpression(node)) return [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(node.operator) && primitive(node.operand, names)
    if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => primitive(span.expression, names))
    if (ts.isConditionalExpression(node)) return primitive(node.condition, names) && primitive(node.whenTrue, names) && primitive(node.whenFalse, names)
    if (ts.isBinaryExpression(node)) return primitiveOperators(ts).has(node.operatorToken.kind) && primitive(node.left, names) && primitive(node.right, names)
    return false
  }
  // Each const reads only literals and other primitive consts; one that reads
  // anything else, or a const that does, is not one.
  const reads = new Map()
  for (const [name, d] of candidates) {
    const names = []
    if (primitive(d.statement.declarationList.declarations[0].initializer, names)) reads.set(name, names)
  }
  for (let shrank = true; shrank; ) {
    shrank = false
    for (const [name, names] of reads) if (names.some((n) => !reads.has(n) || n === name)) { reads.delete(name); shrank = true }
  }
  return new Set([...reads.keys()].map((name) => candidates.get(name)))
}

const constType = (type, ts) => ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "const" ||
  ts.isLiteralTypeNode(type) || [ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.BooleanKeyword, ts.SyntaxKind.BigIntKeyword].includes(type.kind)

const primitiveOperators = (ts) => new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.BarToken, ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken])

// The sibling evaluates before the module body, so a copied const is
// initialized before any kept statement runs. In the original a kept statement
// above the const that ran the moved code at load read it in its temporal
// dead zone and threw a ReferenceError; the copy would not. Such a const is
// not copied: the first kept statement above it whose evaluation can reach the
// moved code, through a name that reads it, makes the split refuse.
function earlyConstant(declarations, moved, copied, constants, ts) {
  const copies = declarations.filter((d) => copied.has(d) && constants.has(d))
  if (!copies.length) return null
  const reaching = new Set([...moved].flatMap((d) => [...d.names]))
  for (let grew = true; grew; ) {
    grew = false
    for (const d of declarations) {
      if (moved.has(d) || [...d.names].every((n) => reaching.has(n))) continue
      if ([...d.reads].some((n) => reaching.has(n))) { for (const n of d.names) reaching.add(n); grew = true }
    }
  }
  let reached = false
  for (const d of declarations) {
    if (copies.includes(d) && reached) return d
    if (!moved.has(d) && [...loadReads(d.statement, ts)].some((n) => reaching.has(n))) reached = true
  }
  return null
}

// The names a top-level statement reads while the module loads. A function
// stored as a value, in a variable, an object or array literal or a class
// member, runs only when something calls it later; a function passed to a
// call may run now, so its body counts. Types and instance field initializers
// read nothing at load.
function loadReads(statement, ts) {
  const reads = new Set()
  const stored = (node) => ts.isVariableStatement(node) || ts.isVariableDeclarationList(node) || ts.isVariableDeclaration(node) || ts.isObjectLiteralExpression(node) ||
    ts.isPropertyAssignment(node) || ts.isArrayLiteralExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) || ts.isConditionalExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isPropertyDeclaration(node) || ts.isExportAssignment(node) ||
    ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)
  const visit = (node, value) => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isTypeParameterDeclaration(node) || ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) return
    if (ts.isPropertyDeclaration(node) && !(node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword) && node.parent && ts.isClassLike(node.parent)) {
      if (node.name && ts.isComputedPropertyName(node.name)) visit(node.name, false)
      return
    }
    if (ts.isFunctionLike(node) && node.body !== undefined) {
      if (node.name && ts.isComputedPropertyName(node.name)) visit(node.name, false)
      if (value) return
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const declares = parent && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isEnumDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === node
      const member = parent && ((ts.isPropertyAccessExpression(parent) && parent.name === node) || ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent)) && parent.name === node))
      if (!declares && !member) reads.add(node.text)
    }
    if (ts.isShorthandPropertyAssignment(node)) reads.add(node.name.text)
    ts.forEachChild(node, (child) => visit(child, value && stored(node) && !(ts.isConditionalExpression(node) && child === node.condition)))
  }
  visit(statement, true)
  return reads
}

function isMovable(statement, ts) {
  if ((statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return false
  return ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)
}

// A function with written parameter types, written again in the module to
// call the moved one: export const f = (a: A, b = 1): R => ..., or export
// function f(a: A) { ... }. The declaration file prints the same signature
// for both; a return type the original leaves to inference stays inferred.
// Whether a function's inferred return type can name no type of its module:
// every value it returns is a JSX element, null or undefined, or it returns
// none, so the type is JSX.Element, null, undefined or void (in a Promise
// when async). A component such as `export const Terminal = (props:
// TerminalProps) => { ...; return <div /> }` keeps its wrapper even when
// moved code reads a private type.
function returnsOnlyElements(statement, ts) {
  let fn = statement
  if (ts.isVariableStatement(statement)) {
    fn = statement.declarationList.declarations[0]?.initializer
    while (fn && ts.isParenthesizedExpression(fn)) fn = fn.expression
  }
  if (!fn || !(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || fn.asteriskToken || !fn.body) return false
  const element = (e) => {
    while (e && ts.isParenthesizedExpression(e)) e = e.expression
    if (!e || e.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(e) && e.text === "undefined") return true
    if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return true
    return ts.isConditionalExpression(e) && element(e.whenTrue) && element(e.whenFalse)
  }
  if (!ts.isBlock(fn.body)) return element(fn.body)
  let only = true
  const visit = (node) => {
    if (!only || ts.isFunctionLike(node) || ts.isClassLike(node)) return
    if (ts.isReturnStatement(node) && !element(node.expression)) only = false
    else ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn.body, visit)
  return only
}

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
  if (fn.asteriskToken) return null
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
  // An inferred return type stays inferred: the wrapper returns the moved
  // function's result, a value of the same type, and an async one's promise as is.
  const inferred = !fn.type
  const ret = inferred ? "" : ": " + fn.type.getText(source)
  const asyncWord = !inferred && (fn.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : ""
  const constKeyword = kind === "const" ? statement.declarationList.getText(source).match(/^(const|let|var)/)[1] : ""
  const reads = new Set()
  for (const p of params) for (const n of readNames(p, ts)) reads.add(n)
  if (fn.type) for (const n of readNames(fn.type, ts)) reads.add(n)
  for (const t of fn.typeParameters ?? []) for (const n of readNames(t, ts)) reads.add(n)
  const text = (namespace, callee = `${namespace}.${name}`) => {
    // An inferred result may name a type parameter the arguments do not fix.
    const typeArgs = inferred && fn.typeParameters ? `<${fn.typeParameters.map((t) => t.name.text).join(", ")}>` : ""
    const call = `${callee}${typeArgs}(${args})`
    const declaration = kind === "const"
      ? `export ${constKeyword} ${name} = ${asyncWord}${typeParams}(${paramText})${ret} => ${asyncWord ? "await " : ""}${call}`
      : `export ${asyncWord}function ${name}${typeParams}(${paramText})${ret} {\n  return ${call}\n}`
    return doc + declaration
  }
  return { name, text, reads, inferred }
}

function exportedText(source, statement) {
  const start = statement.getStart(source)
  return leadingComments(source, statement) + "export " + source.text.slice(start, statement.end)
}

// A copied exported type is private in the sibling: its text without `export`.
function unexportedText(source, statement, ts) {
  const keyword = statement.modifiers.find((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  const start = statement === source.statements[0] ? headerEnd(source) : statement.pos
  const text = source.text.slice(start, keyword.getStart(source)) + source.text.slice(keyword.end, statement.end).replace(/^\s+/, "")
  return text.replace(/^\s*\n/, "").replace(/^\n+/, "")
}

const isDefaultExport = (statement, ts) => (statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)

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
// evaluates when imported, so such a statement never moves: it stays where it
// stands, and only its host operations move (hostOperations), called in place.
// A module left with no value of its own stays TypeScript: a body holding the
// whole file is a .ts file with a harder name. A declaration that would move but
// reads import.meta, or a value that would move only because moved code reads
// it, stays instead, and only the module's host operations move.

/**
 * Splits the TypeScript module text of file into a module with a module body.
 * Returns { module, moved, kept, name, wrapped }, or { refused } saying why the module
 * keeps its platform code, or null when it reaches no platform code.
 */
export function splitPlatformToModule(text, file, ts, { globals = [], throws = false, platform: platformCode = true, reexports = true, wrap = false } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.(?:tsx|vibex)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
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
  for (const name of globalNames(globals, source, ts)) if (!imported.has(name) && !declared.has(name)) platform.add(name)
  const platformSeed = !platformCode ? [] : declarations.filter((d) => !reexport_(d, ts) && ([...d.reads].some((n) => platform.has(n) && !declared.has(n)) || importsPlatform(d.statement, ts)))
  const throwSeed = throws ? declarations.filter((d) => !reexport_(d, ts) && !platformSeed.includes(d) && throwsPlainly(d.statement, ts)) : []
  if (!platformSeed.length && !throwSeed.length) return null
  if (source.statements.some((s) => ts.isExportAssignment(s) && s.isExportEquals)) return { refused: `${file}: export = has no place beside a module body (EK4008)` }
  const typeOnly = (d) => ts.isInterfaceDeclaration(d.statement) || ts.isTypeAliasDeclaration(d.statement) || typeNamespace(d.statement, ts)
  const reexport = (d) => ts.isExportDeclaration(d.statement)
  const close = (seed) => {
    const moved = new Set(seed)
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
    return moved
  }
  let moved = close([...platformSeed, ...throwSeed])
  // VIP-40: "A body that needs metadata receives it as an argument." A
  // declaration that would move and reads import.meta stays where it is; only
  // the host operations of the module's kept code move into the body
  // (hostOperations), and import.meta stays in the module. Throwing code still
  // moves whole.
  const metaReader = platformCode ? [...moved].find((d) => readsImportMeta(d.statement, ts)) : undefined
  // A move that would take every value of the module, though some value
  // reaches no platform code, takes it only because moved code reads it: a
  // resource value and its same-named type beside the provider that reads
  // the host. The module keeps them, and only the host operations move. A
  // module whose every value reaches the platform is platform code and stays
  // TypeScript.
  const value = (d) => !typeOnly(d) && !reexport(d)
  const dragged = platformCode && !metaReader && !declarations.some((d) => value(d) && !moved.has(d)) &&
    declarations.some((d) => value(d) && !platformSeed.includes(d) && !throwSeed.includes(d))
  const movable = (s) => ts.isVariableStatement(s) || ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s) || ts.isExportAssignment(s) || typeNamespace(s, ts)
  // A statement that runs in order among the module's statements, the platform
  // code would take into the body, stays too: a body evaluates when imported,
  // before the module's own statements, while a helper called where the
  // statement performed the operation keeps the order of evaluation. Throwing
  // code still moves whole.
  const ordered = platformCode && !metaReader ? [...close(platformSeed)].find((d) => !movable(d.statement)) : undefined
  let operations = null
  if (metaReader || dragged || ordered) {
    moved = close(throwSeed)
    const names = new Set()
    const collect = (node) => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, collect) }
    collect(source)
    operations = hostOperations(source, declarations.filter((d) => !moved.has(d)).map((d) => d.statement), platform, ts, names, file)
    if (operations.refused) {
      const why = metaReader
        ? `${firstLine(source, metaReader.statement)} reads import.meta, which a module body cannot (EK4009)`
        : ordered ? `${firstLine(source, ordered.statement)} runs in order among the module's statements, so it cannot move to a module body`
        : "moving its platform code would take every value of the module"
      return { refused: `${file}: ${why}, and its host operations cannot move on their own: ${operations.refused}` }
    }
  }
  for (const d of moved) {
    if (!movable(d.statement)) return { refused: `${file}: ${firstLine(source, d.statement)} runs in order among the module's statements, so it cannot move to a module body` }
    if (readsImportMeta(d.statement, ts)) return { refused: `${file}: ${firstLine(source, d.statement)} reads import.meta, which a module body cannot (EK4009)` }
  }
  const kept = declarations.filter((d) => !moved.has(d))
  const inferredTypes = inferredFactoryTypeText(source, kept, moved, declarations, imported, ts, file)
  if (inferredTypes.refused) return inferredTypes
  const isDefault = (d) => ts.isExportAssignment(d.statement) || (d.statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  // With wrap, a module whose every value is platform code keeps each export
  // as a function with its written signature that calls the body, as the
  // sibling split's wrappers do; any other export leaves the module TypeScript.
  let wrappers = []
  if (!kept.some((d) => !typeOnly(d) && !reexport(d))) {
    const exportedValues = platformSeed.length && wrap ? [...moved].filter((d) => d.exported && !typeOnly(d)) : []
    // A type of a wrapped name would lose its export beside the wrapper.
    wrappers = exportedValues.map((d) => !isDefault(d) && ![...d.names].some((n) => declared.get(n).some(typeOnly)) && wrapperOf(d.statement, source, ts)).map((w, i) => w && { d: exportedValues[i], ...w })
    if (!wrappers.length || !wrappers.every(Boolean)) return { refused: platformSeed.length ? `${file} is platform code only` : `${file}: every value of the module reaches a throw, so it stays TypeScript` }
  }
  const keptReads = new Set([...kept.flatMap((d) => [...d.reads]), ...wrappers.flatMap((w) => [...w.reads])])
  const taken = new Set([...declared.keys(), ...imported, ...declarations.flatMap((d) => [...d.reads]), ...(operations?.helpers.map((h) => h.name) ?? [])])
  const name = uniqueName(platformSeed.length ? "platform" : "throwing", taken)
  taken.add(name)
  const alias = new Map()
  for (const w of wrappers) { const a = uniqueName(w.name + "$platform", taken); taken.add(a); alias.set(w.name, a) }
  const movedList = declarations.filter((d) => moved.has(d))
  // What the module reads from the body, and what it re-exports, by meaning.
  const imports_ = [], typeImports = [], exports_ = [], typeExports = [], bound = []
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
      if (alias.has(n)) { imports_.push(`${n} as ${alias.get(n)}`); continue }
      // An import is not narrowed inside a closure the way a local const is
      // (t3code Web previewBridge.ts, TS18047), so a private moved const that
      // kept code reads in a closure comes back under an alias and is bound to
      // a local const of its own name, as the sibling split binds it. A
      // function or class value has nothing to narrow.
      if (keptReads.has(n) && !all.some((x) => x.exported) && all.every((x) => narrowableConst(x.statement, ts)) && kept.some((d) => readsInClosure(d.statement, n, ts))) {
        const a = uniqueName(n + "$platform", taken)
        taken.add(a)
        imports_.push(`${n} as ${a}`)
        bound.push(`const ${n}: typeof ${a} = ${a}`)
        continue
      }
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
  const builtin = (i) => ts.isStringLiteral(i.moduleSpecifier) && isPlatformModule(i.moduleSpecifier.text)
  const head = imports.map((i) => operations && builtin(i)
    ? typeImportText(i, source, ts, (b) => operations.typeReads.has(b.name) || (b.type && moduleReads.has(b.name)))
    : bare(i, (b) => moduleReads.has(b.name))).filter(Boolean)
  if (fileComment) head.unshift(fileComment)
  const movedReads = new Set(movedList.flatMap((d) => [...d.reads]))
  const bodyImports = imports.map((i) => i.importClause ? bare(i, (b) => movedReads.has(b.name) || (!!operations && !b.type && operations.roots.has(b.name)))
    // A builtin loaded for its effect loads from the body, with the host operations.
    : operations && builtin(i) ? statementText(source, i) : null).filter(Boolean)
  // A body exports a private declaration that kept code reads, and every one a
  // kept declaration's inferred type may name, which TypeScript could do in one
  // file (TS4023 across two): a type, class, enum or function, and a variable
  // only through typeof (a unique symbol, a class expression). Any other export
  // is a declaration the original never wrote, and TypeScript may be unable to
  // write it: TS2883 on t3code web themePalette's `const convertToOklch =
  // converter("oklch")`, whose type culori does not export.
  const queried = typeQueryNames(source, ts)
  const seam = (d) => !ts.isVariableStatement(d.statement) || [...d.names].some((n) => keptReads.has(n) || queried.has(n)) || namesItsOwnType(d.statement, ts)
  const bodyStatements = movedList.map((d) => (!d.exported && !isDefault(d) && d.names.size && seam(d) ? exportedText(source, d.statement) : statementText(source, d.statement)))
  const body = [`module ${name} {`, joinParts(fileDirectives(source, ts), bodyImports, bodyStatements, operations?.helpers.map((h) => h.text) ?? []).trimEnd(), "}"].join("\n")
  imports_.push(...(operations?.helpers.map((h) => h.name) ?? []))
  const from = []
  if (imports_.length) from.push(`import { ${[...imports_].sort().join(", ")} } from ${name}`)
  if (typeImports.length) from.push(`import type { ${[...typeImports].sort().join(", ")} } from ${name}`)
  if (exports_.length) from.push(`export { ${[...exports_].sort().join(", ")} } from ${name}`)
  if (typeExports.length) from.push(`export type { ${[...typeExports].sort().join(", ")} } from ${name}`)
  if (reexportsDefault) from.push(`export { default } from ${name}`)
  // A re-export makes the body's declarations, x.vibe.<name>.d.ts, part of
  // the module's published API, a file the declaration oracle has not seen.
  if (!reexports && (exports_.length || typeExports.length || reexportsDefault)) {
    return { refused: `${file}: ${[...exports_, ...typeExports, ...(reexportsDefault ? ["default"] : [])].join(", ")} would be declared by \`module ${name}\`, a new public declaration file; platformModuleBodies allows it` }
  }
  const module = joinParts(leadingHeader(source), head, [body], [...from, ...bound], [...kept.map((d) => inferredTypes.text(d.statement, operations?.edits.get(d.statement))), ...wrappers.map((w) => w.text(name, alias.get(w.name)))])
  return { module, name, moved: [...movedList.flatMap((d) => [...d.names]), ...(operations?.helpers.map((h) => h.name) ?? [])], kept: kept.flatMap((d) => [...d.names]), throwing: throwSeed.flatMap((d) => [...d.names]),
    ...(operations ? { hostOperations: operations.helpers.map((h) => h.name) } : {}), wrapped: wrappers.map((w) => w.name) }
}

const intersect = (a, b) => new Set([...a].filter((x) => b.has(x)))

// A const whose every initializer is a value a condition can narrow: no
// function or class expression.
function narrowableConst(statement, ts) {
  if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) return false
  return statement.declarationList.declarations.every((v) => {
    let init = v.initializer
    while (init && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression
    return init && !ts.isArrowFunction(init) && !ts.isFunctionExpression(init) && !ts.isClassExpression(init)
  })
}

// Whether node reads the identifier name inside a function or method.
function readsInClosure(node, name, ts) {
  const visit = (n, inside) => {
    if (ts.isIdentifier(n) && n.text === name && inside) {
      const p = n.parent
      if (!(p && ts.isPropertyAccessExpression(p) && p.name === n) && !(p && ts.isPropertyAssignment(p) && p.name === n)) return true
    }
    const fn = ts.isFunctionLike(n) && !ts.isTypeNode(n)
    return ts.forEachChild(n, (c) => visit(c, inside || fn)) ?? false
  }
  return visit(node, false)
}


// An imported factory's inferred object is expanded without its member JSDoc
// by TypeScript declaration emit. Keep its concrete return type linked to the
// factory instead of moving the initializer, which could reorder evaluation.
function inferredFactoryTypeText(source, kept, moved, declarations, imported, ts, file) {
  const factories = new Map()
  const callable = (statement, name) => {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return { node: statement, contextual: false }
    if (!ts.isVariableStatement(statement)) return null
    const variable = statement.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === name)
    let node = variable?.initializer
    while (node && ts.isParenthesizedExpression(node)) node = node.expression
    return node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? { node, contextual: !!variable.type } : null
  }
  const memberDocs = node => !!node && (
    !!node.jsDoc?.length && (
      ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) ||
      ts.isPropertySignature(node) || ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)
    ) || !!ts.forEachChild(node, child => memberDocs(child) || undefined)
  )
  for (const declaration of moved) for (const name of declaration.names) {
    const fn = callable(declaration.statement, name)
    if (!fn || !memberDocs(fn.node)) continue
    const overloaded = declarations.filter(d => d.names.has(name)).length !== 1
    factories.set(name, { ...fn, unsupported: overloaded || fn.contextual || !!fn.node.typeParameters?.length || !!fn.node.asteriskToken })
  }
  const shadowed = imported.has("ReturnType") || declarations.some(d => d.names.has("ReturnType") && (
    ts.isTypeAliasDeclaration(d.statement) || ts.isInterfaceDeclaration(d.statement) ||
    ts.isClassDeclaration(d.statement) || ts.isEnumDeclaration(d.statement) || ts.isModuleDeclaration(d.statement)
  ))
  const insertions = new Map()
  for (const declaration of kept) {
    if (!ts.isVariableStatement(declaration.statement)) continue
    for (const variable of declaration.statement.declarationList.declarations) {
      if (variable.type || !ts.isIdentifier(variable.name)) continue
      let call = variable.initializer
      while (call && ts.isParenthesizedExpression(call)) call = call.expression
      if (!call || !ts.isCallExpression(call) || call.questionDotToken) continue
      let target = call.expression
      while (ts.isParenthesizedExpression(target)) target = target.expression
      if (!ts.isIdentifier(target)) continue
      const factory = factories.get(target.text)
      if (!factory) continue
      if (factory.unsupported || call.typeArguments?.length) return {
        refused: `${file}: inferred member documentation for ${variable.name.text} depends on a generic, overloaded or contextually typed factory; keep the module in TypeScript`
      }
      if (shadowed) return { refused: `${file}: ReturnType is shadowed, so inferred member documentation for ${variable.name.text} cannot retain its factory type` }
      const edits = insertions.get(declaration.statement) ?? []
      edits.push({ at: variable.name.end, text: `: ReturnType<typeof ${target.text}>` })
      insertions.set(declaration.statement, edits)
    }
  }
  return { text: (statement, extra = []) => {
    let text = statementText(source, statement)
    const start = statement.end - text.length
    for (const edit of [...(insertions.get(statement) ?? []), ...extra].sort((a, b) => b.at - a.at)) {
      const at = edit.at - start
      text = text.slice(0, at) + edit.text + text.slice((edit.end ?? edit.at) - start)
    }
    return text
  } }
}

// The names a `typeof x` type query reads anywhere in source.
function typeQueryNames(source, ts) {
  const names = new Set()
  const visit = (node) => {
    if (ts.isTypeQueryNode(node)) {
      let e = node.exprName
      while (ts.isQualifiedName(e)) e = e.left
      if (ts.isIdentifier(e)) names.add(e.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

// A variable whose type TypeScript writes as typeof the variable: a unique
// symbol (Symbol(), Symbol.for(), or written unique symbol) or a class expression.
function namesItsOwnType(statement, ts) {
  return statement.declarationList.declarations.some((v) => {
    if (v.type && ts.isTypeOperatorNode(v.type) && v.type.operator === ts.SyntaxKind.UniqueKeyword) return true
    let init = v.initializer
    while (init && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression
    if (!init) return false
    if (ts.isClassExpression(init)) return true
    if (!ts.isCallExpression(init)) return false
    const callee = init.expression
    return (ts.isIdentifier(callee) && callee.text === "Symbol") || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Symbol" && callee.name.text === "for")
  })
}

// The host operations of statements, moved into a module body as helpers the
// module calls where it performed them (VIP-40: a body that needs metadata
// receives it as an argument; the compiler's platformCallSplit does the same
// inside wrappers). Each free reference to a name in platform, a value import
// of a builtin or a host global the compiler named, becomes:
//   a call      fileURLToPath(new URL("./x", import.meta.url))  ->  $fileURLToPath(new URL("./x", import.meta.url))
//   a read      process.env.TOKEN                                ->  $process_env_TOKEN()
//   a typeof    typeof Bun                                       ->  $typeof_Bun()
//   a write     process.exitCode = 1                             ->  $set_process_exitCode(1)
// A called helper has the callee's own type, overloads and generics included,
// and calls it on the same receiver. Arguments, type arguments and callbacks
// stay where they were, so they run in order and still see the module's
// import.meta. A read, typeof or write helper performs that one operation
// when the module reaches it, and throws only what the operation throws.
// What cannot move this way is refused: new, a tagged template, an optional
// call of a member, a write other than =, delete, a re-export of the name.
// Returns { edits: Map(statement -> [{ at, end, text }]), helpers: [{ name, text }],
// typeReads, roots } or { refused }.
function hostOperations(source, statements, platform, ts, taken, file) {
  const helpers = new Map(), edits = new Map(), typeReads = new Set(), roots = new Set()
  const where = (node) => file + ":" + (source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
  const fresh = (base) => { let name = base; for (let i = 2; taken.has(name); i++) name = base + i; taken.add(name); return name }
  const helper = (key, base, text) => {
    let h = helpers.get(key)
    if (!h) { const name = fresh(base); h = { name, text: text(name) }; helpers.set(key, h) }
    return h.name
  }
  const never = "/** @throws {never} */\n"
  for (const statement of statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const named = statement.exportClause.elements.find((e) => platform.has((e.propertyName ?? e.name).text))
      if (named) return { refused: `${where(statement)}: export { ${named.getText(source)} } re-exports platform code` }
    }
    const sites = []
    freeNames(statement, ts, false, (node, type) => { if (platform.has(node.text)) { if (type) typeReads.add(node.text); else sites.push(node) } })
    const own = []
    for (const id of sites) {
      roots.add(id.text)
      if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) {
        const name = helper("read " + id.text, "$" + id.text, (h) => `${never}export function ${h}() { return ${id.text} }`)
        own.push({ at: id.getStart(source), end: id.end, text: `${id.text}: ${name}()` })
        continue
      }
      let top = id
      const path = [id.text]
      while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top && !top.parent.questionDotToken && ts.isIdentifier(top.parent.name)) {
        top = top.parent
        path.push(top.name.text)
      }
      if (/\/[*/]/.test(top.getText(source))) return { refused: `${where(id)}: ${path.join(".")} has comments that cannot move unchanged` }
      const chain = path.join("."), base = "$" + path.join("_")
      const parent = top.parent
      if (ts.isExportAssignment(parent)) return { refused: `${where(id)}: export default ${chain} exports platform code` }
      if (ts.isCallExpression(parent) && parent.expression === top && !(parent.questionDotToken && top !== id)) {
        if (parent.questionDotToken) {
          const name = helper("read " + chain, base, (h) => `${never}export function ${h}() { return ${chain} }`)
          own.push({ at: top.getStart(source), end: top.end, text: name + "()" })
        } else {
          const name = helper("call " + chain, base, (h) => callHelper(h, chain, path))
          own.push({ at: top.getStart(source), end: top.end, text: name })
        }
      } else if (ts.isCallExpression(parent) && parent.expression === top) {
        return { refused: `${where(id)}: ${chain}?.() would lose its receiver` }
      } else if (ts.isNewExpression(parent) && parent.expression === top) {
        return { refused: `${where(id)}: new ${chain} constructs platform code` }
      } else if (ts.isTaggedTemplateExpression(parent) && parent.tag === top) {
        return { refused: `${where(id)}: ${chain} tags a template` }
      } else if (ts.isTypeOfExpression(parent) && top === id) {
        const name = helper("typeof " + chain, "$typeof_" + id.text, (h) => `${never}export function ${h}() { return typeof ${id.text} }`)
        own.push({ at: parent.getStart(source), end: parent.end, text: name + "()" })
      } else if (isWritten(top, ts)) {
        if (!(ts.isBinaryExpression(parent) && parent.left === top && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && top !== id)) return { refused: `${where(id)}: ${chain} is written in place` }
        const name = helper("set " + chain, "$set_" + path.join("_"), (h) => `${never}export function ${h}(value: typeof ${chain}) { return ${chain} = value }`)
        own.push({ at: parent.getStart(source), end: parent.right.getStart(source), text: name + "(" }, { at: parent.end, end: parent.end, text: ")" })
      } else {
        const name = helper("read " + chain, base, (h) => `${never}export function ${h}() { return ${chain} }`)
        own.push({ at: top.getStart(source), end: top.end, text: name + "()" })
      }
    }
    if (own.length) edits.set(statement, own)
  }
  return { edits, helpers: [...helpers.values()], typeReads, roots }
}

// The helper for a moved call of chain. It has the callee's own type, so
// overloads, generics and assertion signatures resolve as they did. The
// compiler reports a host clock or randomness read by the declaration its
// call resolves to (VIP-33; vibelang's clockReads): a helper with the host
// method's type would still resolve there, so those reads get a function of
// their own signature instead.
function callHelper(h, chain, path) {
  const member = path.at(-1), owner = path.at(-2)
  const clock = path.length >= 2 && (owner === "crypto" && ["randomUUID", "getRandomValues"].includes(member) || owner === "performance" && member === "now")
  if (!clock) return `export const ${h}: typeof ${chain} = ((...args: Parameters<typeof ${chain}>) => ${chain}(...args)) as typeof ${chain}`
  // getRandomValues returns the array it fills, typed as the array passed.
  if (member === "getRandomValues") return `export function ${h}<T extends Parameters<typeof ${chain}>[0]>(array: T): T { return ${chain}(array) }`
  return `export function ${h}(...args: Parameters<typeof ${chain}>): ReturnType<typeof ${chain}> { return ${chain}(...args) }`
}

// An import type declaration for the bindings of i that keep keeps, or null.
// A default and named bindings take two statements, as import type requires.
function typeImportText(i, source, ts, keep) {
  const kept = bindingsOf(i, ts).filter(keep)
  if (!kept.length) return null
  const specifier = i.moduleSpecifier.getText(source)
  const out = []
  const def = kept.find((b) => b.kind === "default"), ns = kept.find((b) => b.kind === "namespace"), named = kept.filter((b) => b.kind === "named")
  if (def) out.push(`import type ${def.name} from ${specifier}`)
  if (ns) out.push(`import type * as ${ns.name} from ${specifier}`)
  if (named.length) out.push(`import type { ${named.map((b) => (b.property ? b.property + " as " : "") + b.name).join(", ")} } from ${specifier}`)
  return out.join("\n")
}

// The names statement reads that it does not bind itself at the read: a
// parameter or local of the name is no read of the top-level binding, and an
// import no kept code reads would be TS6133. Values and types have scopes of
// their own, `(session: session) => session`. With valuesOnly, value reads alone.
function freeNames(statement, ts, valuesOnly = false, onFree) {
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
  const isDeclarationName = (node, parent) => (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isTypeParameterDeclaration(parent) || ts.isModuleDeclaration(parent) || ts.isNamedTupleMember(parent) || ts.isLabeledStatement(parent)) && parent.name === node || (ts.isNamedTupleMember(parent) && parent.name === node) || (ts.isLabeledStatement(parent) && parent.label === node) || (ts.isBindingElement(parent) && parent.propertyName === node) || ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
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
    if (ts.isModuleBlock(node)) {
      const own = scopeT()
      for (const s of node.statements) {
        if ((ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s) || ts.isModuleDeclaration(s)) && s.name && ts.isIdentifier(s.name)) own.add(s.name.text)
      }
    }
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
      if (ts.isIdentifier(name) && !v.some((s) => s.has(name.text))) { free.add(name.text); onFree?.(name, true) }
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
      if (typeRead && !ts.isTypePredicateNode(parent)) { if (!valuesOnly && !t.some((s) => s.has(node.text))) { free.add(node.text); onFree?.(node, true) } }
      else if (!v.some((s) => s.has(node.text))) { free.add(node.text); onFree?.(node, false) }
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

const reexport_ = (d, ts) => ts.isExportDeclaration(d.statement)

// Whether statement holds a `throw` that VibeLang's plain code reports
// (spec 003, "Plain code never throws", EK0401): one whose nearest function
// is neither async (a rejection, detail 251) nor a generator (the codemod's
// effect code), or one at the top level. A body is TypeScript, where the
// throw keeps its meaning (VIP-40, "No VibeLang rule runs on a body").
function throwsPlainly(node, ts, plain = true) {
  if (ts.isThrowStatement(node)) return plain
  let inner = plain
  if (ts.isFunctionLike(node) && node.body) inner = !node.asteriskToken && !(node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  return !!ts.forEachChild(node, (child) => throwsPlainly(child, ts, inner) || undefined)
}

// The local names of createRequire imported from node:module.
function createRequireNames(imports, ts) {
  const names = new Set()
  for (const i of imports) {
    if (!ts.isStringLiteral(i.moduleSpecifier) || !["module", "node:module"].includes(i.moduleSpecifier.text)) continue
    for (const b of bindingsOf(i, ts)) if (!b.type && b.kind === "named" && (b.property ?? b.name) === "createRequire") names.add(b.name)
  }
  return names
}

// The names the module's imports bind for path's dirname and url's
// fileURLToPath: "dirname" and "fileURLToPath" for a named import, and a
// namespace import's name with the member, "NodePath.dirname".
function directoryNames(imports, ts) {
  const names = new Map()
  for (const i of imports) {
    if (!ts.isStringLiteral(i.moduleSpecifier)) continue
    const from = i.moduleSpecifier.text
    const member = ["path", "node:path", "path/posix", "node:path/posix"].includes(from) ? "dirname" : ["url", "node:url"].includes(from) ? "fileURLToPath" : null
    if (!member) continue
    for (const b of bindingsOf(i, ts)) {
      if (b.type) continue
      if (b.kind === "named" && (b.property ?? b.name) === member) names.set(b.name, member)
      if (b.kind === "namespace" || b.kind === "default") names.set(b.name + "." + member, member)
    }
  }
  return names
}

// What callee, an identifier or a namespace member, names among names.
const calleeName = (callee, ts) => ts.isIdentifier(callee) ? callee.text
  : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && !callee.questionDotToken ? callee.expression.text + "." + callee.name.text : null

// Whether node reads import.meta for the module's own identity: anything but
// import.meta.url as the base of new URL(<a path beside the module>, ...),
// the argument of createRequire, whose resolution starts from the module's
// directory, or what names that directory in a sibling beside it too: the
// directory of fileURLToPath(import.meta.url), and the companion's
// $importMetaDirname and $importMetaResolve helpers given import.meta.url.
function namesModule(node, ts, requires) {
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
    const url = node.parent
    if (!ts.isPropertyAccessExpression(url) || url.expression !== node || url.questionDotToken || url.name.text !== "url") return true
    const use = url.parent
    if (ts.isCallExpression(use) && use.arguments.length === 1 && use.arguments[0] === url && ts.isIdentifier(use.expression) && requires.has(use.expression.text)) return false
    if (ts.isCallExpression(use) && use.arguments.at(-1) === url && ts.isIdentifier(use.expression) && /^\$importMeta(?:Dirname|Resolve)\d*$/.test(use.expression.text)) return false
    const directories = requires.directories ?? new Map()
    if (ts.isCallExpression(use) && use.arguments.length === 1 && directories.get(calleeName(use.expression, ts)) === "fileURLToPath") {
      const parent = use.parent
      if (ts.isCallExpression(parent) && parent.arguments.length === 1 && parent.arguments[0] === use && directories.get(calleeName(parent.expression, ts)) === "dirname") return false
    }
    if (!ts.isNewExpression(use) || use.arguments?.length !== 2 || use.arguments[1] !== url || !ts.isIdentifier(use.expression) || use.expression.text !== "URL") return true
    const first = use.arguments[0]
    const head = ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) ? first.text : ts.isTemplateExpression(first) ? first.head.text : null
    return head === null || !(head === "." || head === ".." || head.startsWith("./") || head.startsWith("../"))
  }
  return !!ts.forEachChild(node, (child) => namesModule(child, ts, requires) || undefined)
}

function readsImportMeta(node, ts) {
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return true
  return !!ts.forEachChild(node, (child) => readsImportMeta(child, ts) || undefined)
}
