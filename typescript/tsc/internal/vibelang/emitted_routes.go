package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/packagejson"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Emitted routes (chapter 007, Output names). Migration setup points a
// package's native modules at a VibeLang module through a private package
// import, #vibelang/emitted/<path>, whose vibelang-source condition names the
// source and whose default names emitted JavaScript, so tools that read
// sources reach compiled code. The route belongs to those tools. Compiled
// output names the routed module the way it names any relative import of a
// source, by the module's own output: no route reaches published JavaScript or
// declarations, and the program loads one copy of the module, not the
// route's copy beside its own. A route that names no source this program
// emits stays as written.

const emittedRoutePrefix = "#vibelang/emitted/"

const emittedRouteSourceCondition = "vibelang-source"

// The script transform registers in vibelang.go, ahead of the lowering, so it
// reads the parse tree's specifiers.
func init() {
	compiler.RegisterDeclarationTransformerHook(emittedRouteDeclarations)
}

// emittedRouteTarget is what a route in a file names: the source that its
// package's vibelang-source condition gives, when the program compiles and
// emits that source, or why it does not.
type emittedRouteTarget struct {
	source *ast.SourceFile
	reason string
}

type emittedRouteStateKey struct{}

// emittedRouteState caches the program's sources by path for route lookups.
type emittedRouteState struct {
	sources map[string]*ast.SourceFile
}

func emittedRouteStateOf(c *checker.Checker) *emittedRouteState {
	return c.ExtensionState(emittedRouteStateKey{}, func() any {
		state := &emittedRouteState{sources: map[string]*ast.SourceFile{}}
		for _, file := range c.Program().SourceFiles() {
			state.sources[emittedRouteKey(c, file.FileName().AsString())] = file
		}
		return state
	}).(*emittedRouteState)
}

func emittedRouteKey(c *checker.Checker, path string) string {
	if c.Program().CaseSensitivity() == tspath.CaseInsensitive {
		return strings.ToLower(path)
	}
	return path
}

// isEmittedRoute reports whether text is a route specifier.
func isEmittedRoute(text string) bool {
	return strings.HasPrefix(text, emittedRoutePrefix) && len(text) > len(emittedRoutePrefix)
}

// resolveEmittedRoute reads route from the imports of file's package, as
// Node resolves a private package import: an exact key first, then the one
// wildcard key that matches, substituting its match into the target.
func resolveEmittedRoute(c *checker.Checker, file *ast.SourceFile, route string) emittedRouteTarget {
	program := c.Program()
	directory := program.GetNearestAncestorDirectoryWithPackageJson(file.FileName().Directory())
	if directory == "" {
		return emittedRouteTarget{reason: "the file is in no package"}
	}
	contents := program.GetPackageJsonInfo(directory.ResolveFile("package.json")).GetContents()
	if contents == nil || contents.Imports.Type != packagejson.JSONValueTypeObject {
		return emittedRouteTarget{reason: "its package.json declares no imports"}
	}
	entry, match, found := emittedRouteEntry(contents.Imports.AsObject(), route)
	if !found {
		return emittedRouteTarget{reason: "its package.json declares no import " + route}
	}
	if entry.Type != packagejson.JSONValueTypeObject {
		return emittedRouteTarget{reason: "the import is not an object of conditions"}
	}
	condition, ok := entry.AsObject().Get(emittedRouteSourceCondition)
	if !ok || condition.Type != packagejson.JSONValueTypeString {
		return emittedRouteTarget{reason: "the import has no " + emittedRouteSourceCondition + " path"}
	}
	target := condition.AsString()
	if match != "" {
		target = strings.Replace(target, "*", match, 1)
	}
	path := directory.ResolveFile(target).AsString()
	source := emittedRouteStateOf(c).sources[emittedRouteKey(c, path)]
	switch {
	case source == nil:
		return emittedRouteTarget{reason: target + " is not a source of this program"}
	case source.IsDeclarationFile || program.IsSourceFileFromExternalLibrary(source) || !program.SourceFileMayBeEmitted(source, false /*forceDtsEmit*/):
		return emittedRouteTarget{reason: target + " is not compiled by this program"}
	}
	return emittedRouteTarget{source: source}
}

// emittedRouteEntry finds route's entry among imports and the wildcard match.
func emittedRouteEntry(imports *collections.OrderedMap[string, packagejson.ExportsOrImports], route string) (packagejson.ExportsOrImports, string, bool) {
	if entry, ok := imports.Get(route); ok {
		return entry, "", true
	}
	best, bestMatch, bestPrefix := packagejson.ExportsOrImports{}, "", -1
	for key := range imports.Keys() {
		star := strings.IndexByte(key, '*')
		if star < 0 || strings.Count(key, "*") != 1 || !strings.HasPrefix(key, emittedRoutePrefix) {
			continue
		}
		prefix, suffix := key[:star], key[star+1:]
		if len(route) < len(prefix)+len(suffix) || !strings.HasPrefix(route, prefix) || !strings.HasSuffix(route, suffix) || star <= bestPrefix {
			continue
		}
		entry, _ := imports.Get(key)
		best, bestMatch, bestPrefix = entry, route[len(prefix):len(route)-len(suffix)], star
	}
	return best, bestMatch, bestPrefix >= 0
}

// emittedRouteSpecifier is how output from file names the routed source:
// its relative output name, ./user.js, or, in a compatibility sidecar, which
// preserves source identity, the source's own relative name, ./user.vibe.
func emittedRouteSpecifier(c *checker.Checker, file, source *ast.SourceFile, jsx core.JsxEmit, sidecar bool) string {
	relative := tspath.EnsurePathIsNonModuleName(tspath.GetRelativePathFromDirectory(file.FileName().Directory().AsString(), source.FileName().AsString(), c.Program().CaseSensitivity()))
	if sidecar {
		return relative
	}
	output, _ := outputSpecifierTextWithJSX(relative, jsx)
	return output
}

// emittedRouteSites calls visit for each module specifier node of file that
// is a route: imports, exports, import-equals requires, import() calls and
// import types, in source order.
func emittedRouteSites(file *ast.SourceFile, visit func(specifier *ast.Node)) {
	var walk func(*ast.Node) bool
	walk = func(node *ast.Node) bool {
		if specifier := emittedRouteSpecifierNode(node); specifier != nil {
			visit(specifier)
		}
		return node.ForEachChild(walk)
	}
	file.AsNode().ForEachChild(walk)
}

// emittedRouteSpecifierNode returns node's module specifier when it is a
// string literal route.
func emittedRouteSpecifierNode(node *ast.Node) *ast.Node {
	var specifier *ast.Node
	switch node.Kind {
	case ast.KindImportDeclaration, ast.KindJSImportDeclaration:
		specifier = node.AsImportDeclaration().ModuleSpecifier
	case ast.KindExportDeclaration:
		specifier = node.AsExportDeclaration().ModuleSpecifier
	case ast.KindExternalModuleReference:
		specifier = node.AsExternalModuleReference().Expression
	case ast.KindCallExpression:
		if ast.IsImportCall(node) && len(node.Arguments()) > 0 {
			specifier = node.Arguments()[0]
		}
	case ast.KindImportType:
		if argument := node.AsImportTypeNode().Argument; argument != nil && ast.IsLiteralTypeNode(argument) {
			specifier = argument.AsLiteralTypeNode().Literal
		}
	}
	if specifier != nil && ast.IsStringLiteral(specifier) && isEmittedRoute(specifier.Text()) {
		return specifier
	}
	return nil
}

// newEmittedRouteRewriter returns the script transform that names each routed
// module by its output in file's JavaScript.
func newEmittedRouteRewriter(opts *transformers.TransformOptions, file *ast.SourceFile) *transformers.Transformer {
	if file.IsDeclarationFile || !strings.Contains(file.Text(), emittedRoutePrefix) {
		return nil
	}
	r, ok := opts.EmitResolver.(*checker.EmitResolver)
	if !ok {
		return nil
	}
	rewrites := map[string]string{}
	r.WithChecker(func(c *checker.Checker) {
		emittedRouteSites(file, func(specifier *ast.Node) {
			if target := resolveEmittedRoute(c, file, specifier.Text()); target.source != nil {
				rewrites[specifier.Text()] = emittedRouteSpecifier(c, file, target.source, opts.CompilerOptions.Jsx, false)
			}
		})
	})
	if len(rewrites) == 0 {
		return nil
	}
	tx := &emittedRouteRewriter{rewrites: rewrites}
	return tx.NewTransformer(tx.visit, opts.Context)
}

type emittedRouteRewriter struct {
	transformers.Transformer
	rewrites map[string]string
}

func (tx *emittedRouteRewriter) visit(node *ast.Node) *ast.Node {
	return rewriteEmittedRouteNode(tx.Factory(), tx.EmitContext(), node, tx.rewrites, tx.Visitor().VisitEachChild)
}

// rewriteEmittedRouteNode replaces a route specifier of node from rewrites,
// then visits its children with visit.
func rewriteEmittedRouteNode(f *printer.NodeFactory, emitContext *printer.EmitContext, node *ast.Node, rewrites map[string]string, visit func(*ast.Node) *ast.Node) *ast.Node {
	specifier := emittedRouteSpecifierNode(node)
	if specifier == nil {
		return visit(node)
	}
	text, ok := rewrites[specifier.Text()]
	if !ok {
		return visit(node)
	}
	literal := f.NewStringLiteral(text, specifier.AsStringLiteral().TokenFlags)
	emitContext.SetOriginal(literal, specifier)
	emitContext.AssignCommentAndSourceMapRanges(literal, specifier)
	node = visit(node)
	switch node.Kind {
	case ast.KindImportDeclaration, ast.KindJSImportDeclaration:
		d := node.AsImportDeclaration()
		return f.UpdateImportDeclaration(d, d.Modifiers(), d.ImportClause, literal, d.Attributes)
	case ast.KindExportDeclaration:
		d := node.AsExportDeclaration()
		return f.UpdateExportDeclaration(d, d.Modifiers(), d.IsTypeOnly, d.ExportClause, literal, d.Attributes)
	case ast.KindExternalModuleReference:
		return f.UpdateExternalModuleReference(node.AsExternalModuleReference(), literal)
	case ast.KindCallExpression:
		call := node.AsCallExpression()
		arguments := append([]*ast.Node{literal}, call.Arguments.Nodes[1:]...)
		return f.UpdateCallExpression(call, call.Expression, call.QuestionDotToken, call.TypeArguments, f.NewNodeList(arguments), node.Flags)
	case ast.KindImportType:
		t := node.AsImportTypeNode()
		argument := f.UpdateLiteralTypeNode(t.Argument.AsLiteralTypeNode(), literal)
		return f.UpdateImportTypeNode(t, t.IsTypeOf, argument, t.Attributes, t.Qualifier, t.TypeArguments)
	}
	return node
}

// emittedRouteDeclarations names each routed module by its output in the
// declarations emitted for file, including import types that declaration
// emit writes from a package import of its own. Every declaration file is
// read: a file need not name a route to receive one.
func emittedRouteDeclarations(resolver printer.EmitResolver, file *ast.SourceFile) func(*ast.SourceFile) *ast.SourceFile {
	r, ok := resolver.(*checker.EmitResolver)
	if !ok || file.IsDeclarationFile {
		return nil
	}
	sidecar := resolver.EmitContext() != nil && resolver.EmitContext().VibeDeclarationSidecar
	return func(declarations *ast.SourceFile) *ast.SourceFile {
		rewrites := map[string]string{}
		r.WithChecker(func(c *checker.Checker) {
			emittedRouteSites(declarations, func(specifier *ast.Node) {
				if _, done := rewrites[specifier.Text()]; done {
					return
				}
				if target := resolveEmittedRoute(c, file, specifier.Text()); target.source != nil {
					rewrites[specifier.Text()] = emittedRouteSpecifier(c, file, target.source, core.JsxEmitNone, sidecar)
				}
			})
		})
		if len(rewrites) == 0 {
			return declarations
		}
		emitContext := resolver.EmitContext()
		f := emitContext.Factory
		var visitor *ast.NodeVisitor
		visitor = emitContext.NewNodeVisitor(func(node *ast.Node) *ast.Node {
			return rewriteEmittedRouteNode(f, emitContext, node, rewrites, visitor.VisitEachChild)
		})
		return visitor.VisitSourceFile(declarations)
	}
}
