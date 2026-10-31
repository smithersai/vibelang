package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestProvideCommaLineBreak(t *testing.T) {
	for _, test := range []struct {
		name, head string
		invalid    bool
	}{
		{"before separator", "Layer.empty\n, Layer.empty", true},
		{"CRLF", "Layer.empty,\r\nLayer.empty", true},
		{"line separator", "Layer.empty,\u2028Layer.empty", true},
		{"paragraph separator", "Layer.empty,\u2029Layer.empty", true},
		{"single parenthesized expression", "(Layer.empty,\nLayer.empty)", false},
		{"separator", "Layer.empty,\nLayer.empty", true},
		{"separator comment", "Layer.empty, /*\ncomment */ Layer.empty", true},
		{"inside call", "Layer.mergeAll(\nLayer.empty,\nLayer.empty\n), Layer.empty", false},
		{"inside parentheses", "(Layer.empty,\nLayer.empty), Layer.empty", false},
		{"same line", "Layer.empty, Layer.empty", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, "effect function f() { provide "+test.head+" {} }")
			count := 0
			for _, d := range file.Diagnostics() {
				if d.Source() != "EK" || d.Code() != 1202 {
					t.Fatalf("unexpected diagnostic: %s", d.String())
				}
				count++
			}
			got := count == 1
			if got != test.invalid {
				t.Fatalf("parse diagnostics = %v; want error %v", file.Diagnostics(), test.invalid)
			}
		})
	}
}
