package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// An Effect is not a function (TS2349); try runs it (VIP-5). Service
// members are read from the service before they are called (VIP-10).

// underTry reports whether node, parentheses aside, is the operand of try,
// which the parser marks with NodeFlagsVibeLangTry.
func underTry(node *ast.Node) bool {
	for n := node; ; n = n.Parent {
		if n.Flags&ast.NodeFlagsVibeLangTry != 0 || tryOperand(n.Parent) == n {
			return true
		}
		if n.Parent == nil || !ast.IsParenthesizedExpression(n.Parent) {
			return false
		}
	}
}
