package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// A single call of a named factory identifies its result without quoting
// editable arguments. Repeated and computed callees retain their full excerpt.
func stableFactoryResultLabel(file *ast.SourceFile, source *ast.Node) string {
	source = ast.SkipParentheses(source)
	if !ast.IsCallExpression(source) {
		return ""
	}
	var named func(*ast.Node) bool
	named = func(n *ast.Node) bool {
		n = ast.SkipParentheses(n)
		return ast.IsIdentifier(n) || ast.IsPropertyAccessExpression(n) && named(n.Expression())
	}
	if !named(source.Expression()) {
		return ""
	}
	callee := nodeText(file, source.Expression())
	count := 0
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) && nodeText(file, n.Expression()) == callee {
			count++
		}
		return count > 1 || n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if count != 1 {
		return ""
	}
	return callee + "(…)"
}
