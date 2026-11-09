package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// An explicit JavaScript iterator contract already selects a native generator.
func TestEffectGenExplicitIteratorReturnPreserved(t *testing.T) {
	const source = "export const f = () => Effect.gen(function* (): Generator<Effect.Effect<unknown>, { readonly kind: \"ok\" }, never> { yield* Effect.void; return { kind: \"ok\" } })\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("native iterator control: %s", d.String())
		}
	}
}
