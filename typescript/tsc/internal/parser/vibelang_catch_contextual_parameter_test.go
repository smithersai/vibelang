package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangCatchContextualArrowParameter(t *testing.T) {
	for _, name := range []string{"value", "async", "of", "from", "get"} {
		t.Run(name, func(t *testing.T) {
			source := "effect function f() { return task catch " + name + " => " + name + ".length }"
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("valid arrow parameter %q rejected: %v", name, file.Diagnostics())
			}
			var handler *ast.Node
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsCallExpression(node) && ast.IsIdentifier(node.Expression()) && node.Expression().Text() == "$catchExpression" {
					handler = node.Arguments()[1]
					return true
				}
				return node.ForEachChild(visit)
			}
			visit(file.AsNode())
			if handler == nil || !ast.IsArrowFunction(handler) || handler.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 {
				t.Fatal("plain arrow parameter did not keep its handler")
			}
		})
	}
}
