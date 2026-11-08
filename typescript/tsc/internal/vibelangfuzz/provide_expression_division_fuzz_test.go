package vibelangfuzz

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const provideExpressionDivisionQuote = "Calls without that body and expressions after `return` keep their TypeScript readings."

func provideExpressionDivisionQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), provideExpressionDivisionQuote) {
		t.Fatalf("chapter 5 no longer says %q", provideExpressionDivisionQuote)
	}
}

func TestProvideExpressionDivisionQuoted(t *testing.T) { provideExpressionDivisionQuoted(t) }

// Mutate expression context, slash operator, property spelling and trivia.
// The oracle compares with native TypeScript parsing of the exact same source;
// statement-start regex providers are tested separately by the compiler cases.
func FuzzProvideExpressionDivision(f *testing.F) {
	startShortBudget(f)
	provideExpressionDivisionQuoted(f)
	keys := []string{"return", "array", "argument", "property", "arrow", "conditional", "assignment"}
	for _, key := range keys {
		for _, data := range [][]byte{{0}, {1}, {2}, {3}, {255}} {
			f.Add(key, data)
		}
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		choose := func(i int) byte {
			if len(data) == 0 {
				return 0
			}
			return data[i%len(data)]
		}
		known := false
		for _, candidate := range keys {
			if candidate == key {
				known = true
				break
			}
		}
		if !known {
			key = keys[int(choose(0))%len(keys)]
		}
		op := []string{"/", "/="}[choose(1)%2]
		space := []string{" ", " /* comment */ ", "\n", "\r\n"}[choose(2)%4]
		property := []string{"value", "n", "amount"}[choose(3)%3]
		expr := "provide" + space + op + " a / { " + property + ": 2 }." + property
		switch key {
		case "array":
			expr = "[" + expr + "]"
		case "argument":
			expr = "id(" + expr + ")"
		case "property":
			expr = "({value:" + expr + "})"
		case "arrow":
			expr = "(() => " + expr + ")"
		case "conditional":
			expr = "flag ? " + expr + " : 0"
		case "assignment":
			expr = "out = " + expr
		}
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
			Gap(t, "FuzzProvideExpressionDivision", key, "expression AST disagrees with native TypeScript for operator %q and trivia %q", op, space)
		}
		if len(vibe.Diagnostics()) != 0 || len(twin.Diagnostics()) != 0 {
			Gap(t, "FuzzProvideExpressionDivision", key, "unexpected parse diagnostics: %v; %v", vibe.Diagnostics(), twin.Diagnostics())
		}
	})
}
