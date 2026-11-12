package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// formsTypeBinding finds lexical declarations with a type meaning. It
// keeps type and value meanings separate, including generic and nested scopes.
func formsTypeBinding(id *ast.Node, name string) *ast.Node {
	for scope := id.Parent; scope != nil; scope = scope.Parent {
		if ast.IsFunctionLike(scope) || ast.IsClassLike(scope) || scope.Kind == ast.KindTypeAliasDeclaration || scope.Kind == ast.KindInterfaceDeclaration {
			for _, parameter := range scope.TypeParameters() {
				if parameter.Name().Text() == name {
					return parameter
				}
			}
		}
		var statements []*ast.Node
		switch scope.Kind {
		case ast.KindSourceFile:
			statements = scope.AsSourceFile().Statements.Nodes
		case ast.KindBlock, ast.KindModuleBlock:
			statements = scope.Statements()
		case ast.KindCaseBlock:
			// All clauses share the switch's lexical scope.
			for _, clause := range scope.AsCaseBlock().Clauses.Nodes {
				statements = append(statements, clause.Statements()...)
			}
		}
		for _, statement := range statements {
			if (statement.Kind == ast.KindTypeAliasDeclaration || statement.Kind == ast.KindInterfaceDeclaration || statement.Kind == ast.KindClassDeclaration || statement.Kind == ast.KindEnumDeclaration || statement.Kind == ast.KindModuleDeclaration) && statement.Name() != nil && statement.Name().Text() == name {
				return statement
			}
			if statement.Kind == ast.KindImportDeclaration {
				if d := formsImportDeclares(statement, name); d != nil {
					return d
				}
			}
		}
	}
	return nil
}
