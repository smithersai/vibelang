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
		"const data = <T>(x: T) => x; data\n<number>(1)",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Fatalf("contextual data expression rejected: %v\n%s", ds, source)
		}
	}
}

// Appendix A gives a same-line data/name pair declaration precedence even
// when the name is an assertion keyword. Parentheses retain the expression.
func TestVibeLangDataAssertionNewlineBoundary(t *testing.T) {
	for _, op := range []string{"as", "satisfies"} {
		for i, gap := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029", " /*\n*/ ", " // type\n"} {
			t.Run(fmt.Sprintf("%s/%d", op, i), func(t *testing.T) {
				parse := func(source string) *ast.SourceFile {
					return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				}
				prefix := "const data = 1; "
				file := parse(prefix + "data " + op + gap + "number")
				if ds := file.Diagnostics(); len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != parser.VibeLangDataMissingBodyCode {
					t.Fatalf("statement-start header must report only EK1604: %v", ds)
				}
				for _, source := range []string{
					prefix + "(data " + op + gap + "number)",
					prefix + "const value = data " + op + gap + "number",
					prefix + "function read() { return data " + op + gap + "number }",
					"data " + op + gap + "{ Value }",
				} {
					if ds := parse(source).Diagnostics(); len(ds) != 0 {
						t.Fatalf("valid expression or declaration rejected: %v\n%s", ds, source)
					}
				}
			})
		}
	}
}
