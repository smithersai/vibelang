package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangFiberUnaryExponentiation(t *testing.T) {
	for _, operator := range []string{"fork", "join"} {
		for _, expression := range []string{
			operator + " task ** 2",
			operator + " task ** 2 ** 3",
			"2 ** " + operator + " task ** 2",
		} {
			t.Run("reject/"+expression, func(t *testing.T) {
				source := "effect function f() { return " + expression + " }"
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				items := file.Diagnostics()
				if len(items) != 1 || items[0].Code() != 17006 {
					t.Fatalf("unparenthesized unary exponentiation needs TS17006: %v", items)
				}
			})
		}
		for _, expression := range []string{
			"(" + operator + " task) ** 2",
			"2 ** " + operator + " task",
			operator + " task + 2",
		} {
			t.Run("accept/"+expression, func(t *testing.T) {
				source := "effect function f() { return " + expression + " }"
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				if len(file.Diagnostics()) != 0 {
					t.Fatalf("valid unary placement rejected: %v", file.Diagnostics())
				}
			})
		}
	}
}
