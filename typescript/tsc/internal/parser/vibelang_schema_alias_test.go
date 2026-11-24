package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func parseVibe(t *testing.T, source string) *ast.SourceFile {
	t.Helper()
	return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
}

// TestSchemaAliasParsesAsConstantAndType pins D280's tree: the statement list
// holds the synthesized type alias, then the constant, flagged NodeFlagsVibeLang.
func TestSchemaAliasParsesAsConstantAndType(t *testing.T) {
	t.Parallel()
	file := parseVibe(t, "export schema Code = \"a\" | \"b\";\nconst after = 1\n")
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %v", diagnostics[0].String())
	}
	statements := file.Statements.Nodes
	if len(statements) != 3 {
		t.Fatalf("got %d statements, want the alias, the constant, and const after", len(statements))
	}
	alias, constant := statements[0], statements[1]
	if alias.Kind != ast.KindTypeAliasDeclaration || alias.Flags&ast.NodeFlagsReparsed == 0 || alias.Name().Text() != "Code" {
		t.Fatalf("first statement is %v, want the synthesized type alias Code", alias.Kind)
	}
	if !ast.HasSyntacticModifier(alias, ast.ModifierFlagsExport) || !ast.HasSyntacticModifier(constant, ast.ModifierFlagsExport) {
		t.Fatal("export applies to both the type and the constant")
	}
	query := alias.Type()
	if query.Kind != ast.KindTypeQuery || query.AsTypeQueryNode().ExprName.Kind != ast.KindQualifiedName ||
		query.AsTypeQueryNode().ExprName.AsQualifiedName().Right.Text() != "Type" {
		t.Fatal("the alias is typeof Code.Type")
	}
	declaration := constant.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	if !parser.IsSchemaAliasDeclaration(declaration) {
		t.Fatal("the constant's declaration is flagged as a schema alias")
	}
	call := declaration.Initializer()
	if call.Kind != ast.KindCallExpression || call.Expression().Name().Text() != "Literals" {
		t.Fatalf("a union of literals is Schema.Literals, got %v", call.Kind)
	}
	if statements[2].Kind != ast.KindVariableStatement {
		t.Fatal("the semicolon ends the declaration")
	}
}

// TestSchemaAliasLeavesOtherSpellings checks that the struct form and schema
// as an ordinary name parse as before.
func TestSchemaAliasLeavesOtherSpellings(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"schema User { id: string }",
		"let schema = 1\nschema = 2",
		"const s = schema.version",
	} {
		file := parseVibe(t, source)
		if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
			t.Errorf("%q: unexpected diagnostic %v", source, diagnostics[0].String())
		}
		for _, statement := range file.Statements.Nodes {
			if statement.Kind == ast.KindVariableStatement {
				for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
					if parser.IsSchemaAliasDeclaration(declaration) {
						t.Errorf("%q: parsed as a schema alias", source)
					}
				}
			}
		}
	}
	// In a .ts file schema Code = ... stays TypeScript, which rejects it.
	ts := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, "schema Code = \"a\"", core.ScriptKindTS)
	if len(ts.Diagnostics()) == 0 {
		t.Error("TypeScript accepted schema alias syntax")
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if parser.IsSchemaAliasDeclaration(node) || node.Flags&ast.NodeFlagsReparsed != 0 {
			t.Errorf("TypeScript built a schema alias node: %s at %d", node.Kind, node.Pos())
		}
		return node.ForEachChild(visit)
	}
	ts.AsNode().ForEachChild(visit)
}
