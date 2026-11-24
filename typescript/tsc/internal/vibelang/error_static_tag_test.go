package vibelang

import (
	"strconv"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The tag row precedes static members and setters; it owns these members.
func TestErrorStaticTagRouting(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, member := range []string{"static readonly _tag = \"E\"", "static get _tag() { return \"E\" }"} {
			source := form + " E { " + member + " }"
			program, file, _, _ := editorProgram(t, source)
			var codes []string
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Source()+strconv.Itoa(int(d.Code())))
				}
			}
			// The tag row's own error, alone: without it the static rule's
			// silence would prove nothing.
			if len(codes) != 1 || codes[0] != "EK2117" {
				t.Errorf("got %v, want the tag row's EK2117 alone: %s", codes, source)
			}
		}
	}
}
