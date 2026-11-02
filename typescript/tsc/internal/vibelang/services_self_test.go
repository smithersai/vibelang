package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// Property names and local bindings in a shape do not refer to its service.
func TestServiceShapeShadowedNames(t *testing.T) {
	for _, source := range []string{
		"service X: { X: string }",
		"service X: <X>(arg: X) => X",
		"service X: { [X in \"a\" | \"b\"]: X }",
		"service X: (X: string) => typeof X",
		"service X: string extends infer X ? X : never",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source+" {}")
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
		})
	}
}
