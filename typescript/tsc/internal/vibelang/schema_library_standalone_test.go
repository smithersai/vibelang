package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The alias must work without another declaration loading Schema for it.
func TestSchemaStandaloneLibraryAliases(t *testing.T) {
	for _, name := range []string{"Date", "URL", "RegExp", "Uint8Array", "Error"} {
		t.Run(name, func(t *testing.T) {
			source := "export schema Value = " + name
			program, file, _, _ := editorProgram(t, source)
			prelude, root, _ := mayUsePrelude(file)
			t.Logf("dependency discovery: prelude=%t effectRoot=%t detachedCodecs=%d", prelude, root, len(file.VibeLangSchemaGenerics))
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Error(d.String())
				}
			}
		})
	}
}
