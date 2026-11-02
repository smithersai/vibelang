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
				// Spec 002 and Appendix B: an unparenthesized fork or join head on
				// the left of ** is EK0510, as ECMAScript rejects await there.
				if len(items) != 1 || items[0].Code() != parser.VibeLangExecutionPowerCode || items[0].Source() != "EK" {
					t.Fatalf("unparenthesized execution before ** needs EK0510: %v", items)
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
