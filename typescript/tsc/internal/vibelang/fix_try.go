package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Retained operand analysis recognizes an explicitly written try.

// Retained operand analysis recognizes an explicitly written try.
const ()

// tried reports whether call is already the operand of a try, written
// around parentheses: try (f()).
func tried(call *ast.Node) bool {
	for n := call.Parent; n != nil && ast.IsParenthesizedExpression(n); n = n.Parent {
		if n.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return true
		}
	}
	return false
}
