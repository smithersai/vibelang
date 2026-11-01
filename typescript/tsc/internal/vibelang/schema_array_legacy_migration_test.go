package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestSchemaGenericArrayLegacyProjectScope(t *testing.T) {
	for _, tc := range []struct {
		name, source, want string
		changed            bool
	}{
		{"mutable legacy", "export namespace N { export import Array=globalThis.ReadonlyArray; export schema S=Array<number>; export function append(s:S):number {return s.push(1)} }", "const S = Schema.mutable(Schema.Array(Schema.Number));", true},
		{"readonly legacy", "export namespace N { export import ReadonlyArray=globalThis.Array; export schema S=ReadonlyArray<number> }", "const S = Schema.Array(Schema.Number);", true},
		{"ordinary library", "export schema S=Array<number>", "", false},
		{"new qualified form", "export schema S=globalThis.Array<number>", "", false},
		{"mixed new form", "namespace N { export import Array=globalThis.ReadonlyArray; export schema S { old:Array<number>; added:globalThis.Array<number> } }", "", false},
	} {
		for _, compatibility := range []bool{false, true} {
			t.Run(tc.name+map[bool]string{false: " ordinary", true: " compatibility"}[compatibility], func(t *testing.T) {
				program, file, _, _ := editorProgram(t, tc.source)
				fs := bundled.WrapFS(osvfs.FS())
				options := FixOptions{MigrationOnly: compatibility}
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), program.CommandLine(), options)
				if len(result.Refused) != 0 {
					t.Fatalf("refused: %+v", result.Refused)
				}
				fixed := result.Files[file.FileName()]
				if !compatibility || !tc.changed {
					if fixed != nil {
						t.Fatalf("unexpected rewrite: %s", fixed.Text)
					}
					return
				}
				if fixed == nil || !strings.Contains(fixed.Text, tc.want) {
					t.Fatalf("missing legacy codec %q: %+v", tc.want, fixed)
				}
				checked, next, _, _ := editorProgram(t, fixed.Text)
				for _, d := range checked.GetSemanticDiagnostics(t.Context(), next) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("invalid migration: %s\n%s", d.String(), fixed.Text)
					}
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				for _, againOptions := range []FixOptions{options, {}} {
					again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), program.CommandLine(), againOptions)
					if len(again.Files) != 0 || len(again.Refused) != 0 {
						t.Fatalf("migration not stable: %+v", again)
					}
				}
			})
		}
	}
}

func TestSchemaGenericArrayLegacyShadowFix(t *testing.T) {
	source := "type Array<T>={value:T}; schema S=Array<number>; function f(s:S){s.push(1)}"
	fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
	program, file, _, _ := editorProgram(t, fixed)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("legacy fix: %s\n%s", d.String(), fixed)
		}
	}
}
