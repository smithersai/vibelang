package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaEmptyArgumentsQuickFixes(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"alias", "schema Base = string\nschema Alias = Base<>\n", "schema Base = string\nschema Alias = (Base)\n"},
		{"qualified", "schema Alias = Schema.String<>\n", "schema Alias = (Schema.String)\n"},
		{"nested array", "schema Base = string\nschema Alias = Array<readonly [Base<>]>\n", "schema Base = string\nschema Alias = Array<readonly [(Base)]>\n"},
		{"struct", "schema Base = string\nschema Struct { readonly field: Base<> }\n", "schema Base = string\nschema Struct { readonly field: (Base) }\n"},
		{"error field", "schema Base = string\nschema error Bad { readonly field: Base<> }\n", "schema Base = string\nschema error Bad { readonly field: (Base) }\n"},
		{"namespace", "schema Base = string\nnamespace N { export schema Alias = Base<> }\n", "schema Base = string\nnamespace N { export schema Alias = (Base) }\n"},
		{"line comment", "schema Base = string\nschema Alias = Base<// keep this\n>[]\n", "schema Base = string\nschema Alias = (Base// keep this\n)[]\n"},
		{"block comment", "schema Base = string\nschema Alias = Base< /* keep */ >\n", "schema Base = string\nschema Alias = (Base /* keep */ )\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := applyQuickFixOf(t, test.source, EK2109.Code, diagnostics.CategoryError)
			if got != test.want {
				t.Fatalf("edited source:\n%s\nwant:\n%s", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source reports %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

func TestSchemaEmptyArgumentsLeaveValuesAndKeysAlone(t *testing.T) {
	source := "const text = 'Base<>'\nschema Base = string\nschema Good { readonly literal: 'Base<>'; readonly ['Base<>']: string; readonly values: Array<Base> }\nexport { text }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("valid source reports %s%d: %s", d.Source(), d.Code(), d.String())
		}
	}
}
