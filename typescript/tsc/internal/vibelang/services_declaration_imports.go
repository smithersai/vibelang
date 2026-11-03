package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"slices"
)

// A service writes its Context type only during declaration transformation.
// Retain a written namespace binding for that module, including aliases, when
// it is visible at every generated use. A local shadow keeps the hygienic
// prelude path instead.
func serviceContextImport(c *checker.Checker, file *ast.SourceFile, emits map[*ast.Node]*serviceEmit, implemented, shapes map[*ast.Node]bool) *ast.Node {
	service := resolvedAlias(c, servicesFor(c).effectExport("Context", "Service"))
	if service == nil {
		return nil
	}
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) || statement.ImportClause() == nil || !ast.IsStringLiteral(statement.ModuleSpecifier()) || statement.ModuleSpecifier().Text() != "effect/Context" {
			continue
		}
		clause := statement.ImportClause().AsImportClause()
		if clause.Name() != nil || clause.NamedBindings == nil || !ast.IsNamespaceImport(clause.NamedBindings) {
			continue
		}
		binding := clause.NamedBindings.Name()
		symbol := resolvedAlias(c, c.GetSymbolAtLocation(binding))
		if symbol == nil {
			continue
		}
		var importedService *ast.Symbol
		for _, exported := range c.GetExportsOfModule(symbol) {
			if exported.Name() == "Service" {
				importedService = resolvedAlias(c, exported)
				break
			}
		}
		if importedService != service {
			continue
		}

		visible := func(at *ast.Node) bool {
			return resolvedAlias(c, c.ResolveName(binding.Text(), at, ast.SymbolFlagsType|ast.SymbolFlagsValue|ast.SymbolFlagsNamespace, false)) == symbol
		}
		safe := true
		for at := range emits {
			if !visible(at) {
				safe = false
				break
			}
		}
		for at := range implemented {
			if !visible(at) {
				safe = false
				break
			}
		}
		for at := range shapes {
			if !visible(at) {
				safe = false
				break
			}
		}
		if safe {
			return statement
		}
	}
	return nil
}

// TypeScript's first declaration transform can elide the import before the
// service adds its base type. Restore exactly one binding in source order.
func (e *serviceEmitter) restoreContextImport(statements []*ast.Node) []*ast.Node {
	source := e.contextImport
	name := source.ImportClause().AsImportClause().NamedBindings.Name().Text()
	for _, statement := range statements {
		if !ast.IsImportDeclaration(statement) || statement.ImportClause() == nil || !ast.IsStringLiteral(statement.ModuleSpecifier()) || statement.ModuleSpecifier().Text() != source.ModuleSpecifier().Text() {
			continue
		}
		clause := statement.ImportClause().AsImportClause()
		if clause.NamedBindings != nil && ast.IsNamespaceImport(clause.NamedBindings) && clause.NamedBindings.Name().Text() == name {
			return statements
		}
	}
	at := 0
	for i, statement := range statements {
		if ast.IsImportDeclaration(statement) && e.ec.MostOriginal(statement).Pos() < source.Pos() {
			at = i + 1
		}
	}
	f := e.ec.Factory
	clause := f.NewImportClause(source.ImportClause().AsImportClause().PhaseModifier, nil, f.NewNamespaceImport(f.NewIdentifier(name)))
	declaration := f.NewImportDeclaration(nil, clause, f.NewStringLiteral(source.ModuleSpecifier().Text(), source.ModuleSpecifier().AsStringLiteral().TokenFlags&ast.TokenFlagsSingleQuote), source.AsImportDeclaration().Attributes)
	return slices.Insert(statements, at, declaration)
}
