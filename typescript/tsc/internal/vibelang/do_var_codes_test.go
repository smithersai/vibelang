package vibelang

import (
	"fmt"
	"slices"
	"testing"
)

// A var declaration rejected by a do early error gets that specific code, not
// also the legacy-JavaScript EK0107. The editor reports syntactic and semantic
// diagnostics together, so the replacement must hold across both sets.
// Appendix B: EK0107 — spec-rule: docs/design/src/900-appendices.md#06205907fbf4ee7b
// Appendix B: EK0201 — spec-rule: docs/design/src/900-appendices.md#b31d93209e7197d7
// Appendix B: EK0203 — spec-rule: docs/design/src/900-appendices.md#5cb0a94c500f88d3
func TestDoVarEarlyErrorsReplaceEK0107(t *testing.T) {
	for _, test := range []struct {
		name, source string
		codes        []string
	}{
		{"final-var", "export function f() { return do { var y = 1 } }", []string{"EK0201"}},
		{"final-var-nested", "export function f() { return do { { var y = 1; {} } } }", []string{"EK0201"}},
		{"parameter-var", "export function f(x = do { var y = 1; 2 }) { return x }", []string{"EK0203"}},
		{"parameter-final-var", "export function f(x = do { var y = 1 }) { return x }", []string{"EK0201", "EK0203"}},
		{"arrow-parameter-final-var", "export const f = (x = do { var y = 1 }) => x", []string{"EK0201", "EK0203"}},
		{"nonfinal-body-var", "export function f() { return do { var y = 1; y } }", []string{"EK0107"}},
		{"final-var-and-other-var", "export function f() { var z = 1; return do { var y = z } }", []string{"EK0107", "EK0201"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			var codes []string
			for _, d := range all {
				if d.Source() == "EK" {
					codes = append(codes, fmt.Sprintf("EK%04d", d.Code()))
				}
			}
			slices.Sort(codes)
			if !slices.Equal(codes, test.codes) {
				t.Fatalf("codes = %v, want %v: %s", codes, test.codes, test.source)
			}
		})
	}
}
