package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	checker.RegisterDeclaredTypeHook(doHeadCellType)
	fileChecks = append(fileChecks, checkDoHeadCellScaffolding)
}

// Only the generated tail declarations are intentionally unreachable.
// Their ranges name the source head, so the source loop/body's own
// unreachable-code diagnostics remain visible.
func checkDoHeadCellScaffolding(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsVariableDeclaration(node) {
			if binding := parser.VibeLangDoHeadBinding(node); binding != nil {
				coverCodes(c, ast.GetRootDeclaration(binding), 7027)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// The parser's never-initialized RHS cell has the same declared type as
// its source iteration binding; an untyped synthetic let would lose that
// type (and could incorrectly capture an outer binding's type).
func doHeadCellType(c *checker.Checker, declaration *ast.Node) *checker.Type {
	if binding := parser.VibeLangDoHeadBinding(declaration); binding != nil {
		return c.GetTypeOfSymbol(c.GetSymbolAtLocation(binding.Name()))
	}
	return nil
}
