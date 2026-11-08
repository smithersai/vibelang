package ls

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A mapped scalar keeps a visible value expression for codec checking, but
// source references name the library type that selected it (VIP-44). Use its
// retained type-context token for editor symbol queries, keeping value analyses
// on the selected codec and ordinary Schema-value references on their value.
func schemaSourceTypeLocation(c *checker.Checker, node *ast.Node) *ast.Node {
	file := ast.GetSourceFileOfNode(node)
	if file == nil || !file.IsVibeLang() || !ast.IsIdentifier(node) {
		return node
	}
	for _, ref := range file.VibeLangSchemaGenerics {
		if ref.Arity != 0 || len(ref.LibraryScalars) == 0 {
			continue
		}
		var token *ast.Node
		var visit func(*ast.Node) bool
		visit = func(name *ast.Node) bool {
			if ast.IsIdentifier(name) && name.Loc == node.Loc && name.Text() == node.Text() {
				token = name
				return true
			}
			return name.ForEachChild(visit)
		}
		visit(ref.Name)
		if token == nil || scanner.GetTokenPosOfNode(token, file, false) != scanner.GetTokenPosOfNode(node, file, false) {
			continue
		}
		symbol := c.ResolveEntityName(ref.Name, ast.SymbolFlagsType)
		if symbol == nil || ref.LibraryScalars[symbol.Name()] == nil {
			continue
		}
		for _, declaration := range symbol.Declarations() {
			if source := ast.GetSourceFileOfNode(declaration); source != nil && c.Program().IsSourceFileDefaultLibrary(source.PathKey()) {
				return token
			}
		}
	}
	return node
}
