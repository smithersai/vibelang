package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangNestedFiberPrefix(t *testing.T) {
	for _, expression := range []string{
		"join fork task",
		"! join child",
		"typeof fork task",
		"void join child",
		"+ join child",
		"join (fork task)",
		"fork work(try id())",
	} {
		t.Run(expression, func(t *testing.T) {
			source := "effect function f() { return " + expression + " }"
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("valid unary expression rejected: %v", file.Diagnostics())
			}
		})
	}
}
