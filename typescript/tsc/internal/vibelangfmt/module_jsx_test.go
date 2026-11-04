package vibelangfmt_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

func TestFormatJSXModuleBodies(t *testing.T) {
	for _, name := range []string{"host", ""} {
		for _, expression := range []string{"<div />", "<><span>{() => 1}</span></>"} {
			source := "module " + name + " { export const view = " + expression + " }\nexport const kept = 1\n"
			formatter := func(text string) (string, error) {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/format.tsx", PathKey: "/format.tsx"}, text, core.ScriptKindTSX)
				if len(file.Diagnostics()) != 0 {
					t.Fatalf("invalid native TSX projection: %v\n%s", file.Diagnostics(), text)
				}
				return text, nil
			}
			result, err := vibelangfmt.Format("view.vibex", source, formatter)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(result, expression) {
				t.Fatalf("lost JSX: %s", result)
			}
			twice, err := vibelangfmt.Format("view.vibex", result, formatter)
			if err != nil || twice != result {
				t.Fatalf("format not idempotent: %v", err)
			}
		}
	}
}

func TestFormatJSXModuleBodyGuard(t *testing.T) {
	source := "module host { export const view = <div /> }\n"
	if _, err := vibelangfmt.Format("view.vibex", source, func(text string) (string, error) {
		return strings.ReplaceAll(text, "<div />", "<span />"), nil
	}); err == nil {
		t.Fatal("accepted a changed JSX module body")
	}
}
