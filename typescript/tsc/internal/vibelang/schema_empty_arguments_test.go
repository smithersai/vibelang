package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaEmptyArgumentsLeaveValuesAndKeysAlone(t *testing.T) {
	source := "const text = 'Base<>'\nschema Base = string\nschema Good { readonly literal: 'Base<>'; readonly ['Base<>']: string; readonly values: Array<Base> }\nexport { text }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("valid source reports %s%d: %s", d.Source(), d.Code(), d.String())
		}
	}
}
