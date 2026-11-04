package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { fileChecks = append(fileChecks, checkGlobalLegacyMembers) }

// VIP-1's constructor/eval ban also applies to static globalThis members.
// Resolve the receiver, preserving local shadows and the ordinary type space.
func checkGlobalLegacyMembers(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node) {
			switch globalPlatformName(c, node) {
			case "eval":
				report(c, node, EK0107.With("globalThis.eval runs a string as code and is not allowed in a .vibe file. Move the code to a .ts or .js file."))
			case "Function":
				if !globalLegacyFunctionExempt(node) {
					report(c, node, EK0107.With("globalThis.Function reaches the Function constructor, which runs a string as code. Move the code to a .ts or .js file; instanceof and .prototype stay allowed."))
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// Parentheses and erased assertions preserve the two permitted value uses of Function.
func globalLegacyFunctionExempt(node *ast.Node) bool {
	for node.Parent != nil && ast.IsOuterExpression(node.Parent, ast.OEKParentheses|ast.OEKAssertions) {
		node = node.Parent
	}
	parent := node.Parent
	if parent == nil {
		return false
	}
	if ast.IsBinaryExpression(parent) {
		b := parent.AsBinaryExpression()
		return b.OperatorToken.Kind == ast.KindInstanceOfKeyword && b.Right == node
	}
	return (ast.IsPropertyAccessExpression(parent) || ast.IsElementAccessExpression(parent)) &&
		parent.Expression() == node && staticGlobalMemberName(parent) == "prototype"
}
