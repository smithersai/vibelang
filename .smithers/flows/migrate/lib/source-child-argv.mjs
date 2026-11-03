// Prove that the runtime entry cannot be typed source. Arguments after that
// entry belong to the child program and do not require a VibeLang loader.
const cachedFlags = new Map()
export function sourceChildArgvProof({ source, ts, checker, template }) {
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression
    return node
  }
  const symbol = node => checker.getSymbolAtLocation(node)
  const refs = binding => {
    const result = []
    const visit = node => {
      if (ts.isIdentifier(node) && symbol(node) === binding && !binding.declarations?.some(d => d.name === node)) result.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)
    return result
  }
  const declarationOf = node => {
    const declaration = symbol(node)?.declarations?.find(ts.isVariableDeclaration)
    const statement = declaration?.parent?.parent
    if (!declaration || !(declaration.parent.flags & ts.NodeFlags.Const) ||
      statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return undefined
    return declaration
  }
  const notSource = value => /\.d\.(?:vibe\.)?[cm]?ts$/.test(value) || !/\.(?:[cm]?tsx?|vibex?)$/.test(value)
  const finite = type => {
    if (type.isUnion()) {
      const groups = type.types.map(finite)
      return groups.every(Boolean) ? groups.flat() : null
    }
    return type.flags & ts.TypeFlags.StringLiteral ? [type.value] : null
  }
  let flags = cachedFlags.get(template)
  if (!flags) {
    flags = {}
    const parsed = ts.createSourceFile("source-child.ts", template, ts.ScriptTarget.Latest, true)
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        ["valueFlags", "boolFlags"].includes(node.name.text) && node.initializer &&
        ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.every(ts.isStringLiteralLike)) {
        flags[node.name.text] = new Set(node.initializer.elements.map(n => n.text))
      }
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    cachedFlags.set(template, flags)
  }
  let mutableIntrinsics = false
  const intrinsicRoot = node => {
    while (node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) node = node.expression
    return node && ts.isIdentifier(node) && ["Array", "String", "Object", "process"].includes(node.text)
  }
  const mutations = node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && intrinsicRoot(node.left)) mutableIntrinsics = true
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && ["Object", "Reflect"].includes(node.expression.expression.text) &&
      ["assign", "defineProperty", "defineProperties", "set", "setPrototypeOf"].includes(node.expression.name.text) &&
      node.arguments[0] && intrinsicRoot(node.arguments[0])) mutableIntrinsics = true
    ts.forEachChild(node, mutations)
  }
  mutations(source)
  const property = (node, name) => ts.isPropertyAccessExpression(node) && node.name.text === name
  // Node's environment values are strings. Do not infer suffix facts for an
  // arbitrary object's endsWith method or a locally shadowed process.
  const envAccess = node => {
    node = unwrap(node)
    const env = ts.isPropertyAccessExpression(node) ? node.expression
      : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.expression : null
    return env && property(env, "env") && ts.isIdentifier(env.expression) &&
      env.expression.text === "process" && !symbol(env.expression)?.declarations?.length
  }
  const trueFacts = (condition, facts) => {
    condition = unwrap(condition)
    if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return trueFacts(condition.right, trueFacts(condition.left, facts))
    }
    if (ts.isCallExpression(condition) && property(condition.expression, "endsWith") &&
      condition.arguments.length === 1 && ts.isStringLiteralLike(condition.arguments[0]) &&
      condition.arguments[0].text && envAccess(condition.expression.expression)) {
      return [...facts, { text: condition.expression.expression.getText(source), suffix: condition.arguments[0].text }]
    }
    return facts
  }
  const domain = (node, facts) => {
    node = unwrap(node)
    if (ts.isStringLiteralLike(node)) return { values: [node.text] }
    const values = finite(checker.getTypeAtLocation(node))
    if (values && values.length <= 16) return { values }
    const fact = facts.find(f => f.text === node.getText(source))
    return fact ? { suffix: fact.suffix } : null
  }
  return (argument, command) => {
    let array = unwrap(argument)
    if (ts.isIdentifier(array)) {
      const declaration = declarationOf(array)
      if (!declaration || refs(symbol(array)).length !== 1) return false
      array = unwrap(declaration.initializer)
    }
    if (!array || !ts.isArrayLiteralExpression(array)) return false
    if (array.elements.every(element => {
      if (ts.isSpreadElement(element)) return false
      const values = domain(element, [])?.values
      return values?.every(notSource)
    })) return true
    if (mutableIntrinsics || !flags.valueFlags || !flags.boolFlags) return false
    command = unwrap(command)
    const tuple = command && ts.isElementAccessExpression(command) &&
      ts.isNumericLiteral(command.argumentExpression) && command.argumentExpression.text === "0" &&
      ts.isIdentifier(command.expression) ? command.expression : null
    let budget = 128
    const expand = (node, facts, start = 0) => {
      if (--budget < 0) return null
      node = unwrap(node)
      if (ts.isConditionalExpression(node)) {
        const a = expand(node.whenTrue, trueFacts(node.condition, facts), start)
        const b = expand(node.whenFalse, facts, start)
        return a && b && a.length + b.length <= 32 ? [...a, ...b] : null
      }
      if (!ts.isArrayLiteralExpression(node)) return null
      let sequences = [[]]
      for (const element of node.elements.slice(start)) {
        if (ts.isSpreadElement(element)) {
          const expression = unwrap(element.expression)
          let branches
          if (ts.isArrayLiteralExpression(expression)) branches = expand(expression, facts)
          else if (tuple && ts.isCallExpression(expression) && property(expression.expression, "slice") &&
            ts.isIdentifier(expression.expression.expression) && symbol(expression.expression.expression) === symbol(tuple) &&
            expression.arguments.length === 1 && ts.isNumericLiteral(expression.arguments[0]) && expression.arguments[0].text === "1") {
            const declaration = declarationOf(tuple), uses = refs(symbol(tuple))
            if (declaration && uses.length === 2 && uses.includes(tuple) && uses.includes(expression.expression.expression)) {
              branches = expand(declaration.initializer, facts, 1)
            }
          }
          if (!branches) branches = [[null]] // An unknown spread may contain the entry.
          sequences = sequences.flatMap(prefix => branches.map(branch => [...prefix, ...branch]))
          if (sequences.length > 32) return null
        } else sequences = sequences.map(prefix => [...prefix, domain(element, facts)])
      }
      return sequences
    }
    const sequences = expand(array, [])
    if (!sequences) return false
    const safe = (sequence, runtime, at = 0, ended = false) => {
      if (--budget < 0) return false
      if (at >= sequence.length) return true
      const token = sequence[at]
      if (!token) return false
      if (token.suffix) {
        // A suffix ending in .js/.mjs/.cjs cannot name typed source. It may
        // still be an inline option (--require=cli.js), so prove its tail too.
        return /\.(?:[cm]?js)$/.test(token.suffix) && (ended ||
          safe(sequence, runtime, at + 1) && [...flags.valueFlags].filter(flag => flag.endsWith(token.suffix)).every(() =>
            at + 1 >= sequence.length || !!sequence[at + 1] && safe(sequence, runtime, at + 2)))
      }
      return token.values.every(value => {
        if (ended) return notSource(value)
        if (value === "--") return safe(sequence, runtime, at + 1, true)
        if (runtime === "bun" && value === "run") return safe(sequence, runtime, at + 1)
        const flag = value.split("=")[0]
        if (["-e", "--eval", "-p", "--print", "--test", "--check"].includes(flag)) return true
        if (!value.startsWith("-")) return notSource(value)
        if (flags.valueFlags.has(flag)) {
          if (value.includes("=")) return safe(sequence, runtime, at + 1)
          if (at + 1 >= sequence.length) return true
          if (!sequence[at + 1]) return false
          return safe(sequence, runtime, at + 2)
        }
        return flags.boolFlags.has(flag) ? safe(sequence, runtime, at + 1) : true
      })
    }
    return sequences.every(sequence => safe(sequence, "node") && safe(sequence, "bun"))
  }
}
