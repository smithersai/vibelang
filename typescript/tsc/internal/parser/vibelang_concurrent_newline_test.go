package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

func TestVibeLangConcurrentLineBreaks(t *testing.T) {
	for _, gap := range []string{"\n", " // comment\n", " /* comment\n */ "} {
		for _, head := range []string{"(const x of xs)", "(2)\n(const x of xs)"} {
			source := "effect function f() { for\nconcurrent" + gap + head + " { use(x) } }"
			t.Run(gap+head, func(t *testing.T) {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				if len(file.Diagnostics()) != 0 {
					t.Fatalf("valid concurrent loop rejected: %v", file.Diagnostics())
				}
			})
		}
	}
}
