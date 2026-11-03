package vibelangfmt_test

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/format"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

func TestFormatUnnamedModule(t *testing.T) {
	ctx := format.WithFormatCodeSettings(context.Background(), lsutil.GetDefaultFormatCodeSettings(), "\n")
	formatter := func(text string) (string, error) {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/format.ts", PathKey: "/format.ts"}, text, core.ScriptKindTS)
		if len(file.Diagnostics()) != 0 {
			t.Fatalf("invalid projection: %v\n%s", file.Diagnostics(), text)
		}
		return core.ApplyBulkEdits(text, format.FormatDocument(ctx, file)), nil
	}
	for _, source := range []string{
		"module { export function clean(): string { return \"\" } }\nexport function main() {}",
		"module{}\nexport function main( ){return 1}",
		"module /* name missing */ { /* body */ export const value=1 }\n",
		"module { export const value=1 }\nmodule { export const value=2 }\n",
		"module named { export const value=1 }\nmodule { export const value=2 }\n",
		"/** module docs */\nmodule {\r\n export const value={x:1}\r\n}\r\n",
	} {
		t.Run(source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("witness must be syntax-error-free: %v", file.Diagnostics())
			}
			once, err := vibelangfmt.Format("main.vibe", source, formatter)
			if err != nil {
				t.Fatal(err)
			}
			if err := vibelangfmt.SameProgram(source, once); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(source, "name missing") && !strings.Contains(once, "name missing") {
				t.Fatal("lost head comment")
			}
			twice, err := vibelangfmt.Format("main.vibe", once, formatter)
			if err != nil || once != twice {
				t.Fatalf("not idempotent: %v\n%s\n%s", err, once, twice)
			}
		})
	}
}

func TestFormatUnnamedModuleBodyGuard(t *testing.T) {
	source := "module { export const value = 1 }\n"
	if err := vibelangfmt.SameProgram(";;;"+source, source); err != nil {
		t.Fatalf("harmless empty statements changed the recovered body pairing: %v", err)
	}
	changed := strings.Replace(source, "= 1", "= 2", 1)
	if err := vibelangfmt.SameProgram(source, changed); err == nil {
		t.Fatal("lost recovered module body change")
	}
	if _, err := vibelangfmt.Format("main.vibe", source, func(text string) (string, error) { return strings.ReplaceAll(text, "= 1", "= 2"), nil }); err == nil {
		t.Fatal("accepted changed module body")
	}
}

func TestFormatUnnamedModuleSyntaxErrors(t *testing.T) {
	for _, source := range []string{"module { export const value = ( }", "module { export const value = 1"} {
		if _, err := vibelangfmt.Format("main.vibe", source, func(text string) (string, error) { return text, nil }); err == nil {
			t.Fatalf("accepted syntax error: %s", source)
		}
	}
}
