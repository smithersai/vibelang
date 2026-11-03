// 003-failures.md: TestErrorTypeParameterBan rejects generic plain and schema errors with EK1303
// rule: docs/design/src/003-failures.md#2b6dbd98a5d21169
package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorTypeParameterBan(t *testing.T) {
	for _, source := range []string{"export error E<T> { value: T }\n", "export schema error E<T> {}\n"} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 1303 {
					return
				}
			}
			t.Fatal("missing EK1303 for type parameters")
		})
	}
}

func TestErrorTypeParameterQuickFix(t *testing.T) {
	fixed := applyQuickFixOf(t, "export error E<T> { value: T }\n", 1303, diagnostics.CategoryError)
	program, file, _, _ := editorProgram(t, fixed+"\nconst item = new E<number>({value: 1}); const n: number = item.value;\n")
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError || d.Code() == 4830 {
			t.Errorf("fixed source: %s", d.String())
		}
	}
}
