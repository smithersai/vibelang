package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestComputedErrorPayloadFields(t *testing.T) {
	for _, kind := range []string{"error", "schema error"} {
		t.Run(kind, func(t *testing.T) {
			source := "const key = \"computed\" as const\nexport " + kind + " Entry { \"quoted\": number; 7: number; [key]: number }\nexport const entry = new Entry({ quoted: 1, 7: 2, computed: 3 })\nexport const fields: readonly [number, number, number] = [entry.quoted, entry[7], entry.computed]\n"
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("computed payload fields must construct and read as numbers: %s", d.String())
				}
			}
		})
	}
}
