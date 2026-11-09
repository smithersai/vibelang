package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Checked prelude-name and declaration-spelling analysis remains available
// to ordinary diagnostics and explicit refactors.

// Checked prelude-name and declaration-spelling analysis remains available
// to ordinary diagnostics and explicit refactors.
const ()

// preludeModulePath returns the module that holds the effect module named
// name, which the prelude supplies (D4, D146, D310): effect/Console,
// effect/http/HttpRouter; or "" for any other name.
func preludeModulePath(name string) string {
	if len(effectSubpathShared[name]) > 0 {
		return ""
	}
	if module := preludeModules[name]; strings.HasPrefix(module, "effect/") {
		return module
	}
	if root, ok := effectRootNames[name]; ok && root.namespace {
		return root.module
	}
	if subpath, ok := effectSubpathNames[name]; ok {
		return subpath.module
	}
	return ""
}

// preludePackageOf returns the package whose index lists name, a module the
// prelude supplies: effect for a root module, effect/http for HttpRouter.
func preludePackageOf(name string) string {
	if len(effectSubpathShared[name]) > 0 {
		return ""
	}
	if subpath, ok := effectSubpathNames[name]; ok {
		return subpath.barrel
	}
	if preludeModulePath(name) != "" {
		return effectRootModule
	}
	return ""
}

// hasTypeModifier reports whether binding, an import of statement, is written
// import type or { type X }. The declaration file prints that modifier and the
// prelude's own import has none, so it is a spelling of its own.
func hasTypeModifier(statement *ast.Node, binding *ast.Node) bool {
	if statement.ImportClause().AsImportClause().PhaseModifier == ast.KindTypeKeyword {
		return true
	}
	return ast.IsImportSpecifier(binding) && binding.AsImportSpecifier().IsTypeOnly
}

// exportOfModuleReference returns the module that module refers to and its
// export that right names in module.right, when module is a module that
// reaches the prelude, or a namespace import that the rewrite removes, and
// right is the module's export of the module's own name (D311).
func exportOfModuleReference(c *checker.Checker, module *ast.Node, right *ast.Node, removed map[string]bool) (*ast.Symbol, *ast.Symbol) {
	var name string
	switch {
	case ast.IsIdentifier(module):
		name = module.Text()
	case ast.IsPropertyAccessExpression(module) && ast.IsIdentifier(module.Name()):
		name = module.Name().Text()
	case ast.IsQualifiedName(module):
		name = module.AsQualifiedName().Right.Text()
	default:
		return nil, nil
	}
	if name == "Effect" || right.Text() != name {
		return nil, nil // EK4833 writes Effect.Effect<A> as A!!
	}
	first := firstIdentifier(module)
	if first == nil {
		return nil, nil
	}
	meaning := ast.SymbolFlagsValue
	if ast.IsQualifiedName(module.Parent) {
		meaning = ast.SymbolFlagsNamespace
	}
	if !removed[first.Text()] && !moduleAliasReached(c, module, meaning) {
		return nil, nil
	}
	symbol := c.GetSymbolAtLocation(module)
	export := moduleAliasOf(c, symbol, name)
	if export == nil {
		return nil, nil
	}
	written := c.GetSymbolAtLocation(right)
	if written != nil && written.Flags()&ast.SymbolFlagsAlias != 0 {
		written = c.GetAliasedSymbol(written)
	}
	if written != export {
		return nil, nil
	}
	return symbol, export
}
