package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Changing this callable to return an Effect also changes its self-references.
// The local Promise bridge rewrite cannot update recursive calls, aliases or
// callbacks that retain the original Promise contract. Refuse such actions.
func asyncReferencesSelf(c *checker.Checker, fn *ast.Node) bool {
	symbols := map[*ast.Symbol]bool{}
	add := func(name *ast.Node) {
		if name != nil {
			if symbol := c.GetSymbolAtLocation(name); symbol != nil {
				for _, root := range c.GetRootSymbols(resolvedAlias(c, symbol)) {
					symbols[root] = true
				}
			}
		}
	}
	add(fn.Name())
	value := fn
	for value.Parent != nil && ast.IsParenthesizedExpression(value.Parent) {
		value = value.Parent
	}
	if parent := value.Parent; parent != nil && (ast.IsVariableDeclaration(parent) || ast.IsPropertyAssignment(parent) || ast.IsPropertyDeclaration(parent)) && parent.Initializer() == value {
		add(parent.Name())
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node == nil || ast.IsTypeNode(node) {
			return false
		}
		if ast.IsCallExpression(node) {
			if signature := c.GetResolvedSignature(node); signature != nil && signature.Declaration() == fn {
				return true
			}
		}
		if !ast.IsDeclarationName(node) && (ast.IsIdentifier(node) || ast.IsPrivateIdentifier(node) || ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node) || ast.IsStringOrNumericLiteralLike(node)) {
			if symbol := c.GetSymbolAtLocation(node); symbol != nil {
				for _, root := range c.GetRootSymbols(resolvedAlias(c, symbol)) {
					if symbols[root] {
						return true
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	for _, parameter := range fn.Parameters() {
		if visit(parameter) {
			return true
		}
	}
	return visit(fn.Body())
}
