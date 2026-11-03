// Properties every tree vibelang/eslint returns must have.
import { vibeVisitorKeys } from "../../eslint.mjs"

// Words that start a VibeLang form: the tree has a node for the form, not
// for the word, as it has none for TypeScript's `function` or `extends`.
export const formWords = new Set([
  "error", "service", "control", "schema", "data", "layer", "mutable", "match", "when", "and", "or", "not",
  "provide", "fork", "join", "is", "handle", "uninterruptible", "restore", "interruptible",
  "concurrent", "all", "allSettled", "any", "race", "select"
])

/** Calls visit on every node of tree, with its parent. */
export function walk(tree, visit, keys) {
  const step = (node, parent) => {
    visit(node, parent)
    for (const key of keys[node.type] ?? Object.keys(node).filter((k) => !["parent", "loc", "range"].includes(k))) {
      const value = node[key]
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === "object" && typeof child.type === "string") step(child, node)
      }
    }
  }
  step(tree, undefined)
}

/**
 * Returns what is wrong with ast as the tree of code: tokens and comments
 * that are not the source text, in order, with only whitespace between
 * them; a source name with no node; a node outside the text or with an
 * unknown type.
 */
export function problems(code, ast, visitorKeys) {
  const found = []
  const pieces = [...ast.tokens.map((t) => ({ ...t, kind: "token" })), ...ast.comments.map((c) => ({ ...c, kind: "comment" }))]
    .sort((a, b) => a.range[0] - b.range[0])
  let cursor = 0
  for (const piece of pieces) {
    const [start, end] = piece.range
    const gap = code.slice(cursor, start)
    if (start < cursor || !/^[\s\uFEFF]*$/u.test(gap)) found.push(`text ${JSON.stringify(gap.slice(0, 40))} at ${cursor} is in no token`)
    const text = code.slice(start, end)
    const expected = piece.kind === "comment"
      ? (piece.type === "Line" ? `//${piece.value}` : `/*${piece.value}*/`)
      : piece.type === "PrivateIdentifier" ? `#${piece.value}` : piece.value
    if (text !== expected) found.push(`${piece.kind} ${JSON.stringify(expected)} is ${JSON.stringify(text)} in the source`)
    cursor = end
  }
  if (!/^[\s\uFEFF]*$/u.test(code.slice(cursor))) found.push(`text after ${cursor} is in no token`)

  const named = new Set()
  const effectPrefixes = []
  const bindingStarts = new Set()
  const tokenIndexAt = new Map(ast.tokens.map((token, index) => [token.range[0], index]))
  const declarationHeadAt = new Map(ast.tokens.map((token, index) =>
    [token.range[0], token.value === "declare" ? ast.tokens[index + 1]?.value : token.value]))
  walk(ast, (node, parent) => {
    if (!(node.type in visitorKeys)) found.push(`unknown node type ${node.type}`)
    const [start, end] = node.range
    if (!(start >= 0 && start <= end && end <= code.length)) found.push(`${node.type} has range [${start}, ${end}]`)
    // The contextual effect modifier (including an effect block) belongs to
    // its function or method, like async. Exempt only the prefix before its
    // first written child: a parameter, function name or method key named
    // effect must still have an Identifier node.
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "TSDeclareFunction"].includes(node.type) ||
        node.type === "MethodDefinition" || node.type === "Property" && node.method) {
      const children = [node.id, node.key, ...(node.params ?? []), node.returnType, node.body].filter(Boolean)
      effectPrefixes.push([start, Math.min(end, ...children.map((child) => child.range[0]))])
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "TSDeclareFunction"].includes(node.type)) {
      for (const position of functionBindings(node, ast.tokens, tokenIndexAt, visitorKeys)) bindingStarts.add(position)
    }
    // Contextual words are ordinary names at the start of a written variable
    // declarator. Derive that position from its container, not its id: a
    // renamed or absent Identifier is exactly what this oracle must catch.
    // Lowered match temporaries also use VariableDeclarator, but their source
    // declaration does not start with const/let/var.
    // Hoisted loop-test/update temporaries share the init declaration but
    // point outside its written span. They are operators, not binding names.
    if (node.type === "VariableDeclarator" && parent?.type === "VariableDeclaration" &&
        start >= parent.range[0] && start < parent.range[1] &&
        ["const", "let", "var"].includes(declarationHeadAt.get(parent.range[0]))) {
      bindingStarts.add(start)
    }
    // An identifier's range covers its type annotation, so it is known by its start and name.
    if (node.type === "Identifier") named.add(`${start}:${node.name}`)
  }, visitorKeys)
  ast.tokens.forEach((token, index) => {
    if (token.type !== "Identifier") return
    const word = code.slice(...token.range)
    const previous = ast.tokens[index - 1]?.value
    // A pattern's extractor (Exit.Success, Option.Some) and a primitive's
    // pattern (String) become guards, and an infer placeholder (D57) is
    // VibeInferType's name: none is a variable a rule could miss.
    const effectModifier = word === "effect" && effectPrefixes.some(([start, end]) => start <= token.range[0] && token.range[1] <= end)
    const exempt = !bindingStarts.has(token.range[0]) && (effectModifier || formWords.has(word) || contextualKeywords.has(word) || patternWords.has(word) ||
      previous === "." || previous === "infer")
    if (!named.has(`${token.range[0]}:${identifierName(word)}`) && !exempt) found.push(`name ${word} at ${token.range[0]} has no node`)
  })
  return found
}

// Read the written header independently of id/params: losing the sole name or
// last parameter must not grow a contextual-keyword exemption over that slot.
// Parameter types and default expressions contain syntax that is not a binding.
function functionBindings(node, tokens, tokenIndexAt, visitorKeys) {
  const [start, end] = node.range
  const limit = Math.min(end, node.body?.range[0] ?? end, node.returnType?.range[0] ?? end)
  const header = []
  for (let i = tokenIndexAt.get(start); i < tokens.length && tokens[i].range[0] < limit; i++) {
    const token = tokens[i]
    if (!node.typeParameters || token.range[0] < node.typeParameters.range[0] ||
        token.range[0] >= node.typeParameters.range[1]) header.push(token)
  }
  // Loop lowering also makes arrows, whose source header is a for-head.
  // A nested callback in its iterable is not that generated arrow's signature.
  if (node.type === "ArrowFunctionExpression" && !node.returnType) {
    let depth = 0
    let writtenArrow = false
    for (const token of header) {
      if (["(", "[", "{"].includes(token.value)) depth++
      if ([")", "]", "}"].includes(token.value)) depth--
      if (token.value === "=>" && depth === 0) writtenArrow = true
    }
    if (!writtenArrow) return []
  }
  const positions = []
  const open = header.findIndex((token) => token.value === "(")
  const functionWord = header.findIndex((token) => token.value === "function")
  if (functionWord >= 0 && (open < 0 || functionWord < open)) {
    const name = header[functionWord + (header[functionWord + 1]?.value === "*" ? 2 : 1)]
    if (name?.type === "Identifier") positions.push(name.range[0])
  }
  if (open < 0) {
    const arrow = header.findIndex((token) => token.value === "=>")
    const name = header[arrow - 1]
    if (name?.type === "Identifier") positions.push(name.range[0])
    return positions
  }
  const excluded = []
  for (const parameter of node.params ?? []) {
    if (!parameter) continue
    walk(parameter, (child) => {
      for (const syntax of [child.typeAnnotation, child.typeParameters,
        child.type === "AssignmentPattern" ? child.right : null, ...(child.decorators ?? [])]) {
        if (syntax) excluded.push(syntax.range)
      }
      if (child.type === "TSParameterProperty" && child.parameter) {
        excluded.push([child.range[0], child.parameter.range[0]])
      }
    }, visitorKeys)
  }
  let depth = 1
  for (const token of header.slice(open + 1)) {
    if (token.value === "(") depth++
    if (token.value === ")" && --depth === 0) break
    if (token.type === "Identifier" &&
        !excluded.some(([from, to]) => from <= token.range[0] && token.range[1] <= to)) positions.push(token.range[0])
  }
  return positions
}

// Tokens preserve source spelling; ESTree Identifier.name is decoded.
// Keep raw spelling for contextual-word exemptions and failure messages, so
// escaped bindings named match or effect still require an Identifier node.
function identifierName(word) {
  return word.replace(/\\u(?:([0-9a-fA-F]{4})|\{([0-9a-fA-F]+)\})/g,
    (_, fixed, braced) => String.fromCodePoint(Number.parseInt(fixed ?? braced, 16)))
}

// Globals a pattern or a cause catch clause names, which the parser turns
// into a typeof test or a Cause catch.
const patternWords = new Set(["String", "Number", "Boolean", "BigInt", "Symbol", "Cause"])

// Words TypeScript tokenizes as identifiers that the tree keeps as flags or
// operators, not as Identifier nodes.
const contextualKeywords = new Set([
  "abstract", "accessor", "as", "asserts", "assert", "any", "async", "await", "boolean", "constructor", "declare",
  "get", "infer", "intrinsic", "keyof", "module", "namespace", "never", "out", "readonly", "require", "number",
  "object", "satisfies", "set", "string", "symbol", "type", "undefined", "unique", "unknown", "using", "from",
  "global", "bigint", "override", "of", "defer", "source", "with"
])

export const allVisitorKeys = (typescriptKeys) => ({ ...typescriptKeys, ...vibeVisitorKeys })


// The corpus includes deliberately unused source labels. A no-unused-labels
// report is a synthesized-code failure only when its reported name/location
// is not an ordinary label identifier in the author's tree.
export function synthesizedLabelAtNode(message, node) {
  const name = /^'([^']+):' is defined but never used\.$/u.exec(message.message)?.[1]
  return !name || node?.type !== "Identifier" || node.name !== name || node.synthesized === true
}

export function reportsSynthesizedLabel(message, sourceCode) {
  const index = sourceCode.getIndexFromLoc({ line: message.line, column: message.column - 1 })
  return synthesizedLabelAtNode(message, sourceCode.getNodeByRangeIndex(index))
}

// The corpus guard detects diagnostics on generated code, rather than requiring
// every regression fixture to satisfy recommended style rules. A literal the
// author wrote is allowed to be a constant condition; an unwritten true is not.
export function sourceLiteralAtNode(message, node, text) {
  return message.nodeType === "Literal" && node?.type === "Literal" &&
    node.synthesized !== true && typeof node.raw === "string" &&
    node.range?.[1] > node.range?.[0] && text.slice(...node.range) === node.raw
}

export function reportsSynthesizedConstant(message, sourceCode) {
  const start = sourceCode.getIndexFromLoc({ line: message.line, column: message.column - 1 })
  const end = sourceCode.getIndexFromLoc({ line: message.endLine, column: message.endColumn - 1 })
  let written = false
  // Lowered do nodes can overlap a source literal: getNodeByRangeIndex may
  // return a synthetic temporary instead. Match the reported node exactly.
  walk(sourceCode.ast, (node) => {
    if (node.range[0] === start && node.range[1] === end && sourceLiteralAtNode(message, node, sourceCode.text)) written = true
  }, sourceCode.visitorKeys)
  return !written
}
