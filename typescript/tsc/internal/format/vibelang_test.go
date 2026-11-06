package format

import (
	"context"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// This golden is also the dprint output for the same source with indentWidth 2.
func TestFormatVibeLangMatch(t *testing.T) {
	source := "error Timeout\nexport function h(e: Timeout) {\nreturn match (e) {\nwhen Timeout: \"same\";\n}\n}\n"
	want := "error Timeout\nexport function h(e: Timeout) {\n  return match (e) {\n    when Timeout: \"same\";\n  }\n}\n"
	options := lsutil.GetDefaultFormatCodeSettings()
	options.IndentSize = 2
	options.TabSize = 2
	options.ConvertTabsToSpaces = core.TSTrue
	ctx := WithFormatCodeSettings(context.Background(), options, "\n")
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/match.vibe", PathKey: "/match.vibe"}, source, core.ScriptKindTS)
	got := core.ApplyBulkEdits(source, FormatDocument(ctx, file))
	if got != want {
		t.Fatalf("formatting differs\nwant:\n%s\ngot:\n%s", want, got)
	}
	file = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/match.vibe", PathKey: "/match.vibe"}, got, core.ScriptKindTS)
	if changes := FormatDocument(ctx, file); len(changes) != 0 {
		t.Fatalf("formatting is not idempotent: %v", changes)
	}
}

func TestFormatVibeLangDirective(t *testing.T) {
	for _, ext := range []string{"ts", "mts", "cts", "tsx"} {
		t.Run(ext, func(t *testing.T) {
			source := "// @vibe\nexport   const n = 1\n"
			want := "// @vibe\nexport const n = 1\n"
			options := lsutil.GetDefaultFormatCodeSettings()
			ctx := WithFormatCodeSettings(context.Background(), options, "\n")
			name := "/main." + ext
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source, core.GetScriptKindFromFileName(tspath.RootedFilePath(name)))
			got := core.ApplyBulkEdits(source, FormatDocument(ctx, file))
			if got != want {
				t.Fatalf("formatting differs\nwant:\n%s\ngot:\n%s", want, got)
			}
		})
	}
}
