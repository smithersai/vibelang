// Detail 272, sixth addendum and tightenings: the native VibeLang AST AND
// the source tokens must agree. ESTree alone erases redundant parentheses.
import { spawnSync } from "node:child_process"

export function vibeParser(compiler) {
  return (text, file) => {
    const result = spawnSync(compiler(), ["--estree", file], {
      input: text, encoding: "utf8", maxBuffer: 64 * 1024 * 1024
    })
    if (result.error || result.status !== 0) throw new Error("VibeLang formatter proof parser failed: " + (result.error?.message ?? result.stderr?.trim()))
    const { ast, error } = JSON.parse(result.stdout)
    if (error) throw new Error("VibeLang test does not parse: " + error.message)
    return ast
  }
}

const trivia = new Set(["range", "loc", "start", "end", "tokens", "comments", "leadingComments", "trailingComments", "innerComments"])
function structural(value) {
  if (Array.isArray(value)) return value.map(structural)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.keys(value).filter(k => !trivia.has(k)).sort().map(k => [k, structural(value[k])]))
}

// Only statement terminators, never EmptyStatement or punctuation in a for
// head. The exact final token must be at the statement node end. Visiting
// the tree also handles declarations nested in export declarations.
const terminated = new Set(["ExpressionStatement", "VariableDeclaration", "ReturnStatement", "ThrowStatement",
  "BreakStatement", "ContinueStatement", "DebuggerStatement", "ImportDeclaration", "ExportNamedDeclaration",
  "ExportDefaultDeclaration", "ExportAllDeclaration", "TSTypeAliasDeclaration", "TSImportEqualsDeclaration",
  "TSExportAssignment", "DoWhileStatement"])
function signature(ast, text) {
  if (ast?.type !== "Program" || !Array.isArray(ast.body) || !Array.isArray(ast.tokens) || !Array.isArray(ast.comments))
    throw new Error("VibeLang parser did not return a complete AST and token stream")
  const terminators = new Set()
  const visit = (node, parent, key) => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) { for (const n of node) visit(n, parent, key); return }
    if (terminated.has(node.type) && Array.isArray(node.range) &&
      !(parent && ["ForStatement", "ForInStatement", "ForOfStatement"].includes(parent.type) && ["init", "left"].includes(key)))
      terminators.add(node.range[1])
    for (const k of Object.keys(node)) if (!trivia.has(k)) visit(node[k], node, k)
  }
  visit(ast)
  const range = token => {
    if (!Array.isArray(token.range) || token.range.length !== 2 || !Number.isInteger(token.range[0]) ||
      !Number.isInteger(token.range[1]) || token.range[0] < 0 || token.range[1] <= token.range[0] || token.range[1] > text.length)
      throw new Error("VibeLang parser returned an invalid token range")
    return token.range
  }
  const code = ast.tokens.map(t => { range(t); return t })
  const tokens = code.filter((t, i) => {
    if (t.type !== "Punctuator") return true
    if (t.value === ";" && terminators.has(t.range[1])) return false
    // AST equality independently rejects holes, sequence changes and any
    // purported trailing comma that changes a syntactic list.
    if (t.value === "," && code[i+1]?.type === "Punctuator" && ["]", "}", ")", ">"].includes(code[i+1].value)) return false
    return true
  }).map(t => ({at:t.range[0], value:[t.type, text.slice(...t.range)]}))
  for (const comment of ast.comments) {
    range(comment)
    if (!["Line", "Block", "Shebang"].includes(comment.type) || typeof comment.value !== "string")
      throw new Error("VibeLang parser returned an invalid comment")
    tokens.push({at:comment.range[0], value:[comment.type, comment.value.replace(/\s+/gu, " ").trim()]})
  }
  tokens.sort((a,b) => a.at-b.at)
  return {ast: structural(ast), tokens: tokens.map(t => t.value)}
}

export function proveFormatterOnly({file, before, after, parseVibe}) {
  if (typeof parseVibe !== "function") throw new Error("VibeLang parser required for formatter-only proof")
  const a = signature(parseVibe(before, file), before)
  const b = signature(parseVibe(after, file), after)
  if (JSON.stringify(a.ast) !== JSON.stringify(b.ast)) throw new Error("formatter-only AST differs")
  if (JSON.stringify(a.tokens) !== JSON.stringify(b.tokens)) throw new Error("formatter-only token stream differs (comments and parentheses are protected)")
  return {kind: "formatter-only", proof: {ast:true, tokens:true}, reason: "AST and token stream identical apart from whitespace, trailing commas and statement terminators"}
}
