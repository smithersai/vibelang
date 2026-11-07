package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() { checker.RegisterExpressionTypeHook(computedPatternKeyHoistType) }

// A hoisted raw tuple starts as an evolving temporary. Its reads and type
// queries retain the captured expression's tuple type after pattern lowering.
func computedPatternKeyHoistType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsVibeLangTemporary == 0 {
		return t
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return t
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil || declaration.Type() != nil || declaration.Initializer() != nil {
		return t
	}
	source := parser.MatchKeyTypeSource(declaration)
	if source == nil {
		return t
	}
	return c.GetTypeAtLocation(source)
}
