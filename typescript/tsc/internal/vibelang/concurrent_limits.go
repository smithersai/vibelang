package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// checkConcurrentLimit applies the source rule to the written operand. The
// parser supplies a reparsed void expression only when no limit was written;
// a source undefined or void expression must still satisfy Types.Concurrency.
func checkConcurrentLimit(c *checker.Checker, file *ast.SourceFile, limit *ast.Node) {
	if limit.Kind == ast.KindVoidExpression && limit.Flags&ast.NodeFlagsReparsed != 0 {
		return
	}
	namespace := effectModuleNamespace(c, file, "Types")
	if namespace == nil {
		return
	}
	symbol := c.TryGetMemberInModuleExports("Concurrency", namespace)
	if symbol == nil {
		return
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	source := c.GetTypeAtLocation(limit)
	target := c.GetDeclaredTypeOfSymbol(symbol)
	if source == nil || target == nil || c.IsTypeAssignableTo(source, target) {
		return
	}
	reportAt(c, file, limit.Loc, EK1907)
	coverArgument(c, limit)
	// Contextual object diagnostics point past source parentheses. Keep
	// coverage on the operand itself so errors in its calls still survive.
	coverArgument(c, ast.SkipParentheses(limit))
}
