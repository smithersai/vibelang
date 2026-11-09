package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// The thunk adds a function scope, which direct eval can observe.
func foreignInvocationHasDirectEval(call *ast.Node) bool {
	directEval := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if ast.IsCallExpression(node) {
			callee := ast.SkipParentheses(node.Expression())
			if ast.IsIdentifier(callee) && callee.Text() == "eval" {
				directEval = true
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	visit(call)
	return directEval
}
