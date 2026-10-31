package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { checker.RegisterDiagnosticsFilterHook(explainDefaultReadonly) }

// Keep TS2540 and its location. Only a member of a data, schema or error body
// carries the parser's implicit readonly modifier, which mutable removes.
func explainDefaultReadonly(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	for i, d := range all {
		if d.Source() != "" || d.Code() != 2540 {
			continue
		}
		name := astnav.GetTokenAtPosition(file, d.Pos())
		if name == nil {
			continue
		}
		symbol := c.GetSymbolAtLocation(name)
		if symbol == nil {
			continue
		}
		for _, declaration := range symbol.Declarations() {
			if declaration.Kind != ast.KindPropertySignature || !isVibeLangFile(ast.GetSourceFileOfNode(declaration)) || declaration.Modifiers() == nil {
				continue
			}
			for _, modifier := range declaration.Modifiers().Nodes {
				if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
					all[i] = note(d.Clone(), "In a data, schema or error body a member is readonly unless written mutable: { mutable {0}: {1} }.",
						scanner.GetTextOfNode(declaration.Name()), c.TypeToString(c.GetTypeOfSymbol(symbol)))
					break
				}
			}
		}
	}
	return all
}
