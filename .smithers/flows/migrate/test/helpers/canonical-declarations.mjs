// A declaration file's text with spelling the API cannot see removed. The
// migration gates compare declarations through the checker
// (lib/api-identity.mjs); tests use this only to compare compiler output
// whose formatting is not the property under test.
import { isModuleName } from "../../lib/declarations.mjs"

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The indexes of source's statements that are private type aliases nothing
 * else names: in a module, a top-level `type X = …` without `export`, which
 * no type reference, type heritage clause, `export { X }` or `export default X` in
 * another statement names, nor one that names it in turn. Such an alias is
 * no part of the module's contract, but TypeScript prints one beside a value
 * of its name: a schema declaration, `schema State { … }`, is a constant and
 * `type State = typeof State.Type`, so a migrated private schema adds the
 * alias where the TypeScript had only `const State = Schema.Struct(…)`
 * (t3code chatAttachment.ts). Interfaces, which merge with other
 * declarations, and every declaration of a global script stay.
 */
export function privateUnusedTypes(ts, source) {
  if (!ts.isExternalModule(source)) return new Set()
  const exported = (node) => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0
  const leftmost = (name) => (ts.isQualifiedName(name) ? leftmost(name.left) : ts.isPropertyAccessExpression(name) ? leftmost(name.expression) : name)
  const names = (statement) => {
    const found = new Set()
    const visit = (node) => {
      const classBase = ts.isExpressionWithTypeArguments(node) &&
        ts.isHeritageClause(node.parent) && node.parent.token === ts.SyntaxKind.ExtendsKeyword &&
        (ts.isClassDeclaration(node.parent.parent) || ts.isClassExpression(node.parent.parent))
      // A class extends a value; its type arguments are visited independently.
      if (ts.isTypeReferenceNode(node) || (ts.isExpressionWithTypeArguments(node) && !classBase)) {
        const id = leftmost(ts.isTypeReferenceNode(node) ? node.typeName : node.expression)
        if (ts.isIdentifier(id)) found.add(id.text)
      } else if (ts.isExportSpecifier(node)) {
        found.add((node.propertyName ?? node.name).text)
      } else if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
        found.add(node.expression.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(statement)
    return found
  }
  const statements = source.statements
  const candidates = new Map()
  statements.forEach((statement, i) => {
    if (ts.isTypeAliasDeclaration(statement) && !exported(statement)) candidates.set(i, statement.name.text)
  })
  const kept = new Set(statements.map((_, i) => i).filter((i) => !candidates.has(i)))
  // An alias another kept statement names is kept, and so is each alias it names.
  for (let grew = true; grew; ) {
    grew = false
    const named = new Set([...kept].flatMap((i) => [...names(statements[i])].filter((name) => !(candidates.get(i) === name))))
    for (const [i, name] of candidates) {
      if (!kept.has(i) && named.has(name)) {
        kept.add(i)
        grew = true
      }
    }
  }
  return new Set([...candidates.keys()].filter((i) => !kept.has(i)))
}

/**
 * printed, the printed statements, with the import declarations that bind
 * names first, then the export declarations that re-export from a module,
 * each sorted by module specifier, then text, and the rest after them in
 * their order: where an import or a re-export stands means nothing to a
 * declaration file's API (t3code's MCP toolkits: the codemod's
 * `import { Tool, Toolkit } from "effect/ai"` moved ahead of unchanged
 * imports). An import for its side effects keeps its place among the rest.
 */
function inModuleOrder(ts, statements, printed) {
  const specifier = (s) => (s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : "")
  const imports = (s) => ts.isImportDeclaration(s) && s.importClause
  const reexports = (s) => ts.isExportDeclaration(s) && s.moduleSpecifier
  const sorted = (kind) => statements.flatMap((s, i) => (kind(s) ? [[specifier(s), printed[i]]] : []))
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1])).map(([, text]) => text)
  return [...sorted(imports), ...sorted(reexports), ...printed.filter((_, i) => !imports(statements[i]) && !reexports(statements[i]))]
}

/** A declaration file's canonical text. */
export function canonicalize(ts, text, fileName = "file.d.ts", modulePath = (text) => text) {
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
  // The parenthesizer wraps a union inside a union, so unwrap it before flattening.
  const unionMembers = (t) => {
    const inner = ts.isParenthesizedTypeNode(t) ? t.type : t
    return ts.isUnionTypeNode(inner) ? inner.types.flatMap(unionMembers) : [t]
  }
  const normalize = (ctx) => {
    const f = ctx.factory
    const visit = (node) => {
      let x = ts.visitEachChild(node, visit, ctx)
      // A redundant type parenthesis is spelling; the printer restores each one precedence needs.
      if (ts.isParenthesizedTypeNode(x)) return x.type
      if (ts.isStringLiteral(x) && isModuleName(ts, node)) {
        const name = modulePath(x.text)
        if (name !== x.text) return f.createStringLiteral(name)
      }
      if (ts.isStringLiteral(x) && /^\.\.?\/.*(?<!\.d)\.ts$/.test(x.text) && isModuleName(ts, node)) return f.createStringLiteral(x.text.replace(/\.ts$/, ".js"))
      if (ts.isTypeReferenceNode(x) && x.typeArguments) {
        x = f.updateTypeReferenceNode(x, x.typeName, f.createNodeArray(x.typeArguments.map((t) => (ts.isParenthesizedTypeNode(t) ? t.type : t))))
      }
      // Readonly<{ a: T }> is { readonly a: T }: a .vibe data payload writes its
      // fields readonly where the TypeScript wrapped them (foldkit-16).
      if (ts.isTypeReferenceNode(x) && ts.isIdentifier(x.typeName) && x.typeName.text === "Readonly" && x.typeArguments?.length === 1 &&
        ts.isTypeLiteralNode(x.typeArguments[0]) && x.typeArguments[0].members.every((m) => ts.isPropertySignature(m) || ts.isIndexSignatureDeclaration(m))) {
        const readonly = (modifiers) => modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ? modifiers : [f.createModifier(ts.SyntaxKind.ReadonlyKeyword), ...(modifiers ?? [])]
        x = f.createTypeLiteralNode(x.typeArguments[0].members.map((m) => ts.isPropertySignature(m)
          ? f.updatePropertySignature(m, readonly(m.modifiers), m.name, m.questionToken, m.type)
          : f.updateIndexSignature(m, readonly(m.modifiers), m.parameters, m.type)))
      }
      const sorted = (elements) => f.createNodeArray([...elements].sort((a, b) => compare(print(a), print(b))))
      if (ts.isNamedImports(x)) x = f.updateNamedImports(x, sorted(x.elements))
      else if (ts.isNamedExports(x)) x = f.updateNamedExports(x, sorted(x.elements))
      if (ts.isUnionTypeNode(x)) x = f.updateUnionTypeNode(x, f.createNodeArray(x.types.flatMap(unionMembers).sort((a, b) => compare(print(a), print(b)))))
      else if (ts.isTypeLiteralNode(x)) x = f.updateTypeLiteralNode(x, sortMembers(x.members))
      else if (ts.isInterfaceDeclaration(x)) x = f.updateInterfaceDeclaration(x, x.modifiers, x.name, x.typeParameters, x.heritageClauses, sortMembers(x.members))
      else if (ts.isClassDeclaration(x)) x = f.updateClassDeclaration(x, x.modifiers, x.name, x.typeParameters, x.heritageClauses, sortMembers(x.members))
      return x
    }
    return (node) => ts.visitNode(node, visit)
  }
  const unused = privateUnusedTypes(ts, source)
  const out = ts.transform(source, [normalize])
  try {
    const kept = out.transformed[0].statements.filter((_, i) => !unused.has(i))
    return inModuleOrder(ts, kept, kept.map((statement) => print(statement))).join("\n") + "\n"
  } finally {
    out.dispose()
  }
}
