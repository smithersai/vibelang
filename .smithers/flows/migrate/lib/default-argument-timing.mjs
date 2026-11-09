// Legacy Effect.fn creates the iterator at each execution. Native effect
// parameters instead bind once at the call (VIP-1). Do not let an older
// compiler silently move defaults across that boundary during migration.
export function effectFnDefaultSites(ts, text, path) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.vibex$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const namespaces = new Set(["Effect"]), factories = new Set(["fn", "fnUntraced"]), roots = new Set()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const module = statement.moduleSpecifier.text, clause = statement.importClause
    if (clause?.isTypeOnly) continue
    const bindings = clause?.namedBindings
    if (module === "effect" && bindings && ts.isNamespaceImport(bindings)) roots.add(bindings.name.text)
    if (module === "effect/Effect") {
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
      if (clause?.name) namespaces.add(clause.name.text)
    }
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if (item.isTypeOnly) continue
      const imported = (item.propertyName ?? item.name).text
      if (module === "effect" && imported === "Effect") namespaces.add(item.name.text)
      if (module === "effect/Effect" && ["fn", "fnUntraced"].includes(imported)) factories.add(item.name.text)
    }
  }
  const unwrap = node => {
    while (ts.isParenthesizedExpression(node)) node = node.expression
    return node
  }
  const effectNamespace = node => {
    node = unwrap(node)
    return ts.isIdentifier(node) && namespaces.has(node.text) ||
      ts.isPropertyAccessExpression(node) && node.name.text === "Effect" && ts.isIdentifier(node.expression) && roots.has(node.expression.text)
  }
  const factory = node => {
    node = unwrap(node)
    if (ts.isCallExpression(node)) return factory(node.expression)
    if (ts.isIdentifier(node)) return factories.has(node.text)
    if (ts.isPropertyAccessExpression(node)) return effectNamespace(node.expression) && ["fn", "fnUntraced"].includes(node.name.text)
    if (ts.isElementAccessExpression(node)) return effectNamespace(node.expression) && ts.isStringLiteral(node.argumentExpression) && ["fn", "fnUntraced"].includes(node.argumentExpression.text)
    return false
  }
  const hasDefault = parameter => !!parameter.initializer ||
    (ts.isBindingPattern(parameter.name) && parameter.name.elements.some(element => !ts.isOmittedExpression(element) && hasDefault(element)))
  const sites = []
  const visit = node => {
    if (ts.isCallExpression(node) && factory(node.expression)) {
      for (const argument of node.arguments) {
        const generator = unwrap(argument)
        if (!ts.isFunctionExpression(generator) || !generator.asteriskToken) continue
        for (const parameter of generator.parameters) if (hasDefault(parameter)) {
          const { line, character } = source.getLineAndCharacterOfPosition(parameter.getStart(source))
          sites.push({ file: path, line: line + 1, column: character + 1 })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}
