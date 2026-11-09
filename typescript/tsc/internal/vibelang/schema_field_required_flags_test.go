package vibelang

import (
	"strings"
	"testing"
)

func TestSchemaRequiredFieldReferenceFlags(t *testing.T) {
	source := "const Optional = Schema.optionalKey(Schema.Number)\nconst Alias = Optional\nconst Uncertain = Optional as Schema.Top\nschema Direct { readonly value: Optional }\nschema Aliased { readonly value: Alias }\nschema Nested { readonly child: { readonly value: Optional } }\nschema Wide { readonly value: Uncertain }\nnamespace N { export schema Nested { readonly value: Optional } }\nschema error Outer { readonly nested: { readonly value: Optional } }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code && strings.HasPrefix(d.String(), "A required schema field") {
			count++
		}
	}
	if count != 6 {
		t.Fatalf("got %d required-field errors, want 6", count)
	}
}

func TestSchemaRequiredFieldReferenceInverseSafety(t *testing.T) {
	source := "const Optional = Schema.optionalKey(Schema.Number)\nexport const Codec = Schema.Struct({ value: Optional })\nexport type Codec = typeof Codec.Type\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK4832.Code {
			t.Fatalf("unsafe schema rewrite: %s", d.String())
		}
	}
}

func TestSchemaRequiredFieldReferenceControls(t *testing.T) {
	source := "const Optional = Schema.optionalKey(Schema.Number)\nconst Required = Schema.Number\nschema Good { readonly value: Required; readonly maybe?: Optional; readonly present: number | undefined; readonly list: Array<number> }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code {
			t.Fatalf("valid mapped field rejected: %s", d.String())
		}
	}
}
