package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	checker.RegisterExpressionTypeHook(doBindingReadType)
	checker.RegisterCallExpressionTypeHook(doBindingReadType)
	fileChecks = append(fileChecks, checkDoBindingDefaults)
}

func doBindingReadType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if !(ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed != 0) &&
		!(node.Kind == ast.KindCallExpression && ast.IsPropertyAccessExpression(node.Expression()) && node.Expression().Name().Flags&ast.NodeFlagsReparsed != 0) {
		return t
	}
	origin := parser.VibeLangDoBindingRead(node)
	if origin == nil {
		return t
	}
	return c.NativeBindingElementType(origin.Element, origin.HasDefault)
}

func checkDoBindingDefaults(c *checker.Checker, file *ast.SourceFile) {
	for _, origin := range parser.VibeLangDoBindingReads(file) {
		if origin.Default != nil {
			target := c.NativeBindingElementType(origin.Raw, true)
			c.CheckExpressionAssignableTo(origin.Default, target)
		}
	}
}
