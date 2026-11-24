package vibelang

import (
	"strconv"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorSetterTagRouting(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		program, file, _, _ := editorProgram(t, form+" E { set _tag(value: string) {} }")
		var codes []string
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Source()+strconv.Itoa(int(d.Code())))
			}
		}
		// The tag row's own error, alone: without it the setter rule's
		// silence would prove nothing.
		if len(codes) != 1 || codes[0] != "EK2117" {
			t.Errorf("%s: got %v, want the tag row's EK2117 alone", form, codes)
		}
	}
}
