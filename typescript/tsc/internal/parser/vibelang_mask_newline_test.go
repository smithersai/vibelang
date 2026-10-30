package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-22: "These are contextual keywords followed by `{` on the same line."
func TestVibeLangMaskNewlineIdentifier(t *testing.T) {
	for _, name := range []string{"uninterruptible", "interruptible", "restore"} {
		for _, newline := range []string{"\n", "\r\n", " /*\n*/ "} {
			t.Run(name+newline, func(t *testing.T) {
				source := "const " + name + "=1;export function probe(){" + name + newline + "{let x=2};return " + name + "}"
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
					t.Fatalf("contextual identifier before a separate block rejected: %v", diagnostics)
				}
			})
		}
	}
}
