package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// After the quick fixes, vibelang --fix writes what the prelude makes
// shorter (D310, D311):
//
//	import * as Console from "effect/Console"           removed: the prelude has Console
//	import { HttpRouter } from "effect/http"             removed: the prelude has HttpRouter
//	import { FileSystem } from "effect/FileSystem"       removed: the module's name names its export
//	Layer.succeed(FileSystem, impl)                      Layer.succeed(FileSystem.FileSystem, impl), once that import goes
//	FileSystem.FileSystem.readFileString(path)           FileSystem.readFileString(path)
//	FileSystem.FileSystem()                              FileSystem()
//	(fs: FileSystem.FileSystem) => …                     (fs: FileSystem) => …
//	Option.Option<number>                                Option<number>
//
// An import goes only when it binds one of effect's modules under the
// module's own name, from that module, effect's root, or the module's
// subpath package, or a module's export of the module's own name from the
// module, and no JavaScript or shared web global takes the name (D264,
// D310). M.M becomes M only where M reaches the module through the prelude,
// or through an import this removes, and D311 gives M that meaning. As with
// the quick fixes, a file's rewrites are kept only when the program then
// reports no error it did not report before.
//
// Every .vibe module has a declaration, including a sidecar with noEmit or
// declaration:false. Unless noUnusedLocals requires source cleanup, an import stays when its spelling
// is not the one the declaration file would write for the prelude's name and
// the file's declaration file keeps it, so the declaration file keeps the
// import its TypeScript wrote (D501): with import * as Schema from
// "effect/Schema" and an export typed Schema.Codec, the declaration keeps
// import * as Schema from "effect/Schema" rather than import { Schema } from
// "effect", and import type keeps its modifier. The declaration file prints types as the source writes them, so
// the emitted declaration decides, not the exports' types: a local
// type NonNull<V> = V extends DateTime.Utc ? … that an export names, or an
// export typed keyof DateTime.Utc, keeps import * as DateTime.

// The kinds of rewrite, as the --fix report names them.
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
