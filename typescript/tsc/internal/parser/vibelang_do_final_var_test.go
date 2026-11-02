package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-2's pinned EndsInIterationOrBareIfOrDeclaration groups VariableStatement
// with declarations and returns isLast. Empty suffixes cannot hide a final var;
// a later expression still permits the enclosing activation's var binding.
func TestVibeLangDoFinalVarEarlyErrors(t *testing.T) {
	contexts := []struct{ name, prefix, suffix string }{
		{"plain", "function f() { return do { ", " } }"},
		{"effect", "effect function f() { return do { ", " } }"},
		{"arrow", "const f = () => do { ", " }"},
		{"async", "async function f() { return do { ", " } }"},
	}
	variants := []struct {
		name, body string
		bad        bool
	}{
		{"final", "var n = 1", true},
		{"empty-statement", "var n = 1; ;", true},
		{"empty-block", "var n = 1; {}", true},
		{"nested", "{ var n = 1 }", true},
		{"nested-empty", "{ var n = 1; {} }", true},
		{"then-value", "var n = 1; n", false},
		{"then-value-empty", "var n = 1; n; {}; ;", false},
		{"nested-then-value", "{ var n = 1; n }", false},
	}
	for _, context := range contexts {
		for _, variant := range variants {
			t.Run(context.name+"/"+variant.name, func(t *testing.T) {
				text := context.prefix + variant.body + context.suffix
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, text, core.ScriptKindTS)
				items := file.Diagnostics()
				if !variant.bad {
					if len(items) != 0 {
						t.Fatalf("nonfinal var rejected: %v\n%s", items, text)
					}
					return
				}
				if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != parser.DoEndsCode {
					t.Fatalf("want exactly one EK0201 for final var, got %v\n%s", items, text)
				}
				if !strings.HasPrefix(text[items[0].Pos():], "var ") {
					t.Fatalf("EK0201 should name var, got %q", text[items[0].Pos():items[0].End()])
				}
			})
		}
	}
	t.Run("parameter-still-rejects-nonfinal-var", func(t *testing.T) {
		text := "function f(value = do { var n = 1; n }) {}"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, text, core.ScriptKindTS)
		items := file.Diagnostics()
		if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != parser.DoParameterVarCode {
			t.Fatal(fmt.Sprintf("want one EK0203, got %v", items))
		}
	})
}
