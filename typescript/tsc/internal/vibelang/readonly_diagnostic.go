package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { checker.RegisterDiagnosticsFilterHook(explainDefaultReadonly) }

// Keep TS2540 and its location. Only a field of a data variant or an error
// carries the parser's implicit readonly modifier. Chapters 3 and 6 make every
// such field readonly, as Effect's Data.TaggedEnum and Data.TaggedError do, so
// the note offers a new value, not a modifier (mutable is retired: EK2125 in
// a data variant, EK3410 in a plain error).
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
					all[i] = note(d.Clone(), "Every field of a data variant or an error is readonly, as in Effect's Data.TaggedEnum and Data.TaggedError; construct a new value with the changed {0} instead.",
						scanner.GetTextOfNode(declaration.Name()))
					break
				}
			}
		}
	}
	return all
}
