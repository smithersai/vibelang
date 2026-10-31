package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-7 and detail78: tested and/not arms cannot close a finite subject.
// Default arms retain ordinary narrowing; binding-only and is a separate
// recorded spec question and is deliberately outside this regression.
func TestMatchAndNotCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, arms string
		want       bool
	}{
		{"and", "when true and true: 1; when false: 0;", true},
		{"not", "when not false: 1; when false: 0;", true},
		{"nested-and", "when true and (true or false): 1; when false: 0;", true},
		{"nested-not", "when not (false): 1; when false: 0;", true},
		{"and-default", "when true and true: 1; default: 0;", false},
		{"not-default", "when not false: 1; default: 0;", false},
		{"ordinary", "when true: 1; when false: 0;", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export function f(x: boolean): number { return match(x) { " + tc.arms + " } }"
			program, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == "EK" && d.Code() == 4701 {
					found = true
					continue
				}
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
			if found != tc.want {
				t.Fatalf("EK4701 = %t, want %t", found, tc.want)
			}
		})
	}
	t.Run("native redundant comparison", func(t *testing.T) {
		program, file, _, _ := editorProgram(t, "export function native(x:boolean):number { if (x === true && (x === true || x === false)) return 1; return 0; }")
		count := 0
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				if d.Code() != 2367 {
					t.Errorf("unexpected native error: %s", d.String())
				}
				count++
			}
		}
		if count != 0 {
			t.Fatalf("native comparison: got %d errors, want none", count)
		}
	})

}
