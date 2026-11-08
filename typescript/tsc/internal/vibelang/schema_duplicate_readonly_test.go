package vibelang

import (
	"testing"
)

func TestSchemaDuplicateReadonly(t *testing.T) {
	source := "schema Direct { readonly readonly value: string }\nschema Alias = { readonly /* keep */ readonly value: string }\nschema Nested { child: { readonly readonly readonly value: string } }\nnamespace N { export schema Named { readonly readonly value: string } }\nschema error Problem { readonly readonly value: string }\nabstract schema error Parent { id: string }\nschema error Child extends Parent { readonly readonly value: string }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1030 {
			if got := file.Text()[d.Pos():d.End()]; got != "readonly" {
				t.Fatalf("wrong diagnostic range %q", got)
			}
			count++
		}
	}
	if count != 6 {
		t.Fatalf("got %d duplicate modifiers, want 6", count)
	}
}

func TestSchemaDuplicateReadonlyControls(t *testing.T) {
	source := "schema Good { readonly id: string; plain: number; readonly child: { readonly value: string }; readonly readonly: string }\nconst text = \"readonly readonly\"\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1030 {
			t.Fatalf("valid source rejected: %s", d.String())
		}
	}
}
