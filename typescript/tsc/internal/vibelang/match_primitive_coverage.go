package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Only the synthetic fallthrough query projects coverage. Ordinary is, arm
// and default references keep the guard's normal narrowing (VIP-7/detail78).
func primitiveCoverageReference(reference *ast.Node) bool {
	if reference == nil {
		return false
	}
	reference = ast.WalkUpParenthesizedExpressions(reference)
	call := reference.Parent
	return call != nil && ast.IsCallExpression(call) && isSynthesizedName(call.Expression(), "$noMatch") &&
		len(call.Arguments()) == 1 && call.Arguments()[0] == reference
}
