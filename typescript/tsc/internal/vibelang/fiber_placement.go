package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// isFiberOperator reads the parser marker: ordinary calls named fork/join
// outside effect code keep their TypeScript meaning.
func isFiberOperator(node *ast.Node) bool {
	if !isKeywordFormCall(node) {
		return false
	}
	callee := ast.SkipParentheses(node.Expression())
	return callee.Text() == "fork" || fiberHelper(node) == "$join" || isForkOwner(node)
}
