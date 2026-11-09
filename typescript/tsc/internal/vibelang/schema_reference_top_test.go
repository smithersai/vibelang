package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaReferencesRequireTop(t *testing.T) {
	const fake = "const Fake = { \"~effect/Schema/Schema\": Schema.String[\"~effect/Schema/Schema\"], Type: 0 }\n"
	for _, declaration := range []string{
		"export schema Bad = Fake\n",
		"schema Bad { value: Fake }\n",
		"schema error Bad { value: Fake }\n",
	} {
		program, file, _, _ := editorProgram(t, fake+declaration)
		count := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Code() != EK2109.Code {
				t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.String())
			}
			count++
		}
		if count != 1 {
			t.Errorf("want one EK2109 for %q, got %d", declaration, count)
		}
	}
}

func TestSchemaReferencesKeepGenuineTop(t *testing.T) {
	source := "const Optional = Schema.optionalKey(Schema.Number)\nconst Mutable = Schema.mutableKey(Schema.String)\nschema Text = Schema.String\nschema Unknown = Schema.Unknown\nschema Any = Schema.Any\nschema OptionalAlias = Optional\nschema MutableAlias = Mutable\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("genuine Schema.Top rejected: %s%d: %s", d.Source(), d.Code(), d.String())
		}
	}
}
