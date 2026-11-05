package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangOptionalArrayBinding(t *testing.T) {
	for _, pattern := range []string{"[let a?]", "[const a?]", "[(let a)?]", "[let a?, const b?]", "[[let a?]?]", "[,, let a?]", "[let a?, ...let rest]"} {
		t.Run(pattern, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, "function f(value:unknown){return match(value){when "+pattern+":true;default:false;}}", core.ScriptKindTS)
			if got := file.Diagnostics(); len(got) != 0 {
				t.Fatalf("optional array binding: %v", got)
			}
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsCallExpression(node) && ast.IsIdentifier(node.Expression()) && node.Expression().Text() == "$patternError" {
					t.Fatal("optional array binding lowers to an unsupported-pattern error")
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
		})
	}
}
