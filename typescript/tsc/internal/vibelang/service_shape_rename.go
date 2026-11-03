package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() {
	checker.RegisterNameResolutionHook(serviceShapeQualifierName)
	checker.RegisterQualifiedNameResolutionHook(serviceShapeQualifierMember)
}

// The source-level service class also names its Shape namespace. The type
// resolver already supplies that member; editor symbol lookup must retain the
// qualifier's class/import identity when it asks for namespace meaning.
func serviceShapeQualifierName(c *checker.Checker, location *ast.Node, name string, meaning ast.SymbolFlags) *ast.Symbol {
	if !asksForModule(meaning) || !ast.IsIdentifier(location) || location.Text() != name {
		return nil
	}
	return serviceShapeQualifierSymbol(c, location)
}

func serviceShapeQualifierMember(c *checker.Checker, name *ast.Node, namespace *ast.Symbol, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	if !asksForModule(meaning) {
		return nil
	}
	return serviceShapeQualifierSymbol(c, name)
}

// asksForModule reports whether meaning is a qualifier's namespace lookup.
// SymbolFlagsType shares SymbolFlagsEnum with SymbolFlagsNamespace, so testing
// that mask lets resolveServiceShapeName's own type lookup back into these
// hooks, which overflows the stack on a name no scope declares.
func asksForModule(meaning ast.SymbolFlags) bool {
	return meaning&(ast.SymbolFlagsValueModule|ast.SymbolFlagsNamespaceModule) != 0
}

func serviceShapeQualifierSymbol(c *checker.Checker, entity *ast.Node) *ast.Symbol {
	file := ast.GetSourceFileOfNode(entity)
	if !isVibeLangFile(file) {
		return nil
	}
	parent := entity.Parent
	if parent == nil || !ast.IsQualifiedName(parent) || parent.AsQualifiedName().Left != entity ||
		parent.AsQualifiedName().Right.Text() != serviceShapeName || !ast.IsTypeReferenceNode(parent.Parent) {
		return nil
	}
	q := parent.AsQualifiedName()
	if resolveServiceShapeName(c, parent, q.Left, q.Right, ast.SymbolFlagsType) == nil {
		return nil
	}
	// Alias meaning preserves a local import's spelling and rename ownership.
	return c.ResolveEntityName(entity, ast.SymbolFlagsClass|ast.SymbolFlagsAlias)
}
