package parser_test

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestProvideExpressionDivisionKeepsNativeParse(t *testing.T) {
	for _, op := range []string{"/", "/="} {
		for _, expression := range []string{
			"provide OP a / { value: 2 }.value",
			"[provide OP a / { value: 2 }.value]",
			"f(provide OP a / { value: 2 }.value)",
			"({ value: provide OP a / { value: 2 }.value })",
			"(() => provide OP a / { value: 2 }.value)",
			"true ? provide OP a / { value: 2 }.value : 0",
		} {
			t.Run(op+"/"+expression, func(t *testing.T) {
				expr := strings.ReplaceAll(expression, "OP", op)
				source := "function f(provide: number, a: number) { return " + expr + " }"
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
					t.Fatalf("native expression parse changed:\n%v\n%v", shape(vibe), shape(twin))
				}
				if len(vibe.Diagnostics()) != 0 || len(twin.Diagnostics()) != 0 {
					t.Fatalf("unexpected parse diagnostics: %v; %v", vibe.Diagnostics(), twin.Diagnostics())
				}
			})
		}
	}
}
