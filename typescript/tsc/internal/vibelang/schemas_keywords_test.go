package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-15: a field's type maps to a schema only when it is a primitive, a
// literal, a union, an array, a tuple, a Record, an object type, or another
// schema's name. unknown, any, never, object and void are EK2109, whose quick
// fix writes the Schema constant the field meant.
func TestSchemaKeywordQuickFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"unknown", "export schema Event { payload: unknown }\n", "export schema Event { payload: Schema.Unknown }\n"},
		{"any, optional", "export schema Event { meta?: any }\n", "export schema Event { meta?: Schema.Any }\n"},
		{"never in a union", "export schema Event { at: string | never }\n", "export schema Event { at: string | Schema.Never }\n"},
		{"object in an array", "export schema Event { parts: object[] }\n", "export schema Event { parts: Schema.ObjectKeyword[] }\n"},
		{"void in an alias", "export schema Done = void\n", "export schema Done = Schema.Void\n"},
		{"unknown in a schema error", "export schema error Bad { cause: unknown }\n", "export schema error Bad { cause: Schema.Unknown }\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := applyQuickFixOf(t, test.source, EK2109.Code, diagnostics.CategoryError)
			if got != test.want {
				t.Fatalf("edited source differs:\ngot:\n%s\nwant:\n%s", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("the fixed source reports %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}
