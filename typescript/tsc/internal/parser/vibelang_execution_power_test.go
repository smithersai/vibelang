package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestVibeLangExecutionPowerDiagnostic(t *testing.T) {
	for _, op := range []string{"try", "fork", "join"} {
		for _, operand := range []string{"value", "make()", "holder.value"} {
			t.Run(op+"/"+operand, func(t *testing.T) {
				text := "effect function run() { return " + op + " " + operand + " ** 2 }"
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, text, core.ScriptKindTS)
				ds := file.Diagnostics()
				if len(ds) != 1 || ds[0].Code() != 510 || ds[0].Source() != "EK" {
					t.Fatalf("want one EK0510, got %v", ds)
				}
				span := text[ds[0].Pos():ds[0].End()]
				if span != op+" "+operand {
					t.Fatalf("span %q, want execution expression", span)
				}
			})
		}
	}
	for _, source := range []string{
		"effect function run() { return (try value) ** 2 }",
		"effect function run() { return (fork value) ** 2 }",
		"effect function run() { return (join value) ** 2 }",
		"effect function run() { return 2 ** try value }",
		"effect function run() { return 2 ** join value }",
		"effect function run() { return try value * 2 }",
		"effect function run() { return join value + 2 }",
	} {
		t.Run("control/"+source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			if ds := file.Diagnostics(); len(ds) > 0 {
				t.Fatalf("valid syntax: %v", ds)
			}
		})
	}
	for i, source := range []string{"const x = -value ** 2", "const x = typeof value ** 2", "async function run() { return await value ** 2 }"} {
		for _, name := range []string{"/native.ts", "/native.vibe"} {
			t.Run(fmt.Sprintf("native/%d/%s", i, name), func(t *testing.T) {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source, core.ScriptKindTS)
				ds := file.Diagnostics()
				if len(ds) != 1 || ds[0].Code() != 17006 || strings.Contains(ds[0].Source(), "EK") {
					t.Fatalf("native diagnostic changed: %v", ds)
				}
			})
		}
	}
}
