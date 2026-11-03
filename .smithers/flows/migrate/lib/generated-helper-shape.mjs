// Formatters may change parentheses, semicolons, quotes and indentation.
// Preserve syntax, types, statement/member order and every comment instead.
const commentText = text => text.replace(/\r\n/g, "\n").replace(/^[ \t]+/gm, "")
export const sameGeneratedDocumentation = (a, b) => commentText(a) === commentText(b)
export function sameGeneratedCode(a, b, ts) {
  const parse = text => ts.createSourceFile("generated-helper.ts", text, ts.ScriptTarget.Latest, true)
  const left = parse(a), right = parse(b)
  if (left.parseDiagnostics.length || right.parseDiagnostics.length) return false
  const shape = node => {
    while (ts.isParenthesizedExpression(node) || ts.isParenthesizedTypeNode(node)) node = node.expression ?? node.type
    const children = []
    ts.forEachChild(node, child => { children.push(shape(child)) })
    // JSDoc type contracts stay attached to their original declarations.
    for (const doc of node.jsDoc ?? []) children.push(["doc", shape(doc)])
    const leaf = ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isLiteralExpression(node) ||
      [ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JSDocText].includes(node.kind)
    const semantics = ["operator", "isTypeOnly", "isTypeOf", "isExportEquals", "isBracketed", "postfix"].map(key => node[key] ?? null)
    return [node.kind, leaf ? node.text : null, semantics, ...children]
  }
  const comments = (source, text) => {
    const found = new Map()
    const record = ranges => { for (const range of ranges ?? []) found.set(range.pos, [range.kind, commentText(text.slice(range.pos, range.end))]) }
    const visit = node => {
      record(ts.getLeadingCommentRanges(text, node.pos))
      record(ts.getTrailingCommentRanges(text, node.end))
      for (const child of node.getChildren(source)) visit(child)
    }
    visit(source)
    return [...found.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)
  }
  return JSON.stringify(shape(left)) === JSON.stringify(shape(right)) &&
    JSON.stringify(comments(left, a)) === JSON.stringify(comments(right, b))
}

export function generatedHelperSuffix(text, source, helper, expected, ts, marker) {
  if (source.statements.at(-1) !== helper) return null
  const comment = (ts.getLeadingCommentRanges(text, helper.pos) ?? []).find(range =>
    range.kind === ts.SyntaxKind.SingleLineCommentTrivia && text.slice(range.pos, range.end) === marker)
  if (!comment || !sameGeneratedCode(text.slice(comment.pos), expected, ts)) return null
  let start = comment.pos
  while (start > 0 && /\s/.test(text[start - 1])) start--
  return { start, end: text.length, text: text.includes("\r\n") ? "\r\n" : "\n" }
}
