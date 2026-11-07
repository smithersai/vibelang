package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// writesParameters checks bindings, rather than names: a nested callback can
// write an enclosing parameter, but a shadowed parameter or a property with
// the same name is unrelated. Include all nested bodies for captured writes.
func writesParameters(c *checker.Checker, fn *ast.Node) bool {
	parameters := map[*ast.Symbol]bool{}
	var bind func(*ast.Node)
	bind = func(name *ast.Node) {
		if name == nil {
			return // Array elisions bind no name.
		}
		if ast.IsIdentifier(name) {
			if symbol := c.GetSymbolAtLocation(name); symbol != nil {
				parameters[symbol] = true
			}
		} else if ast.IsBindingPattern(name) {
			for _, element := range name.Elements() {
				if element.Kind == ast.KindBindingElement {
					bind(element.Name())
				}
			}
		}
	}
	for _, parameter := range fn.Parameters() {
		bind(parameter.Name())
	}
	if len(parameters) == 0 {
		return false
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) {
			if node.Parent != nil && node.Parent.Kind == ast.KindNamedTupleMember && node.Parent.Name() == node {
				return false // A tuple label is type-only, not a reference write.
			}
			// GetAssignmentTarget includes updates, compound/logical assignments,
			// destructuring and for-in/of targets. Declarations also matter:
			// a body may initialize a parameter again with "var n = ...".
			declaration := ast.IsDeclarationName(node) && node.Parent.Kind != ast.KindShorthandPropertyAssignment && ast.IsWriteAccessForReference(node)
			if ast.IsAssignmentTarget(node) || declaration {
				symbol := c.GetSymbolAtLocation(node)
				if node.Parent.Kind == ast.KindShorthandPropertyAssignment {
					symbol = c.GetShorthandAssignmentValueSymbol(node.Parent)
				}
				if parameters[symbol] {
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	return visit(fn.Body())
}
