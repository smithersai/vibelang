package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangParenthesizedCatchArrowHandlers(t *testing.T) {
	for _, handler := range []string{
		"() => 7",
		"(() => 7)",
		"((() => 7))",
		"((e: string) => e.length)",
		"(effect () => { return 7 })",
		"(/*before*/ (e: string) => e.length /*after*/)",
	} {
		t.Run(handler, func(t *testing.T) {
			source := "effect function f() { return task catch " + handler + " }"
			file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("valid handler rejected: %v", file.Diagnostics())
			}
			var call *ast.Node
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsCallExpression(node) && ast.IsIdentifier(node.Expression()) && node.Expression().Text() == "$catchExpression" {
					call = node
					return true
				}
				return node.ForEachChild(visit)
			}
			visit(file.AsNode())
			if call == nil || len(call.Arguments()) != 2 || !ast.IsArrowFunction(call.Arguments()[1]) {
				t.Fatal("catch did not retain an arrow handler")
			}
			if call.Arguments()[1].AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 {
				t.Fatal("parenthesized arrow became a fallback returning the function")
			}
			found := false
			for _, form := range forms {
				if form.Kind == parser.VibeSyntaxCatch {
					found = true
					if got := source[form.Right.Pos():form.Right.End()]; got != handler {
						t.Fatalf("handler source range = %q, want %q", got, handler)
					}
				}
			}
			if !found {
				t.Fatal("missing catch source form")
			}
		})
	}
}

func TestVibeLangParenthesizedCatchHandlerRejectsSuffix(t *testing.T) {
	for _, suffix := range []string{"()", ".call(null)", "[0]"} {
		source := "effect function f() { return task catch (() => 7)" + suffix + " }"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		if len(file.Diagnostics()) == 0 {
			t.Fatalf("handler suffix %q was accepted as a value fallback", suffix)
		}
	}
}
