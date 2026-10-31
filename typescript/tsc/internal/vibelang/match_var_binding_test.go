package vibelang

import (
	"context"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"strings"
	"testing"
)

func TestMatchVarBindingDiagnostic(t *testing.T) {
	patterns := []struct{ name, subject, pattern string }{
		{"bare", "7", "var value"},
		{"object", "({ id: 7 })", "{ id: var value }"},
		{"object-shorthand", "({ value: 7 })", "{ var value }"},
		{"array", "[7]", "[var value]"},
		{"nested", "({ items: [7] })", "{ items: [var value] }"},
		{"extractor", "7", "Number(var value)"},
	}
	for _, p := range patterns {
		for _, form := range []string{"match", "is-if", "is-return", "is-arrow"} {
			for _, binding := range []string{"var", "let", "const"} {
				t.Run(p.name+"/"+form+"/"+binding, func(t *testing.T) {
					pattern := strings.ReplaceAll(p.pattern, "var ", binding+" ")
					var source string
					switch form {
					case "match":
						source = fmt.Sprintf("export function f(): unknown { return match (%s) { when %s: value; default: 0; } }", p.subject, pattern)
					case "is-if":
						source = fmt.Sprintf("export function f(): unknown { if (%s is %s) return value; return 0 }", p.subject, pattern)
					case "is-return":
						source = fmt.Sprintf("export function f(): boolean { return %s is %s }", p.subject, pattern)
					case "is-arrow":
						source = fmt.Sprintf("export const f = (): boolean => %s is %s", p.subject, pattern)
					}
					program, file, _, _ := editorProgram(t, source)
					ds := program.GetSemanticDiagnostics(context.Background(), file)
					found := 0
					for _, d := range ds {
						if d.Code() == 107 {
							found++
						} else {
							t.Errorf("unexpected diagnostic: %s", d.String())
						}
					}
					want := 0
					if binding == "var" {
						want = 1
					}
					if found != want {
						t.Errorf("EK0107 count = %d, want %d", found, want)
					}
				})
			}
		}
	}
}

func TestMatchVarBindingQuickFix(t *testing.T) {
	for _, source := range []string{
		"export function f(): unknown { return match (7) { when var value: value; } }",
		"export function f(): unknown { if ([7] is [var value]) return value; return 0 }",
		"export function f(): unknown { if (({ value: 7 }) is { /*keep*/ var value }) return value; return 0 }",
		"export const f = (): boolean => 7 is Number(var value)",
	} {
		got := applyQuickFixOf(t, source, EK0107.Code, diagnostics.CategoryError)
		want := strings.Replace(source, "var value", "let value", 1)
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
		if ds := errorsOf(t, got); len(ds) != 0 {
			t.Fatalf("fixed source: %v", ds)
		}
	}
}

func TestMatchVarBindingFixProject(t *testing.T) {
	for _, options := range []FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}} {
		source := "export function f(): unknown { if (({value:7}) is { /*keep*/ var value }) return value; return 0 }"
		program, file, _, _ := editorProgram(t, source)
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
		if len(result.Refused) != 0 || len(result.Files) != 1 {
			t.Fatalf("fix result: %+v", result)
		}
		fixed := result.Files[file.FileName()]
		want := strings.Replace(source, "var value", "let value", 1)
		if fixed.Text != want || fixed.Counts[107] != 1 {
			t.Fatalf("fix: %+v, want %s", fixed, want)
		}
		if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
		second := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
		if len(second.Files) != 0 || len(second.Refused) != 0 {
			t.Fatalf("second fix changed the project: %+v", second)
		}
	}
}

func TestMatchVarBindingFixLeavesOrdinaryVar(t *testing.T) {
	source := "export function f(): number { var value=7; return value }"
	program, _, _, _ := editorProgram(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
	if len(result.Files) != 0 {
		t.Fatalf("pattern repair changed ordinary var: %+v", result)
	}
}

func TestMatchVarBindingIrrefutableRecovery(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export function f(subject:boolean):unknown { return match (subject) { when var value: value; } }")
	ds := program.GetSemanticDiagnostics(t.Context(), file)
	found := 0
	for _, d := range ds {
		if d.Code() == 107 {
			found++
		} else {
			t.Errorf("unexpected diagnostic: %s", d.String())
		}
	}
	if found != 1 {
		t.Fatalf("EK0107 count=%d, want 1", found)
	}
}
