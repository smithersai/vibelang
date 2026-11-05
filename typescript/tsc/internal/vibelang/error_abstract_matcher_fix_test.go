package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestReservedErrorClassFixPreservesMatcherKind(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, abstract := range []bool{false, true} {
			for _, field := range []string{"_tag: string", "readonly _tag: string", "_tag /* key */: string"} {
				t.Run(fmt.Sprintf("%s/%t/%s", form, abstract, field), func(t *testing.T) {
					prefix := ""
					if abstract {
						prefix = "abstract "
					}
					source := "const $ErrorMatcher = 0;\nexport " + prefix + form + " Base { " + field + "; id: string }\n"
					fixed := applyQuickFixOf(t, source, EK2117.Code, diagnostics.CategoryError)
					if fixed == source || !strings.Contains(fixed, prefix+"class Base extends") {
						t.Fatalf("expected preserving class repair:\n%s", fixed)
					}
					ownsMatcher := strings.Contains(fixed, "$schemaErrorMatcher as")
					if ownsMatcher != (form == "schema error" || !abstract) {
						t.Fatalf("repair changed own-matcher dispatch: form=%s abstract=%t\n%s", form, abstract, fixed)
					}
					program, file, _, _ := editorProgram(t, fixed)
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("repair introduced %s\n%s", d.String(), fixed)
						}
					}
				})
			}
		}
	}
}
