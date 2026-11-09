package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Appendix A, Declaration keywords: a bodyless error or schema error ends as
// a TypeScript statement does, so `error as T;` is a syntax error.
func TestVibeLangBodylessErrorNeedsStatementEnd(t *testing.T) {
	for source, at := range map[string]string{
		"error E effect { id: string }":                        "effect",
		"schema error E effect { id: string }":                 "effect",
		"error Missing 1":                                      "1",
		"export error E 1":                                     "1",
		"export error async async":                             "async\x00",
		"export error value from":                              "from",
		"error Timeout const t = 1":                            "const",
		"schema error S x":                                     "x",
		"declare const error: unknown\nerror as Error;":        "Error;",
		"declare const error: unknown\nerror satisfies Error;": "Error;",
		"error Gone extends Base Other":                        "Other",
		"export error Gone extends Error Error ?? { a: 1 }":    "Error ??",
		"error Gone implements Shape Other":                    "Other",
		"function f() { error Missing 1 }":                     "1",
		"error Missing /* same line */ next":                   "next",
		"error A error B":                                      "error B",
		"function x ( ) { for\n( x of [ ] ) error x x }":       "x }",
		"/ /\nerror concurrent not":                            "not",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			want := strings.LastIndex(source+"\x00", at)
			for _, d := range file.Diagnostics() {
				if d.Code() == diagnostics.X_0_expected.Code() && d.Pos() == want && strings.Contains(d.String(), "';' expected") {
					return
				}
			}
			t.Fatalf("want \"';' expected\" at offset %d, got %v", want, file.Diagnostics())
		})
	}
}

func TestVibeLangBodylessErrorStatementEnds(t *testing.T) {
	for _, source := range []string{
		"error Missing",
		"error Missing;",
		"error Missing; const t = 1",
		"error Missing\nconst t = 1",
		"error Missing // done\nconst t = 1",
		"error Missing /* done */\nconst t = 1",
		"function f() { error Missing }",
		"schema error Missing\nschema error Other",
		"export error A\nexport schema error B",
		"error Missing { id: string } const t = 1",
		"schema error Missing { } const t = 1",
		"error Missing\n{ id: string }",
		"const error = 1; const e = error as number",
		"declare const error: unknown\n(error as Error);",
		"declare const error: unknown\nerror instanceof Error;",
		"declare const error: unknown\nerror\nMissing",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("valid source rejected: %v", file.Diagnostics())
			}
		})
	}
}
