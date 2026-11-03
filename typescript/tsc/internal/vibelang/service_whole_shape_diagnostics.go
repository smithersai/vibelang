package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { checker.RegisterDiagnosticsFilterHook(wholeReferenceNamespaceDiagnostics) }

// A whole-shape reference emits a const and has no namespace. The parser's
// internal class would otherwise choose TS2702; use the native const's TS2503.
func wholeReferenceNamespaceDiagnostics(c *checker.Checker, file *ast.SourceFile, items []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return items
	}
	var result []*ast.Diagnostic
	for _, item := range items {
		replacement := item
		if item.Code() == 2702 {
			name := astnav.GetTokenAtPosition(file, item.Pos())
			if ast.IsIdentifier(name) {
				symbol := resolvedAlias(c, c.ResolveName(name.Text(), name, ast.SymbolFlagsType|ast.SymbolFlagsValue|ast.SymbolFlagsNamespace, false))
				if symbol != nil {
					class := symbol.ValueDeclaration()
					if classKindOf(class) == serviceClass && serviceShape(class) != nil && hasDefaultValue(class) {
						replacement = ast.NewDiagnostic(file, scanner.GetErrorRangeForNode(file, name), diagnostics.Cannot_find_namespace_0, name.Text())
					}
				}
			}
		}
		result = append(result, replacement)
	}
	return result
}
