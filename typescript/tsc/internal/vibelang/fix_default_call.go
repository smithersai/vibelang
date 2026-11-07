package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// The factory cannot throw: it captures the call's completion. Reading its
// private result immediately rethrows an exception through a TypeScript getter.
// The default therefore keeps its native call-time completion, while an Effect
// callable still captures a binding exception as the original defect.
func defaultCallBody(name string) string {
	return "/** @throws {never} */\nexport function " + name + "<A>(operation: {\n/** @throws {unknown} */\n(): A\n}): { readonly value: A } {\ntry { const value = operation(); return { value } }\ncatch (error) { return { get value(): A { throw error } } }\n}"
}

func preservingDefaultCallFix(c *checker.Checker, file *ast.SourceFile, site *ast.Node, key string, home *ast.Node) (fileFix, bool) {
	inParameter := false
	for _, parameter := range home.Parameters() {
		if parameter.Pos() <= site.Pos() && site.End() <= parameter.End() {
			inParameter = true
			break
		}
	}
	if !inParameter {
		return fileFix{}, false
	}
	if signature := c.GetResolvedSignature(site); signature != nil && c.GetTypePredicateOfSignature(signature) != nil {
		return fileFix{}, false
	}
	name := ""
	for _, statement := range file.Statements.Nodes {
		if !parser.IsVibeLangModuleDeclaration(statement) {
			continue
		}
		body := parser.ModuleDeclarationBody(file, statement)
		text := strings.TrimSpace(file.Text()[body.Pos():body.End()])
		module := statement.Name().Text()
		for _, imp := range file.Statements.Nodes {
			if !ast.IsImportDeclaration(imp) || !parser.IsVibeLangModuleReference(imp.ModuleSpecifier()) || imp.ModuleSpecifier().Text() != parser.ModuleDeclarationSpecifier(file.FileName(), module) {
				continue
			}
			clause := imp.AsImportDeclaration().ImportClause
			if clause == nil || clause.AsImportClause().NamedBindings == nil || !ast.IsNamedImports(clause.AsImportClause().NamedBindings) {
				continue
			}
			specs := clause.AsImportClause().NamedBindings.AsNamedImports().Elements.Nodes
			if len(specs) == 1 && text == defaultCallBody(bridgeImportName(specs[0])) {
				alias := specs[0].Name()
				if c.ResolveName(alias.Text(), site, ast.SymbolFlagsValue, false) == c.GetSymbolAtLocation(alias) {
					name = alias.Text()
				}
			}
		}
	}
	var edits []sourceEdit
	if name == "" {
		name = freshName(file, "$default")
		module := freshName(file, "$default$ts")
		header := "\nmodule " + module + " {\n" + defaultCallBody(name) + "\n}\nimport { " + name + " } from " + module + "\n"
		edits = append(edits, sourceEdit{len(file.Text()), len(file.Text()), header})
	}
	start := nodeStart(file, site)
	edits = append(edits, sourceEdit{start, start, name + "(() => ("}, sourceEdit{site.End(), site.End(), ")).value"})
	return fileFix{code: EK0401.Code, edits: edits, key: key, siteStart: site.Pos(), siteEnd: site.End(), sited: true}, true
}
