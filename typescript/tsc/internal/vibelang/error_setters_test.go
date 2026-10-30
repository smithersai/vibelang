package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorSetterBan(t *testing.T) {
	for _, source := range []string{
		"export error E { id: string; set label(value: string) {} }\n",
		"export schema error E { id: string; set label(value: string) {} }\n",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 1302 {
					found = true
				}
			}
			if !found {
				t.Fatal("missing EK1302 for setter")
			}
			fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
			program, file, _, _ = editorProgram(t, fixed+"\nconst item = new E({ id: \"x\" }); item.label = \"y\"; const id: string = item.id;\n")
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s", d.String())
				}
			}
		})
	}
}

func TestErrorSetterTagRouting(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		program, file, _, _ := editorProgram(t, form+" E { set _tag(value: string) {} }")
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 1302 {
				t.Error("setter rule also claimed the tag member")
			}
		}
	}
}
