package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

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
