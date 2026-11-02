package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Error declarations are classes (D278, D279): these tests pin the class
// each form parses into.

func parseErrorSource(t *testing.T, source string) *ast.SourceFile {
	t.Helper()
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		t.Fatalf("parse errors: %v", diagnostics[0].String())
	}
	return file
}

// describeMember writes a class member as its kind, its name, and whether the
// parser wrote it, with its modifiers.
func describeMember(member *ast.Node) string {
	parts := []string{strings.TrimPrefix(member.Kind.String(), "Kind")}
	if member.Name() != nil {
		parts = append(parts, member.Name().Text())
	}
	for _, modifier := range member.ModifierNodes() {
		parts = append(parts, strings.TrimPrefix(modifier.Kind.String(), "Kind"))
	}
	if member.Flags&ast.NodeFlagsReparsed != 0 {
		parts = append(parts, "synthesized")
	}
	return strings.Join(parts, " ")
}

func classMembers(class *ast.Node) []string {
	var members []string
	for _, member := range class.Members() {
		members = append(members, describeMember(member))
	}
	return members
}

func assertErrorMatcherRegistration(t *testing.T, class *ast.Node, name string) {
	t.Helper()
	members := class.Members()
	if len(members) == 0 || members[0].Kind != ast.KindClassStaticBlockDeclaration {
		t.Fatal("missing leading matcher registration")
	}
	statements := members[0].AsClassStaticBlockDeclaration().Body.Statements()
	if len(statements) != 1 || statements[0].Kind != ast.KindExpressionStatement {
		t.Fatal("matcher registration must contain one call")
	}
	call := statements[0].Expression()
	if call.Kind != ast.KindCallExpression || call.Expression().Text() != "$schemaErrorMatcher" {
		t.Fatal("missing error matcher helper")
	}
	args := call.Arguments()
	if len(args) != 3 || args[0].Kind != ast.KindThisKeyword || args[1].Text() != name || args[2].Kind != ast.KindTrueKeyword {
		t.Fatal("matcher must register this class, its own tag and plain-error mode")
	}
}

func TestErrorDeclarationRootKeepsClassMembers(t *testing.T) {
	t.Parallel()
	file := parseErrorSource(t, `export error Validated implements Coded {
  code: string
  static readonly docs = "x"
  #seen = 0
  constructor(code: string) { super({ code }) }
  get label(): string { return this.code }
}`)
	class := file.Statements.Nodes[0]
	if class.Kind != ast.KindClassDeclaration {
		t.Fatalf("got %v, want a class", class.Kind)
	}
	extends := ast.GetClassExtendsHeritageElement(class)
	callee := extends.Expression().Expression()
	if callee.Text() != "TaggedError" || callee.Flags&ast.NodeFlagsReparsed == 0 {
		t.Fatalf("base is %v, want the synthesized TaggedError", callee.Text())
	}
	fields := extends.TypeArguments()[0].Members()
	if len(fields) != 1 || fields[0].Name().Text() != "code" || !ast.HasSyntacticModifier(fields[0], ast.ModifierFlagsReadonly) {
		t.Fatalf("fields: got %d, want readonly code", len(fields))
	}
	if implements := ast.GetImplementsHeritageClauseElements(class); len(implements) != 1 {
		t.Fatalf("got %d implements elements, want 1", len(implements))
	}
	assertErrorMatcherRegistration(t, class, class.Name().Text())
	got := strings.Join(classMembers(class), "\n")
	want := strings.Join([]string{
		"ClassStaticBlockDeclaration synthesized",
		"PropertyDeclaration docs StaticKeyword ReadonlyKeyword",
		"PropertyDeclaration #seen",
		"Constructor",
		"GetAccessor label",
	}, "\n")
	if got != want {
		t.Fatalf("members:\n%s\nwant:\n%s", got, want)
	}
}

func TestErrorDeclarationSubclassDeclaresItsTag(t *testing.T) {
	t.Parallel()
	file := parseErrorSource(t, `error Child extends Base { extra: number; describe(): string { return "" } }
error Bare extends Base
export const after = 1`)
	if len(file.Statements.Nodes) != 3 {
		t.Fatalf("got %d statements, want 3: a declaration without a body ends at its line", len(file.Statements.Nodes))
	}
	class := file.Statements.Nodes[0]
	call := ast.GetClassExtendsHeritageElement(class).Expression()
	if call.Expression().Text() != "$errorSubclass" || call.Arguments()[0].Text() != "Base" || call.Arguments()[1].Text() != "Child" {
		t.Fatalf("base: got %s(%s, %s)", call.Expression().Text(), call.Arguments()[0].Text(), call.Arguments()[1].Text())
	}
	assertErrorMatcherRegistration(t, class, class.Name().Text())
	got := strings.Join(classMembers(class), "\n")
	want := strings.Join([]string{
		"ClassStaticBlockDeclaration synthesized",
		"PropertyDeclaration _tag DeclareKeyword ReadonlyKeyword synthesized",
		"PropertyDeclaration extra ReadonlyKeyword DeclareKeyword",
		"Constructor synthesized",
		"MethodDeclaration describe",
	}, "\n")
	if got != want {
		t.Fatalf("members:\n%s\nwant:\n%s", got, want)
	}
	assertErrorMatcherRegistration(t, file.Statements.Nodes[1], "Bare")
	if got := strings.Join(classMembers(file.Statements.Nodes[1]), "\n"); got != "ClassStaticBlockDeclaration synthesized\nPropertyDeclaration _tag DeclareKeyword ReadonlyKeyword synthesized" {
		t.Fatalf("a subclass without fields keeps its matcher registration and tag: got\n%s", got)
	}
}

func TestSchemaErrorDeclaration(t *testing.T) {
	t.Parallel()
	file := parseErrorSource(t, `schema error FsError { _tag: string; method: string }
schema error Missing extends FsError { path: string }
schema error { id: string }`)
	root := ast.GetClassExtendsHeritageElement(file.Statements.Nodes[0]).Expression()
	factory := root.Expression().Expression()
	if !ast.IsPropertyAccessExpression(factory) || factory.Name().Text() != "TaggedError" {
		t.Fatalf("a schema error's base is Schema.TaggedError<Self>()(...)")
	}
	if tag := root.Arguments()[0]; !ast.IsAsExpression(tag) {
		t.Fatalf("a _tag field types the tag: got %v, want \"FsError\" as string", tag.Kind)
	}
	if fields := root.Arguments()[1].AsObjectLiteralExpression().Properties.Nodes; len(fields) != 1 || fields[0].Name().Text() != "method" {
		t.Fatalf("got %d field schemas, want method alone", len(fields))
	}
	sub := ast.GetClassExtendsHeritageElement(file.Statements.Nodes[1]).Expression()
	extend := sub.Expression().Expression()
	if !ast.IsPropertyAccessExpression(extend) || extend.Name().Text() != "extend" || extend.Expression().Text() != "FsError" {
		t.Fatalf("a schema error subclass's base is FsError.extend<Self>(...)(...)")
	}
	if fields := sub.Arguments()[0].AsObjectLiteralExpression().Properties.Nodes; len(fields) != 2 || fields[0].Name().Text() != "_tag" || fields[1].Name().Text() != "path" {
		t.Fatalf("want _tag: Schema.tag(\"Missing\") before the fields")
	}
	if schema := file.Statements.Nodes[len(file.Statements.Nodes)-1]; schema.Kind != ast.KindVariableStatement || schema.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Name().Text() != "error" {
		t.Fatalf("schema error { ... } is still a schema named error: got %v", schema.Kind)
	}
}
