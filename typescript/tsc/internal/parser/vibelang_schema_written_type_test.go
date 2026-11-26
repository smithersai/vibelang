package parser_test

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestSchemaWrittenTypeReplacesCompanion(t *testing.T) {
	for _, form := range []string{"schema Message { id: string }", "schema Message = string"} {
		for _, before := range []bool{false, true} {
			for _, scope := range []string{"%s", "namespace N { %s }", "function f() { %s }", "{ %s }", "switch (0) { case 0: %s }"} {
				source := form + "\n/** Type documentation. */ type Message = typeof Message.Type;"
				if before {
					source = "/** Type documentation. */ type Message = typeof Message.Type;\n" + form
				}
				t.Run(fmt.Sprintf("%s/%t/%s", form, before, scope), func(t *testing.T) {
					file := parseVibe(t, fmt.Sprintf(scope, source))
					if len(file.Diagnostics()) != 0 {
						t.Fatal(file.Diagnostics())
					}
					var aliases []*ast.Node
					var walk func(*ast.Node) bool
					walk = func(n *ast.Node) bool {
						if n.Kind == ast.KindTypeAliasDeclaration && n.Name().Text() == "Message" {
							aliases = append(aliases, n)
						}
						n.ForEachChild(walk)
						return false
					}
					walk(file.AsNode())
					if len(aliases) != 1 || aliases[0].Flags&ast.NodeFlagsReparsed != 0 {
						t.Fatalf("want only the written alias, got %d aliases", len(aliases))
					}
				})
			}
		}
	}
}

func TestSchemaWrittenTypeKeepsOtherCollisions(t *testing.T) {
	for _, alias := range []string{
		"type Message<T> = typeof Message.Type;",
		"type Message = string;",
		"type Message = typeof Other.Type;",
		"type Message = typeof Message.Encoded;",
		"type Message = typeof Message.Type<string>;",
		"type Message = typeof Message.Type; type Message = typeof Message.Type;",
		"namespace Other { type Message = typeof Message.Type; }",
	} {
		file := parseVibe(t, "schema Message { id: string }\n"+alias)
		if file.Statements.Nodes[0].Kind != ast.KindTypeAliasDeclaration || file.Statements.Nodes[0].Flags&ast.NodeFlagsReparsed == 0 {
			t.Fatalf("%s: lost the synthesized alias", alias)
		}
	}
	// Two schemas must not be repaired into an ordinary constant/type pair.
	file := parseVibe(t, "schema Message = string; schema Message = string; type Message = typeof Message.Type;")
	if len(file.Statements.Nodes) != 5 {
		t.Fatalf("duplicate schemas lost a companion: %d", len(file.Statements.Nodes))
	}
}

func TestSchemaWrittenTypeAcrossSwitchClauses(t *testing.T) {
	for _, source := range []string{
		"switch (0) { case 0: schema Message = string; break; default: type Message = typeof Message.Type; }",
		"switch (0) { case 0: type Message = typeof Message.Type; break; default: schema Message = string; }",
	} {
		file := parseVibe(t, source)
		var synthesized int
		var walk func(*ast.Node) bool
		walk = func(n *ast.Node) bool {
			if n.Kind == ast.KindTypeAliasDeclaration && n.Flags&ast.NodeFlagsReparsed != 0 {
				synthesized++
			}
			n.ForEachChild(walk)
			return false
		}
		walk(file.AsNode())
		if synthesized != 0 {
			t.Fatalf("switch retained %d synthesized aliases", synthesized)
		}
	}
}

func TestSchemaWrittenTypeLeavesDataCompanion(t *testing.T) {
	file := parseVibe(t, "data Message { Ready }\ntype Message = typeof Message.Type;")
	aliases := 0
	for _, node := range file.Statements.Nodes {
		if node.Kind == ast.KindTypeAliasDeclaration && node.Name().Text() == "Message" {
			aliases++
		}
	}
	if aliases != 2 {
		t.Fatalf("data lost its type companion: %d aliases", aliases)
	}
}

func TestDataWrittenConstructorsReplacesCompanion(t *testing.T) {
	for _, before := range []bool{false, true} {
		for _, scope := range []string{"%s", "namespace N { %s }", "function f() { %s }", "{ %s }", "switch (0) { case 0: %s }"} {
			source := "/** Type docs. */ data Item { A }\n/** Constructor docs. */ const Item = Data.taggedEnum<Item>();"
			if before {
				source = "/** Constructor docs. */ const Item = Data.taggedEnum<Item>();\n/** Type docs. */ data Item { A }"
			}
			t.Run(fmt.Sprintf("%t/%s", before, scope), func(t *testing.T) {
				file := parseVibe(t, fmt.Sprintf(scope, source))
				if len(file.Diagnostics()) != 0 {
					t.Fatal(file.Diagnostics())
				}
				var consts []*ast.Node
				var walk func(*ast.Node) bool
				walk = func(n *ast.Node) bool {
					if n.Kind == ast.KindVariableStatement {
						decls := n.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
						if len(decls) == 1 && ast.IsIdentifier(decls[0].Name()) && decls[0].Name().Text() == "Item" {
							consts = append(consts, n)
						}
					}
					n.ForEachChild(walk)
					return false
				}
				walk(file.AsNode())
				if len(consts) != 1 || parser.IsDataConstructors(consts[0]) {
					t.Fatalf("want only the written constructor constant, got %d constants", len(consts))
				}
			})
		}
	}
}

func TestDataWrittenConstructorsKeepsOtherCollisions(t *testing.T) {
	for _, decl := range []string{
		"let Item = Data.taggedEnum<Item>();",
		"const Item: any = Data.taggedEnum<Item>();",
		"const Item = Data.taggedEnum<Other>();",
		"const Item = Data.taggedEnum<Item<string>>();",
		"const Item = Other.taggedEnum<Item>();",
		"const Item = Data.taggedEnum<Item>(1);",
		"const Item = Data.taggedEnum<Item>(); const Item = Data.taggedEnum<Item>();",
		"namespace Other { const Item = Data.taggedEnum<Item>(); }",
	} {
		file := parseVibe(t, "data Item { A }\n"+decl)
		if !parser.IsDataConstructors(file.Statements.Nodes[0]) {
			t.Fatalf("%s: lost the synthesized data constructor", decl)
		}
	}
	// Generic data keeps its synthesized WithGenerics companion.
	generic := parseVibe(t, "data Item<T> { A { value: T } }\nconst Item = Data.taggedEnum<Item>();")
	synthesized := 0
	for _, node := range generic.Statements.Nodes {
		if parser.IsDataConstructors(node) {
			synthesized++
		}
	}
	if synthesized != 1 {
		t.Fatalf("generic data lost its synthesized constructor: %d", synthesized)
	}
	// Duplicate data declarations keep their companions.
	dup := parseVibe(t, "data Item { A }\ndata Item { B }\nconst Item = Data.taggedEnum<Item>();")
	if len(dup.Statements.Nodes) != 5 {
		t.Fatalf("duplicate data declarations lost a companion: %d", len(dup.Statements.Nodes))
	}
}

func TestDataWrittenConstructorsAcrossSwitchClauses(t *testing.T) {
	for _, source := range []string{
		"switch (0) { case 0: data Item { A }; break; default: const Item = Data.taggedEnum<Item>(); }",
		"switch (0) { case 0: const Item = Data.taggedEnum<Item>(); break; default: data Item { A }; }",
	} {
		file := parseVibe(t, source)
		var synthesized int
		var walk func(*ast.Node) bool
		walk = func(n *ast.Node) bool {
			if parser.IsDataConstructors(n) {
				synthesized++
			}
			n.ForEachChild(walk)
			return false
		}
		walk(file.AsNode())
		if synthesized != 0 {
			t.Fatalf("switch retained %d synthesized data constructors", synthesized)
		}
	}
}
