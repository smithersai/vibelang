package ls

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// writtenNameMeaning returns the meanings one written VibeLang name declares.
// A schema or data declaration gives its name a value and a type, as a class
// or an enum does, but through two declarations the parser writes at that
// name. A reference search from either meaning covers both, so it returns the
// uses rename edits. A TypeScript const and type alias that share a name are
// written apart and keep their separate searches.
func writtenNameMeaning(symbol *ast.Symbol) ast.SemanticMeaning {
	meaning := ast.SemanticMeaningNone
	declarations := symbol.Declarations()
	for i, declaration := range declarations {
		file := ast.GetSourceFileOfNode(declaration)
		name := declaration.Name()
		if file == nil || !file.IsVibeLang() || name == nil {
			continue
		}
		for _, other := range declarations[i+1:] {
			if otherName := other.Name(); otherName != nil && otherName.End() == name.End() && ast.GetSourceFileOfNode(other) == file {
				meaning |= getMeaningFromDeclaration(declaration) | getMeaningFromDeclaration(other)
			}
		}
	}
	return meaning
}
