package vibelang

import (
	"testing"
)

func TestSchemaFieldInitializers(t *testing.T) {
	source := "schema Direct { value: number = 42 }\nschema Optional { value?: number = 42 }\nschema Alias = { readonly value: string = \"ignored\" }\nschema Nested { child: { value: number = 42 } }\nnamespace N { export schema Named { value: number = 42 } }\nschema error Outer { readonly child: { value: number = 42 } }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1247 {
			text := file.Text()[d.Pos():d.End()]
			if text != "42" && text != "\"ignored\"" {
				t.Fatalf("wrong initializer span %q", text)
			}
			count++
		}
	}
	if count != 6 {
		t.Fatalf("got%d ignored initializers,want6", count)
	}
}

func TestSchemaFieldInitializerControls(t *testing.T) {
	source := "const value=42\nschema Good { readonly value: number; maybe?: string; default: number }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1247 {
			t.Fatalf("valid schema rejected: %s", d.String())
		}
	}
}
