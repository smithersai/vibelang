package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// asyncReservesFiberBindings detects ordinary bindings that would become
// reserved names or fiber operations in the selected function's Effect context.
func asyncReservesFiberBindings(c *checker.Checker, fn *ast.Node) bool {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node == nil {
			return false
		}
		switch {
		case ast.IsIdentifier(node):
			if !isFiberWord(node.Text()) || isFiberMemberName(node) {
				return false
			}
			if ast.IsLabeledStatement(node.Parent) || ast.IsBreakOrContinueStatement(node.Parent) {
				return true
			}
			symbol := fiberNameSymbol(c, node)
			return symbol != nil && !isPreludeFiberName(c, symbol, node.Text())
		case node.Kind == ast.KindExpressionWithTypeArguments:
			if parent := node.Parent; parent != nil && parent.Kind == ast.KindHeritageClause && parent.AsHeritageClause().Token == ast.KindExtendsKeyword {
				return visit(node.Expression())
			}
			return false
		case ast.IsTypeNode(node):
			return false
		case ast.IsFunctionLike(node) && !isMarkedEffect(node):
			// Declarations bind in the enclosing context. Plain callable bodies
			// reset the reservation; plain arrow parameters still inherit it.
			if ast.IsFunctionDeclaration(node) && visit(node.Name()) {
				return true
			}
			if name := node.Name(); name != nil && name.Kind == ast.KindComputedPropertyName && visit(name) {
				return true
			}
			if modifiers := node.Modifiers(); modifiers != nil {
				for _, modifier := range modifiers.Nodes {
					if modifier.Kind == ast.KindDecorator && visit(modifier) {
						return true
					}
				}
			}
			if ast.IsArrowFunction(node) {
				for _, parameter := range node.Parameters() {
					if visit(parameter) {
						return true
					}
				}
			}
			return false
		case node.Kind == ast.KindPropertyDeclaration || node.Kind == ast.KindEnumMember:
			// Computed names and decorators keep the enclosing context, while
			// field and enum initializers reset it.
			if name := node.Name(); name != nil && name.Kind == ast.KindComputedPropertyName && visit(name) {
				return true
			}
			if modifiers := node.Modifiers(); modifiers != nil {
				for _, modifier := range modifiers.Nodes {
					if modifier.Kind == ast.KindDecorator && visit(modifier) {
						return true
					}
				}
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	if ast.IsFunctionExpression(fn) && visit(fn.Name()) {
		return true
	}
	for _, parameter := range fn.Parameters() {
		if visit(parameter) {
			return true
		}
	}
	return visit(fn.Body())
}
