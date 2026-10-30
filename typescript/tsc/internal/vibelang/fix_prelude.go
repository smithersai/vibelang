package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
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
// In a project that emits declarations, an import stays when its spelling
// is not the one the declaration file would write for the prelude's name and
// the file's declaration file keeps it, so the declaration file keeps the
// import its TypeScript wrote (D501): with import * as Schema from
// "effect/Schema" and an export typed Schema.Codec, the declaration keeps
// import * as Schema from "effect/Schema" rather than import { Schema } from
// "effect", and import type keeps its modifier. The declaration file prints types as the source writes them, so
// the emitted declaration decides, not the exports' types: a local
// type NonNull<V> = V extends DateTime.Utc ? … that an export names, or an
// export typed keyof DateTime.Utc, keeps import * as DateTime.

// A preludeRewrite is the rewrites of one file: its edits and how many of
// each kind it makes.
type preludeRewrite struct {
	edits   []sourceEdit
	imports int // imports of a module the prelude supplies, removed
	keys    int // M.M written M
}

// The kinds of rewrite, as the --fix report names them.
const (
	preludeImportLabel = "prelude import"
	preludeKeyLabel    = "module export"
)

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

// preludeRewritesOf plans the rewrites of file, a .vibe file that c checked.
// declared holds the imports file's declaration file keeps, by
// declaredImportKey, in a project that emits declarations.
func preludeRewritesOf(c *checker.Checker, file *ast.SourceFile, declared map[string]bool) preludeRewrite {
	var r preludeRewrite
	text := file.Text()
	removed := map[string]bool{} // names whose imports go, so the prelude supplies them
	kept := map[string]bool{}    // imports the declaration file writes in their own spelling, so M.M stays
	gone := map[*ast.Node]bool{} // the import bindings that go
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) || statement.ImportClause() == nil || !ast.IsStringLiteral(statement.ModuleSpecifier()) {
			continue
		}
		clause := statement.ImportClause().AsImportClause()
		if clause.Name() != nil || clause.NamedBindings == nil {
			continue
		}
		specifier := statement.ModuleSpecifier().Text()
		if ast.IsNamespaceImport(clause.NamedBindings) {
			name := clause.NamedBindings.Name().Text()
			if preludeModulePath(name) != specifier || implicitEffectModuleDisabled(c, file, name) || isBuiltinGlobal(c, name) {
				continue
			}
			if declared[declaredImportKey(specifier, name)] {
				kept[name] = true
				continue
			}
			gone[clause.NamedBindings] = true
			removed[name] = true
			continue
		}
		for _, element := range clause.NamedBindings.Elements() {
			name := element.Name().Text()
			if property := element.PropertyName(); property != nil && property.Text() != name {
				continue
			}
			if isBuiltinGlobal(c, name) || implicitEffectModuleDisabled(c, file, name) {
				continue
			}
			switch {
			case preludePackageOf(name) == specifier:
				if hasTypeModifier(statement, element) && declared[declaredImportKey(specifier, name)] {
					kept[name] = true
					continue
				}
				gone[element] = true
				removed[name] = true
			case preludeModulePath(name) == specifier && !declared[declaredImportKey(specifier, name)]:
				// import { FileSystem } from "effect/FileSystem": the module's export.
				module := c.GetSymbolAtLocation(statement.ModuleSpecifier())
				export := c.GetSymbolAtLocation(element.Name())
				if export != nil && export.Flags()&ast.SymbolFlagsAlias != 0 {
					export = c.GetAliasedSymbol(export)
				}
				if export == nil || export != moduleAliasOf(c, module, name) {
					continue
				}
				uses, ok := moduleExportUses(c, file, module, export, name)
				if !ok {
					continue
				}
				gone[element] = true
				removed[name] = true
				r.edits = append(r.edits, uses...)
			}
		}
	}
	// Remove the bindings that go, and a declaration that loses every one.
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) {
			continue
		}
		var all, going []*ast.Node
		for _, b := range importBindingsOf(file) {
			if b.declaration == statement {
				all = append(all, b.node)
				if gone[b.node] {
					going = append(going, b.node)
				}
			}
		}
		if len(going) == 0 {
			continue
		}
		r.imports += len(going)
		if len(going) == len(all) {
			start, end := nodeStart(file, statement), statement.End()
			if newline := strings.IndexByte(text[end:], '\n'); newline >= 0 && strings.TrimSpace(text[end:end+newline]) == "" {
				end += newline + 1
			}
			r.edits = append(r.edits, sourceEdit{start, end, ""})
			continue
		}
		for _, node := range going {
			r.edits = append(r.edits, bindingRemoval(file, node))
		}
	}
	// M.M becomes M where D311 gives M that meaning.
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsImportDeclaration(node) {
			return false
		}
		// A name the parser writes, as for a schema declaration, has no text of its own.
		if inner, outer := shortenableExport(c, node, removed); inner != nil && node.Flags&ast.NodeFlagsReparsed == 0 && !kept[firstIdentifier(inner).Text()] &&
			strings.TrimSpace(text[inner.End():outer.End()]) == "."+rightName(outer) {
			r.edits = append(r.edits, sourceEdit{inner.End(), outer.End(), ""})
			r.keys++
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return r
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

// declaredImportKey names the import of name from specifier.
func declaredImportKey(specifier, name string) string {
	return specifier + "\x00" + name
}

// declaredImports returns the imports of an effect module that the
// declaration file of file keeps, by declaredImportKey, in a program that
// emits declarations; nil otherwise, or when file imports no effect module
// under the module's own name.
func declaredImports(ctx context.Context, program *compiler.Program, file *ast.SourceFile) map[string]bool {
	if !program.Options().GetEmitDeclarations() {
		return nil
	}
	candidate := false
	for _, b := range importBindingsOf(file) {
		module := b.declaration.ModuleSpecifier()
		if module == nil || !ast.IsStringLiteral(module) {
			continue
		}
		if preludeModulePath(b.name) == module.Text() || preludePackageOf(b.name) == module.Text() && hasTypeModifier(b.declaration, b.node) {
			candidate = true
		}
	}
	if !candidate {
		return nil
	}
	var text string
	program.Emit(ctx, compiler.EmitOptions{TargetSourceFiles: []*ast.SourceFile{file}, EmitOnly: compiler.EmitOnlyDts, ForceEmit: true,
		WriteFile: func(name tspath.RootedFilePath, data string, _ *compiler.WriteFileData) error {
			if tspath.IsDeclarationFileName(name.AsString()) {
				text = data
			}
			return nil
		}})
	declarations := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/declarations.d.ts", PathKey: "/declarations.d.ts"}, text, core.ScriptKindTS)
	declared := map[string]bool{}
	for _, b := range importBindingsOf(declarations) {
		if module := b.declaration.ModuleSpecifier(); module != nil && ast.IsStringLiteral(module) {
			declared[declaredImportKey(module.Text(), b.name)] = true
		}
	}
	return declared
}

// moduleExportUses returns the edits that keep each use of export, a
// module's export of the module's own name that the file imports by name,
// meaning the export once the import is gone and name means the module: a
// type, a member the module does not export, and a service call M() keep
// their text, since D311 gives the module's name those meanings; any other
// use is written name.name. It reports false when a use cannot be rewritten,
// such as an export of the binding.
func moduleExportUses(c *checker.Checker, file *ast.SourceFile, module *ast.Symbol, export *ast.Symbol, name string) ([]sourceEdit, bool) {
	var edits []sourceEdit
	ok := true
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if !ok || ast.IsImportDeclaration(node) {
			return false
		}
		if !ast.IsIdentifier(node) || node.Text() != name {
			return node.ForEachChild(visit)
		}
		symbol := c.GetSymbolAtLocation(node)
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol != export {
			return false
		}
		parent := node.Parent
		switch {
		case ast.IsTypeReferenceNode(parent) && export.Flags()&ast.SymbolFlagsType != 0:
		case ast.IsPropertyAccessExpression(parent) && parent.Expression() == node && !moduleExports(c, module, parent.Name().Text()):
		case ast.IsCallExpression(parent) && parent.Expression() == node && isEffectValueCallSite(parent) && moduleServiceKeyOf(c, module, name) != nil:
		case ast.IsShorthandPropertyAssignment(parent):
			edits = append(edits, sourceEdit{node.End(), node.End(), ": " + name + "." + name})
		case ast.IsExportSpecifier(parent), ast.IsExportAssignment(parent):
			ok = false
		default:
			edits = append(edits, sourceEdit{node.End(), node.End(), "." + name})
		}
		return false
	}
	file.AsNode().ForEachChild(visit)
	return edits, ok
}

// moduleExports reports whether module exports member.
func moduleExports(c *checker.Checker, module *ast.Symbol, member string) bool {
	if module != nil && module.Flags()&ast.SymbolFlagsAlias != 0 {
		module = c.GetAliasedSymbol(module)
	}
	return module != nil && c.TryGetMemberInModuleExports(member, module) != nil
}

// shortenableExport returns inner and outer when node writes a module's
// export of the module's own name, M.M, as inner.outer's last name, where
// writing M alone means the same (D311): M.M.member where the module exports
// no member, M.M() for a service in a function body, or the type M.M.
// removed holds the modules whose imports the rewrite removes, which then
// reach the prelude.
func shortenableExport(c *checker.Checker, node *ast.Node, removed map[string]bool) (inner *ast.Node, outer *ast.Node) {
	switch {
	case ast.IsPropertyAccessExpression(node) && ast.IsIdentifier(node.Name()):
		module := node.Expression()
		parent := node.Parent
		member := ast.IsPropertyAccessExpression(parent) && parent.Expression() == node && ast.IsIdentifier(parent.Name())
		call := ast.IsCallExpression(parent) && parent.Expression() == node && isEffectValueCallSite(parent)
		if !member && !call {
			return nil, nil
		}
		symbol, export := exportOfModuleReference(c, module, node.Name(), removed)
		if export == nil {
			return nil, nil
		}
		if member && moduleExports(c, symbol, parent.Name().Text()) {
			return nil, nil
		}
		if call && moduleServiceKeyOf(c, symbol, node.Name().Text()) == nil {
			return nil, nil
		}
		return module, node
	case ast.IsQualifiedName(node) && ast.IsTypeReferenceNode(node.Parent):
		module := node.AsQualifiedName().Left
		_, export := exportOfModuleReference(c, module, node.AsQualifiedName().Right, removed)
		if export == nil || export.Flags()&ast.SymbolFlagsType == 0 || isBuiltinGlobalType(c, node.AsQualifiedName().Right.Text()) {
			return nil, nil
		}
		return module, node
	}
	return nil, nil
}

// rightName returns the last name that node, a property access or a
// qualified name, writes.
func rightName(node *ast.Node) string {
	if ast.IsQualifiedName(node) {
		return node.AsQualifiedName().Right.Text()
	}
	return node.Name().Text()
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

// preludeRewriteProject plans the rewrites of every fixable file of program
// and returns each file's rewrite.
func preludeRewriteProject(ctx context.Context, program *compiler.Program) map[tspath.RootedFilePath]preludeRewrite {
	rewrites := map[tspath.RootedFilePath]preludeRewrite{}
	for _, file := range fixableFiles(program) {
		program.GetSemanticDiagnostics(ctx, file)
		declared := declaredImports(ctx, program, file)
		c, done := program.GetTypeCheckerForFile(ctx, file)
		r := preludeRewritesOf(c, file, declared)
		done()
		if len(r.edits) > 0 {
			rewrites[file.FileName()] = r
		}
	}
	return rewrites
}
