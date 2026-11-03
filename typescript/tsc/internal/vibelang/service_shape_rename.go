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
	if meaning&ast.SymbolFlagsNamespace == 0 || !ast.IsIdentifier(location) || location.Text() != name {
		return nil
	}
	return serviceShapeQualifierSymbol(c, location)
}

func serviceShapeQualifierMember(c *checker.Checker, name *ast.Node, namespace *ast.Symbol, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	if meaning&ast.SymbolFlagsNamespace == 0 {
		return nil
	}
	return serviceShapeQualifierSymbol(c, name)
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
