package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Outside effect code, join is an identifier. `join [0]` is a valid element
// access whatever the spacing, so it keeps its TypeScript meaning; only a
// bracket that cannot start an element access recovers as join (#503).
func TestJoinElementAccessOutsideEffect(t *testing.T) {
	for _, tc := range []struct {
		source    string
		join      bool
		projected bool
	}{
		{"function first(join: number[]) { return join[0] }", false, false},
		{"function first(join: number[]) { return join [0] }", false, false},
		{"function first(join: number[]) { return join  [0] }", false, false},
		{"function first(join: number[]) { return join/**/[0] }", false, false},
		{"join [ ]", true, false},
		{"join [ , a]", true, false},
		{"function f(a: any) { return join a }", true, false},
		{"function f(a: any) { return join { a } }", true, false},
		// The projection reads a plain function holding join as effect code.
		{"function f(a: any, b: any) { return join [a, b] }", true, true},
		{"function f(a: any) { return join[a] }", false, true},
	} {
		t.Run(tc.source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe", VibeLangDoAsFunction: tc.projected}, tc.source, core.ScriptKindTS)
			joins, accesses := 0, 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "$join" {
					joins++
				}
				if ast.IsElementAccessExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "join" {
					accesses++
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if tc.join && joins != 1 {
				t.Fatalf("want a join operation, got %d joins and %d element accesses", joins, accesses)
			}
			if !tc.join && (joins != 0 || accesses != 1 || len(file.Diagnostics()) != 0) {
				t.Fatalf("want one element access, got %d joins, %d element accesses, diagnostics %v", joins, accesses, file.Diagnostics())
			}
		})
	}
}
