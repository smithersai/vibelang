// Metadata follows TypeScript; retain undo support for older migration receipts.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Whether node, a reference, is written: assigned, updated, deleted or a
// destructuring or for-in/of target.
export function isWritten(node, ts) {
  let at = node
  while (at.parent && ts.isParenthesizedExpression(at.parent)) at = at.parent
  const parent = at.parent
  if (!parent) return false
  if (ts.isBinaryExpression(parent) && parent.left === at &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) return true
  if (ts.isDeleteExpression(parent)) return true
  if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === at) return true
  // A destructuring assignment target: an element of an array or object
  // literal that is itself assigned to.
  if (ts.isArrayLiteralExpression(parent) || ts.isSpreadElement(parent) || ts.isShorthandPropertyAssignment(parent) ||
      ts.isPropertyAssignment(parent) && parent.initializer === at) {
    let literal = parent
    while (literal.parent && (ts.isArrayLiteralExpression(literal.parent) || ts.isObjectLiteralExpression(literal.parent) ||
        ts.isSpreadElement(literal.parent) || ts.isPropertyAssignment(literal.parent) || ts.isSpreadAssignment(literal.parent))) literal = literal.parent
    if (!ts.isArrayLiteralExpression(literal) && !ts.isObjectLiteralExpression(literal)) literal = literal.parent ?? literal
    return isWritten(literal, ts)
  }
  return false
}

export function restorePrivateResolverExports(root, split) {
  const edit = split?.privateExports
  if (!edit) return
  const path = join(root, edit.manifest), pkg = JSON.parse(readFileSync(path, "utf8"))
  for (const key of edit.keys) {
    if (pkg.exports?.[key] !== null) throw new Error(edit.manifest + ": private resolver export changed during migration")
    delete pkg.exports[key]
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
}
