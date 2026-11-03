package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"testing"
)

func TestDoProvideMarkerHasEmptyCompletion(t *testing.T) {
	for _, provider := range []string{"Layer.empty", "Layer.mergeAll(Layer.empty, Layer.empty)", "Layer.empty, Layer.empty"} {
		for _, body := range []string{"", ";", "empty: {}", "{}", "provide Layer.empty {}", "23;"} {
			t.Run(provider+"/"+body, func(t *testing.T) {
				file, _ := ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, "effect function main(){ return do { 19; provide "+provider+" { "+body+" } } }")
				markers := 0
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					if n.Kind == ast.KindExpressionStatement && n.Flags&ast.NodeFlagsVibeLang != 0 {
						markers++
						if ast.IsBinaryExpression(n.Expression()) && n.Expression().AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken {
							t.Error("generated provider marker overwrote do completion")
						}
					}
					return n.ForEachChild(visit)
				}
				visit(file.AsNode())
				if markers == 0 {
					t.Fatal("missing provider marker")
				}
			})
		}
	}
}
