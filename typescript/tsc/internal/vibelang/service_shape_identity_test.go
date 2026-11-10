package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceWrittenShapeIdentity(t *testing.T) {
	for _, shape := range []string{"S", "S[]", "{ self: S }", "{ readonly peers: readonly S[] }", "{ read(): S }", "{ read<T>(other: T): S }", "Shape", "{ read<S>(other: S): S }"} {
		t.Run(shape, func(t *testing.T) {
			source := "type Shape = { self: S }; export service S: " + shape + " { static readonly key = \"identity/S\" }"
			p, file, _, _ := editorProgram(t, source)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("written identity rejected: %s", d.String())
				}
			}
		})
	}
}
