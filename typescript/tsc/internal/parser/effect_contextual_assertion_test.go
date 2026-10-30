package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestEffectContextualAssertions(t *testing.T) {
	for _, name := range []string{"effect", "async"} {
		for _, operator := range []string{"as", "satisfies"} {
			source := name + " " + operator + " (Handler)"
			t.Run(source, func(t *testing.T) {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
				if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
					t.Fatalf("ordinary TypeScript expression rejected: %v", diagnostics)
				}
				statements := file.Statements
				if len(statements.Nodes) != 1 || statements.Nodes[0].Kind != ast.KindExpressionStatement {
					t.Fatalf("assertion parsed as a declaration: %v", statements.Nodes)
				}
				want := ast.KindAsExpression
				if operator == "satisfies" {
					want = ast.KindSatisfiesExpression
				}
				if got := statements.Nodes[0].Expression().Kind; got != want {
					t.Fatalf("got %v, want %v", got, want)
				}
			})
		}
	}
}
