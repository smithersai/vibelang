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
	if !asksForModule(meaning) || location == nil {
		return nil
	}
	if ast.IsIdentifier(location) {
		if location.Text() != name {
			return nil
		}
		return serviceShapeQualifierSymbol(c, location)
	}
	if !isVibeLangFile(ast.GetSourceFileOfNode(location)) {
		return nil
	}
	// Declaration emit checks entity-name visibility from an enclosing
	// declaration rather than the qualifier identifier (emitsupport.go).
	// Resolve the service class or alias so hasVisibleDeclarations late-paints
	// a non-exported service referenced via Name.Shape into the .d.ts output.
	sym := c.ResolveName(name, location, ast.SymbolFlagsClass|ast.SymbolFlagsAlias, false)
	if sym == nil {
		return nil
	}
	target := sym
	if target.Flags()&ast.SymbolFlagsAlias != 0 {
		target = c.GetAliasedSymbol(target)
	}
	if target == nil || target.Flags()&ast.SymbolFlagsClass == 0 {
		return nil
	}
	declaration := target.ValueDeclaration()
	if classKindOf(declaration) != serviceClass || !serviceShapeNamespaceScope(declaration) {
		return nil
	}
	return sym
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
	// Type meaning includes namespace meanings. Asking for it before a
	// class/import exists can re-enter this hook for the same qualifier.
	// Resolve through aliases: an alias can name a module or a type, too.
	// Only an actual class can supply the service Shape namespace.
	class := c.ResolveEntityName(entity, ast.SymbolFlagsClass)
	if class == nil || class.Flags()&ast.SymbolFlagsClass == 0 {
		return nil
	}
	q := parent.AsQualifiedName()
	if resolveServiceShapeName(c, parent, q.Left, q.Right, ast.SymbolFlagsType) == nil {
		return nil
	}
	// Alias meaning preserves a local import's spelling and rename ownership.
	return c.ResolveEntityName(entity, ast.SymbolFlagsClass|ast.SymbolFlagsAlias)
}
