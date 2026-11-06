package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Computed names, heritage and decorators run when their definition is
// evaluated. An await there belongs to the enclosing async function, while
// nested callable bodies keep their own context. The bridge rewrite visits
// neither head, so leave the conversion for an explicit rewrite.
func asyncBoundaryHeadHasAwait(node *ast.Node) bool {
	var visit func(*ast.Node) bool
	decorators := func(n *ast.Node) bool {
		if modifiers := n.Modifiers(); modifiers != nil {
			for _, modifier := range modifiers.Nodes {
				if modifier.Kind == ast.KindDecorator && visit(modifier) {
					return true
				}
			}
		}
		return false
	}
	visit = func(n *ast.Node) bool {
		if n == nil {
			return false
		}
		switch {
		case n.Kind == ast.KindAwaitExpression:
			return true
		case n.Kind == ast.KindExpressionWithTypeArguments:
			if parent := n.Parent; parent != nil && ast.IsHeritageClause(parent) && parent.AsHeritageClause().Token == ast.KindExtendsKeyword {
				return visit(n.Expression())
			}
			return false
		case ast.IsTypeNode(n):
			return false
		case ast.IsFunctionLike(n) || n.Kind == ast.KindPropertyDeclaration:
			if name := n.Name(); name != nil && ast.IsComputedPropertyName(name) && visit(name) {
				return true
			}
			if decorators(n) {
				return true
			}
			if ast.IsFunctionLike(n) {
				for _, parameter := range n.Parameters() {
					if decorators(parameter) {
						return true
					}
				}
			}
			return false
		case n.Kind == ast.KindClassStaticBlockDeclaration || n.Kind == ast.KindEnumDeclaration:
			return false
		}
		return n.ForEachChild(visit)
	}
	return visit(node)
}
