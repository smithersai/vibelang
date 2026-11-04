package vibelang

import (
	"context"
	"slices"
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

// Chapter 007, "Legacy prelude shorthand": the transitional compiler accepts a
// module's name written for its same-named export (D311), and every --fix
// scope writes the export: Option<A> becomes Option.Option<A>, a bare Scope
// type Scope.Scope, Experimental.Process in a type
// Experimental.Process.Process, and FileSystem.of FileSystem.FileSystem.of.
// The checker records each site it resolved that way (moduleAliasState), so
// the rewrite follows the resolved binding: a local, imported or ambient
// type of the same name is not a site, and a written M.M is left alone.
func preludeShorthandMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	if !file.FileName().IsVibeLangSource() {
		return p
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	program.GetSemanticDiagnostics(ctx, file) // checking records the sites
	state := moduleServiceStateOf(c)
	type site struct {
		at   int
		name string
	}
	var sites []site
	for node := range state.typeNames {
		if ast.GetSourceFileOfNode(node) == file && ast.IsIdentifier(node) {
			sites = append(sites, site{node.End(), node.Text()})
		}
	}
	for node, export := range state.accesses {
		if ast.GetSourceFileOfNode(node) == file && ast.IsPropertyAccessExpression(node) {
			sites = append(sites, site{node.Expression().End(), export})
		}
	}
	// The runtime prelude declares the bare type Scope as Scope.Scope (D48);
	// chapter 7 repairs it to the export too, native TypeScript's spelling.
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsTypeReferenceNode(n) {
			if name := n.AsTypeReferenceNode().TypeName; ast.IsIdentifier(name) && name.Text() == "Scope" && file.AsNode().Locals()["Scope"] == nil {
				// The bare type resolves to the prelude's alias or straight to
				// effect/Scope's interface; a local or imported Scope is its own.
				written := c.GetSymbolAtLocation(name)
				// A nested import alias is not in the source file's Locals.
				// Preserve that written binding before following its external target.
				if written != nil && slices.ContainsFunc(written.Declarations(), func(decl *ast.Node) bool {
					return ast.GetSourceFileOfNode(decl) == file
				}) {
					return n.ForEachChild(visit)
				}
				if resolved := resolvedAlias(c, written); resolved != nil && len(resolved.Declarations()) > 0 {
					if from := ast.GetSourceFileOfNode(resolved.Declarations()[0]); from != file && (packageNameOf(c, from) == "vibelang-runtime" || packageNameOf(c, from) == "effect") {
						sites = append(sites, site{name.End(), "Scope"})
					}
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	slices.SortFunc(sites, func(a, b site) int { return a.at - b.at })
	var taken []sourceEdit
	for _, s := range sites {
		line, column := scannerLineOf(file, s.at)
		key := "preludeShorthand:" + s.name + ":" + strconv.Itoa(line+1) + ":" + strconv.Itoa(column+1)
		edit := sourceEdit{s.at, s.at, "." + s.name}
		if refused[key] || overlapsAny(edit, taken) {
			continue
		}
		p.fixes = append(p.fixes, fileFix{edits: []sourceEdit{edit}, key: key, label: preludeKeyLabel})
		taken = append(taken, edit)
	}
	return p
}
