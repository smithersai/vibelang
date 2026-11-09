package vibelang

import (
	"testing"
)

func TestEK4833GroupedNamespaceRefusal(t *testing.T) {
	const source = "import type * as FX from \"effect/Effect\"; export type Program = FX.Effect<number | string>"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == 4833 {
			return
		}
	}
	t.Fatal("missing EK4833")
}
