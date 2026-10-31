package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"testing"
)

func TestEffectIsExpressionStatements(t *testing.T) {
	for _, source := range []string{
		"effect is (Number)",
		"async is (String)",
		"function f() { effect is (Number) }",
		"function f() { async is (String) }",
		"effect function f() { effect is (Number) }",
		"effect function f() { async is (String) }",
		"async function f() { effect is (Number) }",
		"function* f() { async is (String) }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostic: %v", ds[0].String())
			}
			statements := file.Statements.Nodes
			if len(statements) != 1 {
				t.Fatalf("got %d statements", len(statements))
			}
			if ast.IsFunctionDeclaration(statements[0]) && statements[0].Name() != nil && statements[0].Name().Text() == "f" {
				if !ast.IsFunctionDeclaration(statements[0]) || statements[0].Body() == nil {
					t.Fatal("lost enclosing function")
				}
				statements = statements[0].Body().Statements()
			}
			if len(statements) != 1 || !ast.IsExpressionStatement(statements[0]) {
				t.Fatal("is expression parsed as a shorthand declaration")
			}
		})
	}
}

func TestEffectIsMethodNamesAndShorthandControls(t *testing.T) {
	for _, source := range []string{
		"class C { effect is(x: number) { return x } }",
		"class C { async is(x: number) { return x } }",
		"const c = { effect is(x: number) { return x } }",
		"const c = { async is(x: number) { return x } }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostic: %v", ds[0].String())
			}
		})
	}
	for _, source := range []string{"effect load() {}", "async load() {}"} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if len(file.Statements.Nodes) != 1 || !ast.IsFunctionDeclaration(file.Statements.Nodes[0]) {
				t.Fatal("lost missing-function recovery")
			}
		})
	}
}

func TestModifierIsBeforeFollowingBlock(t *testing.T) {
	for _, word := range []string{"effect", "async"} {
		t.Run(word, func(t *testing.T) {
			file := parseVibe(t, word+" is (Number)\n{}")
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("unexpected parse diagnostics: %v", file.Diagnostics())
			}
			statements := file.Statements.Nodes
			if len(statements) != 2 || !ast.IsExpressionStatement(statements[0]) || !ast.IsBlock(statements[1]) {
				t.Fatal("pattern test and following block became a function declaration")
			}
		})
	}
}
