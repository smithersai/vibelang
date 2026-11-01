package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
	"strings"
	"testing"
)

func TestFormatIdenticalEmitQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "diagnostic codes, categories and occurrences") {
		t.Fatal("chapter 007 formatter diagnostic-preservation contract")
	}
}

func TestToolsFormatIdenticalInvalidEmit(t *testing.T) {
	diagnostic := ast.NewDiagnosticFromText(nil, core.TextRange{}, 1007, diagnostics.CategoryError, "placeholder outside pipe", nil, nil, false, false)
	for _, name := range []string{"out/main.js", "out/main.d.ts"} {
		t.Run(name, func(t *testing.T) {
			before := &Result{Outputs: map[string]string{name: "export const result = %;"}, Diagnostics: []*ast.Diagnostic{diagnostic}}
			after := &Result{Outputs: map[string]string{name: "export const result = %;"}, Diagnostics: []*ast.Diagnostic{diagnostic}}
			if difference := toolsFormatDifference(before, after); difference != "" {
				t.Fatalf("identical emit must preserve meaning: %s", difference)
			}
			after.Diagnostics = nil
			if toolsFormatDifference(before, after) == "" {
				t.Fatal("lost diagnostic escaped comparison")
			}
			after.Diagnostics = before.Diagnostics
			after.Outputs[name] = "export const result = 1;"
			if toolsFormatDifference(before, after) == "" {
				t.Fatal("changed malformed output escaped comparison")
			}
			delete(after.Outputs, name)
			if toolsFormatDifference(before, after) == "" {
				t.Fatal("missing emitted file escaped comparison")
			}
		})
	}
}

func TestToolsFormatInvalidEmitWitness(t *testing.T) {
	w := NewWorkspace(t)
	formatter := toolsFormatter(t)
	for _, source := range []string{
		"export function half(n: number) {\n  return % / 2\n}\n",
		"export function quarter(n: number) {\n  return % / 4\n}\n",
		"export const label = \"keep\";\nexport function half(n: number) {\n  return % / 2\n}\n",
	} {
		once, err := vibelangfmt.Format("main.vibe", source, formatter)
		if err != nil {
			t.Fatal(err)
		}
		before, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		after := toolsRecompile(t, w, before, Single(once).Files)
		found := false
		for _, d := range before.Diagnostics {
			found = found || d.Code() == 1007 && d.Source() == "EK" && d.Category() == diagnostics.CategoryError
		}
		if !found {
			t.Fatalf("witness must report EK1007: %v", before.Diagnostics)
		}
		if before.Outputs["out/main.js"] != after.Outputs["out/main.js"] {
			t.Fatalf("expected byte-identical emit:\n%s\n---\n%s", before.Outputs["out/main.js"], after.Outputs["out/main.js"])
		}
		if difference := toolsFormatDifference(before, after); difference != "" {
			t.Fatalf("%s\n%s", difference, source)
		}
	}
}
