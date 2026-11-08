package parser_test

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestProvidePostfixExpressionKeepsNativeParse(t *testing.T) {
	for _, postfix := range []string{"++", "--", "!", "<number>"} {
		for _, context := range []string{"return %s", "const value = %s; return value", "return [%s]", "return id(%s)", "return (() => %s)"} {
			t.Run(postfix+"/"+context, func(t *testing.T) {
				expression := "provide" + postfix + " / scale / {value:2}.value"
				source := "function f(provide: number, scale: number) { " + fmt.Sprintf(context, expression) + " }"
				vibe := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				twin := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, source, core.ScriptKindTS)
				shape := func(file *ast.SourceFile) []string {
					var nodes []string
					var visit func(*ast.Node) bool
					visit = func(n *ast.Node) bool {
						nodes = append(nodes, fmt.Sprintf("%v:%d:%d", n.Kind, n.Pos(), n.End()))
						n.ForEachChild(visit)
						return false
					}
					file.AsNode().ForEachChild(visit)
					return nodes
				}
				if !reflect.DeepEqual(shape(vibe), shape(twin)) {
					t.Fatalf("postfix expression differs from native TypeScript:\n%v\n%v", shape(vibe), shape(twin))
				}
				if len(vibe.Diagnostics()) != 0 || len(twin.Diagnostics()) != 0 {
					t.Fatalf("unexpected parse diagnostics: %v; %v", vibe.Diagnostics(), twin.Diagnostics())
				}
			})
		}
	}
}
