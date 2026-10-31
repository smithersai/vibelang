package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-17 and decided detail 242 give an expression its own body's name
// context. The parser reserves declaration bindings in their enclosing
// grammar context; methods have property names, which are never reserved.
func init() {
	fileChecks = append(fileChecks, checkCallableOwnNames)
	registry[EK1702.Code] = EK1702
}

var EK1702 = message(1702, errorCategory, "Fork and join are reserved names in effect code. Rename this callable, or use an ordinary property name.")

func checkCallableOwnNames(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch n.Kind {
		case ast.KindFunctionExpression:
			name := n.Name()
			if name == nil || name.Kind != ast.KindIdentifier || (name.Text() != "fork" && name.Text() != "join") {
				break
			}
			if isMarkedEffect(n) {
				report(c, name, EK1702)
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
