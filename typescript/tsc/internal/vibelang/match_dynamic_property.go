package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Chapter 004: an extracted property of an unknown subject is unknown.
// A broad key's presence test cannot give TypeScript a named property, so its
// generated read needs that fallback. Source-written accesses keep native checks.
func init() { checker.RegisterExpressionTypeHook(unknownDynamicPatternProperty) }

type unknownDynamicPatternPropertyKey struct{}

func unknownDynamicPatternProperty(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if t != c.GetErrorType() || !ast.IsElementAccessExpression(node) || node.Flags&ast.NodeFlagsVibeLangPatternRead == 0 {
		return t
	}
	root := node.Expression()
	for ast.IsPropertyAccessExpression(root) || ast.IsElementAccessExpression(root) {
		if root.Flags&ast.NodeFlagsVibeLangPatternRead == 0 {
			return t
		}
		root = root.Expression()
	}
	symbol := c.GetSymbolAtLocation(root)
	if symbol == nil || c.GetTypeOfSymbol(symbol).Flags()&checker.TypeFlagsUnknown == 0 {
		return t
	}
	key := c.GetTypeAtLocation(node.AsElementAccessExpression().ArgumentExpression)
	if key == c.GetErrorType() || !c.IsTypeAssignableTo(key, c.GetUnionType([]*checker.Type{c.GetStringType(), c.GetNumberType(), c.GetESSymbolType()})) {
		return t
	}
	covered := c.ExtensionState(unknownDynamicPatternPropertyKey{}, func() any { return map[*ast.Node]bool{} }).(map[*ast.Node]bool)
	if !covered[node] {
		coverCodes(c, node, 7053)
		covered[node] = true
	}
	return c.GetUnknownType()
}
