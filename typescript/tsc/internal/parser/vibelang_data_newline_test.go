package parser_test

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-16: only DataStart's data/name boundary forbids LineTerminator.
func TestVibeLangDataTypeParameterNewline(t *testing.T) {
	for _, prefix := range []string{"", "export ", "namespace N { export "} {
		for i, trivia := range []string{" ", "\n", "\r\n", "\r", "\u2028", "\u2029", " /*\n*/ ", " // parameters\n"} {
			t.Run(fmt.Sprintf("%s/%d", prefix, i), func(t *testing.T) {
				source := prefix + "data Name" + trivia + "<T>" + trivia + "{ Ok { value: T } }"
				if prefix == "namespace N { export " {
					source += " }"
				}
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				if ds := file.Diagnostics(); len(ds) != 0 {
					t.Fatalf("data generic declaration rejected: %v\n%s", ds, source)
				}
			})
		}
	}
}

func TestVibeLangDataContextualNewlineControls(t *testing.T) {
	for _, source := range []string{
		"const data = 1; data\n{ const Name = 2 }",
		"const data = 1; data as\nnumber",
		"const data = 1; data satisfies\nnumber",
		"const data = <T>(x: T) => x; data\n<number>(1)",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Fatalf("contextual data expression rejected: %v\n%s", ds, source)
		}
	}
}
