// Give each snapshot's ambient declarations its own names in the probe.
// Diagnose the original environments independently before applying any edits.
// Identifiers are selected by their TypeScript symbols, never by text matching.
import { relative, resolve } from 'node:path'


// A positive closure proof lets equal global environments share one set of
// declarations. This preserves intrinsic uses such as string[]["custom"] for
// Array augmentations; renaming an interface alone cannot rename an intrinsic.
// Different closures still go through the independent symbol probes below.
function equivalentEnvironment(ts, left, right, before, after, host) {
  const shape = source => {
    // JSDoc can type JavaScript. Require exact syntax there rather than
    // treating whitespace in a type-bearing comment as prose formatting.
    if (source.scriptKind === ts.ScriptKind.JS || source.scriptKind === ts.ScriptKind.JSX) return source.text
    const documentation = node => node.jsDoc?.map(comment => {
      const raw = comment.getText(source)
      return raw.slice(3, -2).split('\n').map((line, index) =>
        index ? line.replace(/^[ \t]*\*(?:[ \t])?/u, '') : line).join('\n').replace(/\s+/gu, ' ').trim()
    }) ?? []
    const tokens = [], stack = [source]
    while (stack.length) {
      const node = stack.pop()
      if (!node) { tokens.push(-1); continue }
      const literal = ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isLiteralExpression(node)
        || (node.kind >= ts.SyntaxKind.TemplateHead && node.kind <= ts.SyntaxKind.TemplateTail)
      const flags = ts.isVariableDeclarationList(node) || ts.isModuleDeclaration(node) ? node.flags : 0
      tokens.push([node.kind, literal ? node.text : null, node.operator ?? null, node.token ?? null,
        !!node.isTypeOnly, !!node.isTypeOf, !!node.isExportEquals, flags, documentation(node)])
      const children = []
      ts.forEachChild(node, child => { children.push(child) })
      stack.push(null)
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index])
    }
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, source.languageVariant, source.text)
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia)
        tokens.push([token, scanner.getTokenText().replace(/\s+/gu, ' ').trim()])
    }
    return JSON.stringify([source.isDeclarationFile, source.impliedNodeFormat, tokens])
  }
  const key = (file, base) => {
    if (!file) return null
    file = resolve(file)
    return (file === base || file.startsWith(base + '/')) && !file.includes('/node_modules/')
      ? 'owned:' + relative(base, file) : 'shared:' + file
  }
  const closure = (program, base) => program.getSourceFiles().map(source => {
    const imports = source.imports ?? []
    const resolved = host.resolveModuleNameLiterals
      ? host.resolveModuleNameLiterals(imports, source.fileName, undefined, program.getCompilerOptions(), source).map(item => item.resolvedModule)
      : host.resolveModuleNames(imports.map(node => node.text), source.fileName)
    const edges = resolved.map(item => key(item?.resolvedFileName, base))
    for (const reference of source.referencedFiles) edges.push(key(resolve(source.fileName, '..', reference.fileName), base))
    for (const reference of source.typeReferenceDirectives) {
      const target = ts.resolveTypeReferenceDirective(reference.fileName, source.fileName, program.getCompilerOptions(), host).resolvedTypeReferenceDirective
      edges.push(key(target?.resolvedFileName, base))
    }
    return [key(source.fileName, base), source, JSON.stringify(edges)]
  })
  const a = closure(left, before), b = closure(right, after)
  return a.length === b.length && a.every(([key, source, edges], index) =>
    key === b[index][0] && edges === b[index][2] && shape(source) === shape(b[index][1]))
}

export function isolateAmbientSnapshots(ts, snapshots, compilerOptions, host, initialProgram, diagnose) {
  const virtual = new Map(), surfaces = new Map(), diagnostics = [], names = new Map(), equivalentFiles = new Map(), sourceFiles = new Map()
  const owned = source => snapshots.some(({base}) => source.fileName === base || source.fileName.startsWith(base + '/')) && !source.fileName.includes('/node_modules/')
  const contributes = source => {
    if (!ts.isExternalModule(source) && !ts.isJsonSourceFile(source)) return true
    let found = false
    const visit = node => {
      if (ts.isModuleDeclaration(node) && node.flags & ts.NodeFlags.GlobalAugmentation) found = true
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }
  if (initialProgram && !initialProgram.getSourceFiles().some(source => owned(source) && contributes(source))) {
    diagnostics.push(...diagnose(initialProgram, snapshots.flatMap(({entries}) => Object.values(entries)), initialProgram.getSourceFiles().filter(owned).map(source => source.fileName)))
    return { virtual, surfaces, diagnostics, names, equivalentFiles, sourceFiles }
  }
  const programs = snapshots.map(({ entries }) => ts.createProgram(Object.values(entries), compilerOptions, host))
  const unifyGlobals = snapshots.length === 2 && equivalentEnvironment(ts, programs[0], programs[1], snapshots[0].base, snapshots[1].base, host)
  if (unifyGlobals) {
    const a = programs[0].getSourceFiles(), b = programs[1].getSourceFiles()
    for (let index = 0; index < a.length; index++) {
      if (owned(a[index]) && a[index].fileName !== b[index].fileName)
        equivalentFiles.set(resolve(b[index].fileName), resolve(a[index].fileName))
    }
  }
  const literalKinds = new Set([
    'AnyKeyword', 'UnknownKeyword', 'NeverKeyword', 'VoidKeyword', 'UndefinedKeyword',
    'StringKeyword', 'NumberKeyword', 'BooleanKeyword', 'BigIntKeyword', 'SymbolKeyword', 'ObjectKeyword',
    'LiteralType', 'StringLiteral', 'NumericLiteral', 'BigIntLiteral', 'TrueKeyword', 'FalseKeyword', 'NullKeyword',
    'UnionType', 'IntersectionType', 'ParenthesizedType', 'PrefixUnaryExpression', 'MinusToken', 'PlusToken',
  ].map(name => ts.SyntaxKind[name]))
  const closedLiteral = node => {
    if (!literalKinds.has(node.kind)) return false
    let closed = true
    ts.forEachChild(node, child => { if (!closedLiteral(child)) closed = false })
    return closed
  }
  const printer = ts.createPrinter()
  const done = new Set()
  for (const [index, { base, entries }] of snapshots.entries()) {
    if (done.has(base)) continue
    done.add(base)
    const program = programs[index]
    const checker = program.getTypeChecker()
    const own = source => (source.fileName === base || source.fileName.startsWith(base + '/')) && !source.fileName.includes('/node_modules/')
    const sources = program.getSourceFiles().filter(own)
    sourceFiles.set(base, new Set(sources.map(source => source.fileName)))
    diagnostics.push(...diagnose(program, Object.values(entries), sources.map(source => source.fileName)))
    const globals = new Map(), modules = new Map()
    const prefix = '__api_identity_ambient_' + index + '_'
    const surface = (source, symbol, kind, name) => {
      if (!symbol) return
      const declaration = symbol.declarations?.find(declaration => declaration.name)
      symbol = (declaration && checker.getSymbolAtLocation(declaration.name)) ?? symbol
      const table = kind === 'module' ? modules : globals
      if (!table.has(symbol)) {
        table.set(symbol, unifyGlobals ? name : prefix + (kind === 'module' ? name : table.size))
        names.set(table.get(symbol), name)
      }
      const items = surfaces.get(source.fileName) ?? []
      if (!items.some(item => item.key === kind + ':' + name)) items.push({ key: kind + ':' + name, renamed: table.get(symbol), kind })
      surfaces.set(source.fileName, items)
    }
    for (const source of sources) {
      if (!ts.isExternalModule(source) && !ts.isJsonSourceFile(source)) {
        // SourceFile.locals contains only declarations in this script, unlike
        // getSymbolsInScope, which would include every lib.d.ts declaration.
        for (const symbol of source.locals?.values() ?? []) {
          const module = symbol.declarations?.find(node => ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name))
          if (module) surface(source, symbol, 'module', module.name.text)
          else surface(source, symbol, 'global', symbol.name)
        }
        if (!surfaces.has(source.fileName)) surfaces.set(source.fileName, [])
      }
      const collect = node => {
        if (ts.isModuleDeclaration(node) && node.flags & ts.NodeFlags.GlobalAugmentation) {
          for (const symbol of node.symbol?.exports?.values() ?? []) surface(source, symbol, 'global', symbol.name)
        }
        ts.forEachChild(node, collect)
      }
      collect(source)
    }
    if (!globals.size && !modules.size) continue
    for (const source of sources) {
      if (ts.isJsonSourceFile(source)) continue
      const edits = []
      const visit = node => {
        // Intrinsic arrays keep their library identity when named augmentations
        // are isolated. Preserve an indexed access's independently resolved
        // primitive/literal result; never serialize a name or a deferred type.
        if (!unifyGlobals && ts.isIndexedAccessTypeNode(node)) {
          const type = checker.typeToTypeNode(checker.getTypeFromTypeNode(node), node, ts.NodeBuilderFlags.NoTruncation)
          if (type && closedLiteral(type)) {
            edits.push([node.getStart(source), node.end, printer.printNode(ts.EmitHint.Unspecified, type, source)])
            return
          }
        }
        if (ts.isIdentifier(node)) {
          const symbol = checker.getSymbolAtLocation(node)
          const name = globals.get(symbol)
          if (name && name !== node.text) {
            let replacement = name
            if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) replacement = node.text + ': ' + name
            if (ts.isExportSpecifier(node.parent) && !node.parent.propertyName) replacement = name + ' as ' + node.text
            edits.push([node.getStart(source), node.end, replacement])
            // A global interface can augment a built-in interface. Keep the
            // built-in members in the renamed view without mutating lib.d.ts.
            if (ts.isInterfaceDeclaration(node.parent) && node.parent.name === node && symbol.declarations?.some(declaration => !own(declaration.getSourceFile()))) {
              const declaration = node.parent
              const heritage = declaration.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
              if (heritage) edits.push([heritage.end, heritage.end, ', ' + node.text])
              else {
                const inherited = symbol.declarations.find(node => ts.isInterfaceDeclaration(node) && !own(node.getSourceFile()))
                const arguments_ = declaration.typeParameters?.slice(0, inherited?.typeParameters?.length ?? 0).map(parameter => parameter.name.text).join(', ')
                const parentType = node.text + (arguments_ ? '<' + arguments_ + '>' : '')
                const at = declaration.typeParameters?.at(-1)?.end
                const end = at === undefined ? node.end : source.text.indexOf('>', at) + 1
                edits.push([end, end, ' extends ' + parentType])
              }
            }
          }
        } else if (ts.isStringLiteral(node)) {
          const name = modules.get(checker.getSymbolAtLocation(node))
          if (name) edits.push([node.getStart(source), node.end, JSON.stringify(name)])
        }
        ts.forEachChild(node, visit)
      }
      if (unifyGlobals && index > 0) {
        for (const statement of source.statements) {
          const globalBlock = ts.isModuleDeclaration(statement) && statement.flags & ts.NodeFlags.GlobalAugmentation
          const globalScript = !ts.isExternalModule(source) && !ts.isJsonSourceFile(source)
          const ambientModule = ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name)
          if (globalBlock || globalScript) edits.push([statement.getFullStart(), statement.end, ''])
          else visit(statement)
        }
      } else visit(source)
      if (edits.length) {
        let text = source.text
        for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) text = text.slice(0, start) + replacement + text.slice(end)
        virtual.set(resolve(source.fileName), text)
      }
    }
  }
  return { virtual, surfaces, diagnostics, names, equivalentFiles, sourceFiles }
}
