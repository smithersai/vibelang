// 007-tooling.md: A rewrite that can't preserve types, behavior and declaration output refuses at that site.
// Resolve the runtime Bun receiver before editing a build script. A local
// parameter, mock, type-only import or explicit API replacement is authored
// code, not evidence of a call to Bun's bundler.
export function bunProgramScope(text, ts, file = "build.ts") {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /jsx?$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
  const host = ts.createCompilerHost({ noLib: true, noResolve: true })
  host.getSourceFile = name => name === file ? source : undefined
  const checker = ts.createProgram([file], { noLib: true, noResolve: true, allowJs: true }, host).getTypeChecker()
  const symbol = node => checker.getSymbolAtLocation(node)
  const runtimeImport = node => {
    for (let p = node; p; p = p.parent) {
      if (p.isTypeOnly) return false
      if (ts.isImportDeclaration(p)) return p.moduleSpecifier.text === "bun"
    }
    return false
  }
  const bunSymbol = (node, value) => node && ts.isIdentifier(node) &&
    (node.text === "Bun" && (!value?.declarations?.length ||
      !(value.flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Alias))) ||
      value?.declarations?.some(d => (ts.isNamespaceImport(d) || ts.isImportClause(d)) && runtimeImport(d)))
  const bunBinding = node => bunSymbol(node, node && symbol(node))
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node))) node = node.expression
    return node
  }
  const isGlobalThis = node => ts.isIdentifier(node) && node.text === "globalThis" && !symbol(node)?.declarations?.length
  const globalBun = node => {
    node = unwrap(node)
    if (!node) return false
    if (ts.isPropertyAccessExpression(node)) return isGlobalThis(node.expression) && node.name.text === "Bun"
    if (ts.isElementAccessExpression(node) && isGlobalThis(node.expression)) {
      const key = unwrap(node.argumentExpression)
      return !key || !ts.isStringLiteralLike(key) || key.text === "Bun"
    }
    return false
  }
  const target = node => {
    node = unwrap(node)
    if (!node) return false
    if (bunBinding(node) || globalBun(node)) return true
    if (ts.isPropertyAccessExpression(node)) return (bunBinding(unwrap(node.expression)) || globalBun(node.expression)) &&
      ["build", "Glob"].includes(node.name.text)
    if (ts.isElementAccessExpression(node) && (bunBinding(unwrap(node.expression)) || globalBun(node.expression))) {
      const key = unwrap(node.argumentExpression)
      return !key || !ts.isStringLiteralLike(key) || ["build", "Glob"].includes(key.text)
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(target)
    if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) return target(node.expression)
    if (ts.isObjectLiteralExpression(node)) return node.properties.some(p =>
      ts.isShorthandPropertyAssignment(p) ? bunSymbol(p.name, checker.getShorthandAssignmentValueSymbol(p)) :
      ts.isPropertyAssignment(p) ? target(p.initializer) : ts.isSpreadAssignment(p) && target(p.expression))
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) return target(node.left)
    return false
  }
  let replaced = false
  const inventory = node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && target(node.left)) replaced = true
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) && target(node.operand)) replaced = true
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer) &&
      target(node.initializer)) replaced = true
    ts.forEachChild(node, inventory)
  }
  inventory(source)
  const bun = node => !replaced && bunBinding(unwrap(node))
  return { source, checker, symbol, runtimeImport, bun }
}
