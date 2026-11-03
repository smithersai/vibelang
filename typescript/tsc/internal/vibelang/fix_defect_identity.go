package vibelang

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// defectBridgeIdentity names Effect's identity mapper without adding an
// uncovered local callback. A fresh import cannot capture a user binding.
func defectBridgeIdentity(c *checker.Checker, file *ast.SourceFile, sites []*ast.Node) (string, *sourceEdit) {
	if len(sites) > 0 {
		for _, statement := range file.Statements.Nodes {
			if !ast.IsImportDeclaration(statement) {
				continue
			}
			module := statement.ModuleSpecifier()
			if module == nil || module.Kind != ast.KindStringLiteral || module.Text() != "effect/Function" {
				continue
			}
			name := namedImportLocal(statement, "identity")
			if name == "" {
				continue
			}
			var imported *ast.Symbol
			clause := statement.ImportClause().AsImportClause()
			for _, spec := range clause.NamedBindings.Elements() {
				if spec.Name().Text() == name {
					imported = c.GetSymbolAtLocation(spec.Name())
					break
				}
			}
			visible := imported != nil
			for _, site := range sites {
				if c.ResolveName(name, site, ast.SymbolFlagsValue, false) != imported {
					visible = false
					break
				}
			}
			if visible {
				return name, nil
			}
		}
	}
	// Identifier text is decoded: a Unicode escape can spell identity without
	// containing that spelling in the source text searched by freshName.
	used := make(map[string]bool)
	var names func(*ast.Node) bool
	names = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			used[n.Text()] = true
		}
		return n.ForEachChild(names)
	}
	file.AsNode().ForEachChild(names)
	name := freshName(file, "identity")
	for suffix := 2; used[name]; suffix++ {
		name = "identity" + strconv.Itoa(suffix)
	}
	binding := "identity"
	if name != binding {
		binding += " as " + name
	}
	e := trustedImportEdit(file, "effect/Function", binding)
	return name, &sourceEdit{e.start, e.end, e.text}
}
