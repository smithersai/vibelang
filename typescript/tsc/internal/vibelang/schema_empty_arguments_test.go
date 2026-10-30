package vibelang

import (
	"os"
	"path/filepath"
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

// Exercise the same project gate and repeated rounds that the CLI uses,
// with the runtime/declaration preservation fixture checked by the harness.
func TestFixProjectSchemaEmptyArguments(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "typescript/vibelang/cases/schema-empty-type-arguments-upgrade")
	before, err := os.ReadFile(filepath.Join(fixture, "main.before.vibe.txt"))
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(fixture, "main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, fixture, root)
	main := filepath.Join(dir, "main.vibe")
	if err := os.WriteFile(main, before, 0o600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	if len(result.Files) != 1 || len(result.Refused) != 0 {
		t.Fatalf("fixed %d files, refused %+v", len(result.Files), result.Refused)
	}
	var got string
	for _, fixed := range result.Files {
		got = fixed.Text
	}
	if got != string(want) {
		t.Fatalf("--fix writes:\n%s\nwant:\n%s", got, want)
	}
	if err := os.WriteFile(main, []byte(got), 0o600); err != nil {
		t.Fatal(err)
	}
	if again := fixCase(t, dir); len(again.Files) != 0 {
		t.Fatalf("second --fix changes %v", again.Order)
	}
}
