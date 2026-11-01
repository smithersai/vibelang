// The esbuild calls a repository embeds in its scripts and sources:
// `build({ ... })` and `context({ ... })` from esbuild, each of which needs
// vibelang() from vibelang-unplugin/esbuild in its plugins to bundle a .vibe
// module. Setup adds it to each call it can edit safely, last, so the call's
// own plugins keep deciding what they resolve first, and reports each call it
// cannot edit with its file and line.
import { readFileSync, writeFileSync } from "node:fs"
import { posix } from "node:path"
import { packageScripts, testLeftAsIs, testOnlyScripts } from "./test-files.mjs"
import { packagesReaching } from "./wire.mjs"

const pluginModule = "vibelang-unplugin/esbuild"
const byHand = `add vibelang() from ${pluginModule} to its plugins by hand`

// What a spread in a call's options may put in them: "none" holds no plugins,
// "plugins" holds some, "unknown" may.
const worst = (...kinds) => kinds.includes("unknown") ? "unknown" : kinds.includes("plugins") ? "plugins" : "none"

/**
 * Adds `vibelang()` from vibelang-unplugin/esbuild last in the plugins of
 * each esbuild `build` or `context` call in text, a module that imports them
 * from "esbuild" (named, as a namespace, or as the default export). The
 * options may be an object literal, with or without a plugins array, with
 * spreads of literals that hold no plugins; a const bound to such a literal;
 * or a call of a local helper that returns one, when nothing else uses the
 * const or the helper. A call with any other shape, a `buildSync` (which
 * takes no plugins) and an esbuild loaded with import() or require() are left
 * as they are and returned as refusals: { line, reason }. ts is TypeScript's
 * compiler API; fileName picks the parser (.tsx and .jsx parse JSX). Adding
 * the plugin twice is a no-op: a call that already has it is left alone.
 */
export function addEsbuildPlugin(text, ts, { fileName = "build.ts" } = {}) {
  const kind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind)
  const refusals = []
  const refuse = (node, reason) => refusals.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason })
  const unwrap = (node) => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression?.(node))) node = node.expression
    return node
  }
  const nameOf = (property) => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined

  // esbuild's bindings: the functions that take plugins, the namespaces that hold them, and buildSync.
  const builds = new Set()
  const namespaces = new Set()
  const syncs = new Set()
  let plugin
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue
    const clause = statement.importClause
    if (statement.moduleSpecifier.text === pluginModule && clause?.name) plugin = clause.name.text
    if (statement.moduleSpecifier.text !== "esbuild" || !clause) continue
    if (clause.name) namespaces.add(clause.name.text)
    const bindings = clause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue
        const imported = (element.propertyName ?? element.name).text
        if (imported === "build" || imported === "context") builds.add(element.name.text)
        if (imported === "buildSync") syncs.add(element.name.text)
      }
    }
  }

  // Every identifier the module declares, so the plugin's name does not shadow one.
  const declared = new Set()
  const declarations = new Map()
  const references = new Map()
  const visitNames = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const isDeclaration = (parent.name === node && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent) || ts.isClassDeclaration(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isBindingElement(parent)))
      const isName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isImportSpecifier(parent) && parent.propertyName === node) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)
      if (isDeclaration) {
        declared.add(node.text)
        if (!declarations.has(node.text)) declarations.set(node.text, parent)
      } else if (!isName) {
        if (!references.has(node.text)) references.set(node.text, [])
        references.get(node.text).push(node)
      }
    }
    ts.forEachChild(node, visitNames)
  }
  visitNames(source)
  const name = plugin ?? ["vibelang", "vibelangEsbuild", "vibelangPlugin"].find((candidate) => !declared.has(candidate))
  const call = `${name}()`

  // A string literal's text, or a const bound to one's: Smithers' SandboxedFlow.ts imports a const specifier, "esbuild".
  const stringValue = (node) => {
    node = unwrap(node)
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text
    const declaration = node && ts.isIdentifier(node) ? declarations.get(node.text) : undefined
    if (!declaration || !ts.isVariableDeclaration(declaration) || !(declaration.parent.flags & ts.NodeFlags.Const)) return undefined
    const value = unwrap(declaration.initializer)
    return value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) ? value.text : undefined
  }

  // The esbuild calls that take plugins, found first, so a const or helper used only by them can be edited.
  const calls = []
  const findCalls = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(callee) && callee.text === "require"
      if ((isImport || isRequire) && stringValue(node.arguments[0]) === "esbuild") {
        // A file that loads the plugin itself, as Smithers' browser-check.mjs does, wired its calls by hand.
        if (!text.includes(pluginModule)) refuse(node, `loads esbuild with ${isImport ? "import()" : "require()"}; ${byHand}`)
      } else if (ts.isIdentifier(callee) && builds.has(callee.text)) calls.push(node)
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) {
        if (callee.name.text === "build" || callee.name.text === "context") calls.push(node)
        else if (callee.name.text === "buildSync") refuse(node, `esbuild's buildSync takes no plugins; call build, or run it in a child process, with vibelang() from ${pluginModule}`)
      } else if (ts.isIdentifier(callee) && syncs.has(callee.text)) {
        refuse(node, `esbuild's buildSync takes no plugins; call build, or run it in a child process, with vibelang() from ${pluginModule}`)
      }
    }
    ts.forEachChild(node, findCalls)
  }
  findCalls(source)
  const optionsOf = new Set(calls.map((node) => node.arguments[0]).filter(Boolean))
  // Whether every use of a local name is the options of an esbuild call (as itself, or as the callee of a call that is).
  const onlyOptions = (local) => (references.get(local) ?? []).every((ref) => {
    let node = ref
    if (ts.isCallExpression(node.parent) && node.parent.expression === node) node = node.parent
    while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isSatisfiesExpression?.(node.parent))) node = node.parent
    return optionsOf.has(node)
  })
  const constLiteral = (local) => {
    const declaration = declarations.get(local)
    if (!declaration || !ts.isVariableDeclaration(declaration) || !(declaration.parent.flags & ts.NodeFlags.Const)) return undefined
    const value = unwrap(declaration.initializer)
    return value && ts.isObjectLiteralExpression(value) ? value : undefined
  }
  // The object literals a local helper returns, or undefined when it returns anything else.
  const helperLiterals = (local) => {
    const declaration = declarations.get(local)
    let fn
    if (declaration && ts.isFunctionDeclaration(declaration)) fn = declaration
    else if (declaration && ts.isVariableDeclaration(declaration) && declaration.parent.flags & ts.NodeFlags.Const) {
      const value = unwrap(declaration.initializer)
      if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) fn = value
    }
    if (!fn?.body) return undefined
    if (!ts.isBlock(fn.body)) {
      const value = unwrap(fn.body)
      return value && ts.isObjectLiteralExpression(value) ? [value] : undefined
    }
    const returned = []
    const visit = (node) => {
      if (ts.isFunctionLike(node)) return
      if (ts.isReturnStatement(node)) returned.push(unwrap(node.expression))
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(fn.body, visit)
    return returned.length && returned.every((value) => value && ts.isObjectLiteralExpression(value)) ? returned : undefined
  }

  // What a spread puts in the options.
  const spreadKind = (node, seen = new Set()) => {
    node = unwrap(node)
    if (!node) return "unknown"
    if (ts.isObjectLiteralExpression(node)) {
      return worst(...node.properties.map((property) => ts.isSpreadAssignment(property) ? spreadKind(property.expression, seen) : nameOf(property) === "plugins" || (ts.isShorthandPropertyAssignment(property) && property.name.text === "plugins") ? "plugins" : "none"))
    }
    if (ts.isConditionalExpression(node)) return worst(spreadKind(node.whenTrue, seen), spreadKind(node.whenFalse, seen))
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      return node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? spreadKind(node.right, seen) : worst(spreadKind(node.left, seen), spreadKind(node.right, seen))
    }
    if (node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined") || node.kind === ts.SyntaxKind.FalseKeyword) return "none"
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      const literal = constLiteral(node.text)
      return literal ? spreadKind(literal, new Set([...seen, node.text])) : "unknown"
    }
    return "unknown"
  }
  const hasPlugin = (list) => list.elements.some((element) => ts.isCallExpression(element) && ts.isIdentifier(element.expression) && element.expression.text === name)

  const edits = []
  const edited = new Set()
  // The edit that gives one options literal the plugin, or a refusal at at.
  const editObject = (object, at) => {
    if (edited.has(object.pos)) return
    edited.add(object.pos)
    const properties = object.properties
    const index = properties.findLastIndex((property) => nameOf(property) === "plugins" || (ts.isShorthandPropertyAssignment(property) && property.name.text === "plugins"))
    const later = properties.slice(index + 1).filter((property) => ts.isSpreadAssignment(property)).map((property) => [property, spreadKind(property.expression)])
    const unsafe = later.find(([, kind]) => kind !== "none")
    if (unsafe) return refuse(at, `its options spread ${unsafe[0].expression.getText(source)}, which may set plugins; ${byHand}`)
    if (index >= 0) {
      const property = properties[index]
      if (ts.isShorthandPropertyAssignment(property)) {
        edits.push({ start: property.getStart(source), end: property.end, text: `plugins: [...(plugins ?? []), ${call}]` })
      } else if (ts.isPropertyAssignment(property)) {
        const value = unwrap(property.initializer)
        if (ts.isArrayLiteralExpression(value)) {
          if (hasPlugin(value)) return
          const last = value.elements.at(-1)
          edits.push(last ? { start: last.end, end: last.end, text: `, ${call}` } : { start: value.getStart(source) + 1, end: value.getStart(source) + 1, text: call })
        } else {
          const expression = property.initializer
          edits.push({ start: expression.getStart(source), end: expression.end, text: `[...(${expression.getText(source)} ?? []), ${call}]` })
        }
      } else return refuse(at, `its plugins are not a property this edit knows; ${byHand}`)
      return
    }
    if (!properties.length) {
      edits.push({ start: object.getStart(source), end: object.end, text: `{ plugins: [${call}] }` })
      return
    }
    const start = object.getStart(source) + 1
    const indent = /^[ \t]*\n([ \t]+)\S/.exec(text.slice(start))?.[1]
    const space = /\s/.test(text[start]) ? "" : " "
    edits.push(indent ? { start, end: start, text: `\n${indent}plugins: [${call}],` } : { start, end: start, text: ` plugins: [${call}],${space}` })
  }

  for (const node of calls) {
    const options = unwrap(node.arguments[0])
    if (!options) {
      refuse(node, `the call has no options; ${byHand}`)
    } else if (ts.isObjectLiteralExpression(options)) {
      editObject(options, node)
    } else if (ts.isIdentifier(options) && constLiteral(options.text) && onlyOptions(options.text)) {
      editObject(constLiteral(options.text), node)
    } else if (ts.isCallExpression(options) && ts.isIdentifier(options.expression) && helperLiterals(options.expression.text) && onlyOptions(options.expression.text)) {
      for (const literal of helperLiterals(options.expression.text)) editObject(literal, node)
    } else {
      refuse(node, `its options, ${options.getText(source).slice(0, 60)}, are not an object literal this edit can follow; ${byHand}`)
    }
  }
  refusals.sort((a, b) => a.line - b.line)
  if (!edits.length) return { text, refusals }
  if (!plugin) edits.push(importEdit(text, source, ts, name))
  let out = text
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return { text: out, refusals }
}

// The edit that imports the plugin as name on the line after the last import, in the file's quote and semicolon style.
function importEdit(text, source, ts, name) {
  const lastImport = source.statements.filter((s) => ts.isImportDeclaration(s)).at(-1)
  const quote = /from\s+'/.test(text) && !/from\s+"/.test(text) ? "'" : '"'
  const semicolon = lastImport && text.slice(lastImport.getStart(source), lastImport.end).trimEnd().endsWith(";") ? ";" : ""
  const lineEnd = lastImport ? text.indexOf("\n", lastImport.end) : -1
  // A file without imports gets it after a leading shebang, or first.
  const at = lastImport ? (lineEnd < 0 ? text.length : lineEnd + 1) : (text.startsWith("#!") ? text.indexOf("\n") + 1 : 0)
  return { start: at, end: at, text: `${lastImport && lineEnd < 0 ? "\n" : ""}import ${name} from ${quote}${pluginModule}${quote}${semicolon}\n` }
}

const esbuildImport = /["']esbuild["']/

/**
 * Adds vibelang() from vibelang-unplugin/esbuild to each esbuild build and
 * context call in the scripts and sources of a package that reaches migrated
 * sources (packagesReaching). Tests, fixtures and the files only tests import
 * stay byte for byte as they are (decided detail 272: setup never edits a
 * test or the bundler configuration a test embeds); a test that bundles a
 * .vibe module reads the migrated package's emitted JavaScript instead
 * (opencode-32). A package whose call is wired gets the plugin as a
 * dependency where it has esbuild as one, else as a dev dependency, and the
 * compiler, the plugin's peer. Each call setup cannot edit is a warning with
 * its file and line. Returns the files changed, the warnings and the files
 * wired.
 */
export function wireEsbuildBuilds({ root, packages, ts, specsFor }) {
  const changed = []
  const warnings = []
  const wired = []
  const write = (file, after) => {
    writeFileSync(posix.join(root, file), after)
    if (!changed.includes(file)) changed.push(file)
  }
  for (const pkg of packagesReaching(root, packages.map((migrated) => migrated.dir))) {
    const specs = specsFor(pkg.dir)
    const scripts = packageScripts(root, pkg.dir)
    const bundling = scripts.filter((path) => esbuildImport.test(readFileSync(posix.join(root, path), "utf8")))
    if (!bundling.length) continue
    const manifest = posix.join(pkg.dir, "package.json")
    const current = JSON.parse(readFileSync(posix.join(root, manifest), "utf8"))
    const testOnly = testOnlyScripts(root, pkg.dir, scripts, current)
    let any = false
    for (const path of bundling) {
      if (testOnly.has(path)) {
        if (/\b(?:build|context)\s*\(/.test(readFileSync(posix.join(root, path), "utf8"))) warnings.push(`${path}: ${testLeftAsIs("esbuild")}`)
        continue
      }
      if (!specs["vibelang-unplugin"]) {
        warnings.push(`${path}: this toolchain has no vibelang-unplugin; rebuild the toolchain to wire esbuild`)
        continue
      }
      if (/\.c[jt]s$/.test(path)) {
        warnings.push(`${path}: a CommonJS module bundles with esbuild; ${byHand}`)
        continue
      }
      const text = readFileSync(posix.join(root, path), "utf8")
      const result = addEsbuildPlugin(text, ts, { fileName: path })
      for (const refusal of result.refusals) warnings.push(`${path}:${refusal.line}: ${refusal.reason}`)
      if (result.text === text) continue
      write(path, result.text)
      wired.push(path)
      any = true
    }
    if (!any) continue
    const shipsEsbuild = ["dependencies", "optionalDependencies", "peerDependencies"].some((field) => current[field]?.esbuild)
    const field = shipsEsbuild ? "dependencies" : "devDependencies"
    const next = structuredClone(current)
    if (!current.dependencies?.["vibelang-unplugin"]) {
      next[field] = { ...next[field], "vibelang-unplugin": specs["vibelang-unplugin"] }
      if (field === "dependencies" && next.devDependencies) delete next.devDependencies["vibelang-unplugin"]
    }
    if (!current.dependencies?.vibelang && !current.devDependencies?.vibelang) next.devDependencies = { ...next.devDependencies, vibelang: specs.vibelang }
    const after = JSON.stringify(next, null, 2) + "\n"
    if (after !== JSON.stringify(current, null, 2) + "\n") write(manifest, after)
  }
  return { changed, warnings, wired: wired.sort() }
}
