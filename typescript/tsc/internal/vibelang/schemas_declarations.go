package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

// The declaration file of a schema declaration (D133, D280, D501). The parser
// writes schema User { … } as type User = typeof User.Type before the
// constant, and the declaration transform keeps that order:
//
//	export type User = typeof User.Type;
//	export declare const User: Schema.Struct<{ … }>;
//
// Effect TypeScript writes the constant first, so this moves each schema's
// type after its constant, without the JSDoc the type shares with the
// constant in source, which Effect TypeScript writes on the constant alone:
//
//	export declare const User: Schema.Struct<{ … }>;
//	export type User = typeof User.Type;

func init() { compiler.RegisterDeclarationTransformerHook(schemaDeclarations) }

func schemaDeclarations(resolver printer.EmitResolver, file *ast.SourceFile) func(*ast.SourceFile) *ast.SourceFile {
	if !isVibeLangFile(file) {
		return nil
	}
	ec := resolver.EmitContext()
	return func(declarations *ast.SourceFile) *ast.SourceFile {
		statements, changed := schemaTypesAfterConstants(ec, declarations.Statements.Nodes)
		if !changed {
			return declarations
		}
		list := ec.Factory.NewNodeList(statements)
		list.Loc = declarations.Statements.Loc
		return ec.Factory.UpdateSourceFile(declarations, list, declarations.EndOfFileToken).AsSourceFile()
	}
}

// schemaTypesAfterConstants returns statements with each schema's type moved
// after the constant of the same name that follows it, in namespace bodies
// too, and whether any moved.
func schemaTypesAfterConstants(ec *printer.EmitContext, statements []*ast.Node) ([]*ast.Node, bool) {
	f := ec.Factory
	changed := false
	result := make([]*ast.Node, 0, len(statements))
	pending := map[string]*ast.Node{} // schema types waiting for their constants, by name
	constants := map[string]int{}
	for i, statement := range statements {
		if ast.IsVariableStatement(statement) {
			for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				if name := declaration.Name(); ast.IsIdentifier(name) {
					constants[name.Text()] = i
				}
			}
		}
	}
	for i, statement := range statements {
		if ast.IsModuleDeclaration(statement) {
			if body := statement.Body(); body != nil && ast.IsModuleBlock(body) {
				if inner, ok := schemaTypesAfterConstants(ec, body.Statements()); ok {
					list := f.NewNodeList(inner)
					list.Loc = body.StatementList().Loc
					declaration := statement.AsModuleDeclaration()
					statement = f.UpdateModuleDeclaration(declaration, statement.Modifiers(), declaration.Keyword, statement.Name(), declaration.Attributes, f.UpdateModuleBlock(body.AsModuleBlock(), list))
					changed = true
				}
			}
		}
		if name := schemaTypeName(ec, statement); name != "" {
			ec.AddEmitFlags(statement, printer.EFNoComments)
			changed = true
			if constant, ok := constants[name]; ok && constant > i {
				pending[name] = statement
				continue
			}
			// stripInternal can remove the constant alone. Keep its bare
			// alias here without cancelling moves of unrelated public types.
		}
		result = append(result, statement)
		if ast.IsVariableStatement(statement) {
			for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				if name := declaration.Name(); ast.IsIdentifier(name) && pending[name.Text()] != nil {
					alias := pending[name.Text()]
					delete(pending, name.Text())
					ec.AddEmitFlags(alias, printer.EFNoComments)
					result = append(result, alias)
					changed = true
				}
			}
		}
	}
	return result, changed
}

// schemaTypeName returns the name of statement when it is the type that a
// schema declaration writes, type Name = typeof Name.Type, and "" otherwise.
func schemaTypeName(ec *printer.EmitContext, statement *ast.Node) string {
	original := ec.MostOriginal(statement)
	if !ast.IsTypeAliasDeclaration(statement) || original.Flags&ast.NodeFlagsReparsed == 0 || !ast.IsTypeAliasDeclaration(original) {
		return ""
	}
	query := original.Type()
	if query == nil || !ast.IsTypeQueryNode(query) {
		return ""
	}
	name := query.AsTypeQueryNode().ExprName
	if !ast.IsQualifiedName(name) || !ast.IsIdentifier(name.AsQualifiedName().Left) || name.AsQualifiedName().Right.Text() != "Type" ||
		name.AsQualifiedName().Left.Text() != original.Name().Text() {
		return ""
	}
	return original.Name().Text()
}
