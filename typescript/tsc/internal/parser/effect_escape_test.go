package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestEffectEscapedKeyword(t *testing.T) {
	forms := []string{
		"WORD function load() { return 1 }",
		"const load = WORD function () { return 1 }",
		"const load = WORD () => 1",
		"const load = WORD x => x",
		"const load = WORD <T>(x: T) => x",
		"class C { WORD load() { return 1 } }",
		"const c = { WORD load() { return 1 } }",
		"const load = WORD { return 1 }",
	}
	for _, word := range []string{`\u0065ffect`, `eff\u0065ct`, `\u{65}ffect`} {
		for _, form := range forms {
			source := strings.Replace(form, "WORD", word, 1)
			t.Run(source, func(t *testing.T) {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
				items := file.Diagnostics()
				if len(items) != 1 || items[0].Code() != 1260 {
					t.Fatalf("escaped effect keyword: got %v; want exactly TS1260", items)
				}
				start := strings.Index(source, word)
				if items[0].Pos() != start || items[0].End() != start+len(word) {
					t.Fatalf("diagnostic range %d:%d; want %d:%d", items[0].Pos(), items[0].End(), start, start+len(word))
				}
			})
		}
	}
	for _, source := range []string{
		`const \u0065ffect = 1`,
		`\u0065ffect()`,
		`const x = \u0065ffect as unknown`,
		`class C { \u0065ffect() { return 1 } }`,
		`const c = { \u0065ffect() { return 1 } }`,
		`class C { [\u0065ffect]() { return 1 } }`,
		"\\u0065ffect\nfunction load() { return 1 }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
			if items := file.Diagnostics(); len(items) != 0 {
				t.Fatalf("ordinary escaped identifier rejected: %v", items)
			}
		})
	}
}
