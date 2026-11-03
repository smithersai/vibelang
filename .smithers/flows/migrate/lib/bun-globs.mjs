// Bun.Glob uses Bun's matching contract; minimatch's negative extglobs do
// not exclude declaration sidecars in Bun. Keep the native scanner and its
// options/iteration, widen only build-entry producers, and filter its yields.
export function addBunBuildGlobs(text, ts, file = "build.ts") {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /jsx?$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
  const host = ts.createCompilerHost({ noLib: true, noResolve: true })
  host.getSourceFile = name => name === file ? source : undefined
  const checker = ts.createProgram([file], { noLib: true, noResolve: true, allowJs: true }, host).getTypeChecker()
  const symbol = node => checker.getSymbolAtLocation(node)
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isAwaitExpression(node))) node = node.expression
    return node
  }
  const moduleOf = node => {
    for (let p = node; p; p = p.parent) if (ts.isImportDeclaration(p)) return p.moduleSpecifier.text
  }
  const runtimeImport = node => {
    for (let p = node; p && !ts.isImportDeclaration(p); p = p.parent) if (p.isTypeOnly) return false
    return moduleOf(node) === "bun"
  }
  const bun = node => ts.isIdentifier(node) && (node.text === "Bun" && !symbol(node)?.declarations?.length ||
    symbol(node)?.declarations?.some(d => (ts.isNamespaceImport(d) || ts.isImportClause(d)) && runtimeImport(d)))
  const baseOf = expression => {
    if (ts.isPropertyAccessExpression(expression) && bun(expression.expression) && expression.name.text === "Glob") return expression.getText(source)
    if (ts.isIdentifier(expression) && symbol(expression)?.declarations?.some(d =>
      ts.isImportSpecifier(d) && (d.propertyName?.text ?? d.name.text) === "Glob" && runtimeImport(d))) return expression.text
  }
  const isBuild = node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "build" && bun(node.expression.expression)
  const names = new Set(), builds = [], loops = new Map(), pushes = new Map(), written = new Set()
  const inventory = node => {
    if (ts.isIdentifier(node)) names.add(node.text)
    if (isBuild(node)) builds.push(node)
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      for (const d of node.initializer.declarations) if (ts.isIdentifier(d.name)) loops.set(symbol(d.name), node.expression)
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && ["push", "unshift"].includes(node.expression.name.text)) {
      const key = symbol(node.expression.expression)
      if (key) pushes.set(key, [...(pushes.get(key) ?? []), ...node.arguments])
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(unwrap(node.left))) written.add(symbol(unwrap(node.left)))
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) && ts.isIdentifier(unwrap(node.operand))) written.add(symbol(unwrap(node.operand)))
    ts.forEachChild(node, inventory)
  }
  inventory(source)
  const initial = node => {
    const key = symbol(node)
    if (!key || written.has(key)) return undefined
    const d = key.declarations?.find(ts.isVariableDeclaration)
    return d && d.parent.flags & ts.NodeFlags.Const ? d.initializer : undefined
  }
  const resolve = (node, seen = new Set()) => {
    node = unwrap(node)
    if (node && ts.isIdentifier(node) && !seen.has(symbol(node))) {
      seen.add(symbol(node))
      return resolve(initial(node), seen) ?? node
    }
    return node
  }
  const found = new Set(), seen = new Set(), origins = new Map()
  const trace = input => {
    const node = unwrap(input)
    if (!node || seen.has(node)) return
    seen.add(node)
    if (ts.isIdentifier(node)) {
      const key = symbol(node)
      if (!written.has(key)) {
        trace(initial(node))
        trace(loops.get(key))
        trace(origins.get(key))
        for (const value of pushes.get(key) ?? []) trace(value)
      }
    } else if (ts.isNewExpression(node) && baseOf(node.expression)) found.add(node)
    else if (ts.isArrayLiteralExpression(node)) for (const element of node.elements) trace(ts.isSpreadElement(element) ? element.expression : element)
    else if (ts.isConditionalExpression(node)) { trace(node.whenTrue); trace(node.whenFalse) }
    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text, receiver = node.expression.expression
      if (["scan", "scanSync", "map", "filter", "flatMap", "slice", "sort", "toSorted", "reverse", "toReversed", "concat"].includes(method)) trace(receiver)
      if (["from", "fromAsync"].includes(method) && ts.isIdentifier(receiver) && receiver.text === "Array" && !symbol(receiver)?.declarations?.length) trace(node.arguments[0])
      if (method === "concat") for (const arg of node.arguments) trace(arg)
      if (method === "then") {
        const callback = unwrap(node.arguments[0])
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
          callback.parameters.length === 1 && ts.isIdentifier(callback.parameters[0].name)) {
          origins.set(symbol(callback.parameters[0].name), receiver)
          if (!ts.isBlock(callback.body)) trace(callback.body)
          else {
            const returns = child => {
              if (child !== callback.body && ts.isFunctionLike(child)) return
              if (ts.isReturnStatement(child)) trace(child.expression)
              else ts.forEachChild(child, returns)
            }
            returns(callback.body)
          }
        }
      }
    }
  }
  for (const build of builds) {
    const options = resolve(build.arguments[0])
    if (!options || !ts.isObjectLiteralExpression(options)) continue
    const properties = [...options.properties]
    const entry = properties.findLastIndex(p => p.name?.text === "entrypoints")
    if (entry < 0 || properties.slice(entry + 1).some(p => ts.isSpreadAssignment(p) || p.name && ts.isComputedPropertyName(p.name))) continue
    for (const property of properties.slice(entry,entry + 1)) {
      if (ts.isPropertyAssignment(property)) trace(property.initializer)
      else if (ts.isShorthandPropertyAssignment(property)) {
        // A shorthand property's name symbol belongs to the property; its
        // value symbol is the lexical const containing the entry collection.
        const value = checker.getShorthandAssignmentValueSymbol(property)
        const d = value?.declarations?.find(ts.isVariableDeclaration)
        trace(d?.initializer)
        for (const arg of pushes.get(value) ?? []) trace(arg)
      }
    }
  }
  const widen = pattern => pattern.replace(/\.(ts|mts|cts|tsx|\{[a-z, ]+\})$/, (whole, group) => {
    const parts = group.startsWith("{") ? group.slice(1,-1).split(",").map(s => s.trim()) : [group]
    const added = parts.flatMap(ext => ext === "tsx" ? ["vibex"] : /^(?:[cm]?ts)$/.test(ext) ? ["vibe"] : [])
    return added.length ? ".{" + [...new Set([...parts,...added])].join(",") + "}" : whole
  })
  const edits = [], helpers = new Map(), warnings = []
  for (const node of found) {
    const pattern = unwrap(node.arguments?.[0])
    if (node.arguments?.length !== 1 || !pattern || !(ts.isStringLiteral(pattern) || ts.isNoSubstitutionTemplateLiteral(pattern))) {
      warnings.push("line " + (source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1) + ": computed Bun.Glob build pattern needs its native source/sidecar selector wired by hand")
      continue
    }
    if (/\.d\.(?:ts|mts|cts|tsx)$/.test(pattern.text) ||
      !/\.(?:ts|mts|cts|tsx|\{[a-z, ]*\b(?:ts|mts|cts|tsx)\b[a-z, ]*\})$/.test(pattern.text)) continue
    const next = widen(pattern.text)
    const base = baseOf(node.expression)
    if (!helpers.has(base)) {
      let name = "__vibelangBuildGlob"
      for (let n = 2; names.has(name); n++) name = "__vibelangBuildGlob" + n
      names.add(name); helpers.set(base,name)
    }
    edits.push({ start:node.expression.getStart(source), end:node.expression.end, text:helpers.get(base) })
    if (next !== pattern.text) edits.push({ start:pattern.getStart(source), end:pattern.end, text:JSON.stringify(next) })
  }
  if (!edits.length) return { text, warnings }
  let helper = "// vibelang: Bun build source entries; declaration sidecars are not entries.\n"
  for (const [base,name] of helpers) helper += `class ${name} extends ${base} {
  /** @override @param {Parameters<${base}["scanSync"]>} args @returns {ReturnType<${base}["scanSync"]>} */
  override scanSync(...args: Parameters<${base}["scanSync"]>): ReturnType<${base}["scanSync"]> {
    const files = super.scanSync(...args)
    return (function* () {
      for (const file of files) if (!/\\.d\\.vibex?\\.ts$/.test(file)) yield file
    })()
  }
  /** @override @param {Parameters<${base}["scan"]>} args @returns {ReturnType<${base}["scan"]>} */
  override scan(...args: Parameters<${base}["scan"]>): ReturnType<${base}["scan"]> {
    const files = super.scan(...args)
    return (async function* () {
      for await (const file of files) if (!/\\.d\\.vibex?\\.ts$/.test(file)) yield file
    })()
  }
}
`
  if (/\.[cm]?jsx?$/.test(file)) helper = ts.transpileModule(helper, { compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,removeComments:false} }).outputText
  let at = text.startsWith("#!") ? Math.max(0,text.indexOf("\n") + 1) : 0
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) at = statement.end
    else break
  }
  edits.push({ start:at, end:at, text:"\n" + helper + "\n" })
  let after = text
  for (const edit of edits.sort((a,b) => b.start-a.start)) after = after.slice(0,edit.start) + edit.text + after.slice(edit.end)
  return { text:after, warnings }
}
