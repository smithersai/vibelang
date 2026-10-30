package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Comments must not supply a declaration's missing function keyword.
// Compare its diagnostic and real editor repair with the comment-free control.
// FuzzFunctionBoundaries separately keeps the exact canonical EK0101 oracle.
func TestEffectShorthandComments(t *testing.T) {
	for _, modifier := range []string{"effect", "async"} {
		t.Run(modifier, func(t *testing.T) {
			control := "export " + modifier + " load<T>(value: T) { return value }\n"
			controlProgram, controlFile, _, _ := editorProgram(t, control)
			var code int32
			for _, d := range controlProgram.GetSemanticDiagnostics(t.Context(), controlFile) {
				if d.Source() == diagnosticSource && d.Category() == diagnostics.CategoryError {
					if code != 0 {
						t.Fatalf("comment-free control has multiple errors: %v", d)
					}
					code = d.Code()
				}
			}
			if code == 0 {
				t.Fatal("comment-free shorthand must report its missing function keyword")
			}
			source := "export /* function */ " + modifier + " load<T>(value: T) { return value }\n"
			want := "export /* function */ " + modifier + " function load<T>(value: T) { return value }\n"
			got := applyQuickFixOf(t, source, code, diagnostics.CategoryError)
			if got != want {
				t.Fatalf("quick fix changed comments or modifiers:\ngot:\n%s\nwant:\n%s", got, want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == code {
					t.Fatalf("fixed declaration still reports missing function: %v", d)
				}
			}
		})
	}
}
