package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestModuleServiceShapeNamespace(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export service Top { static readonly key = \"top\"; n: number }\nexport const top: Top.Shape = { n: 1 }\nnamespace N { export service Nested { static readonly key = \"nested\"; n: number }; const impl: Nested.Shape = { n: 2 } }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Error(d.String())
		}
	}
}
