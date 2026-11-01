package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// The completion assignment around $noMatch must preserve both the coverage
// proof and the checked final arm. A guarded binding is still refutable.
func TestDoMatchFallbackCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, last string
		missing    bool
	}{
		{"binding", "when let rest: do { if (rest === 1) return 'one'; 'other' };", false},
		{"guarded", "when let rest and if (allow): do { if (rest === 1) return 'one'; 'other' };", true},
		{"finite", "when 1: do { 'one' };", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export const f = (n: 0 | 1, allow: boolean): string => match (n) { when 0: 'zero'; " + tc.last + " }"
			p, f, _, _ := editorProgram(t, source)
			missing := false
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Code() == EK4701.Code {
					missing = true
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("%s", d.String())
				}
			}
			if missing != tc.missing {
				t.Fatalf("missing-case diagnostic = %v, want %v", missing, tc.missing)
			}
			text := ""
			for _, js := range emittedJS(t, p) {
				text += js
			}
			if strings.Contains(text, "$noMatch") != tc.missing {
				t.Errorf("incorrect no-match lowering: %s", text)
			}
			if tc.name == "finite" && !strings.Contains(text, "$assertMatch") {
				t.Errorf("finite final arm lost its runtime check: %s", text)
			}
		})
	}
}
