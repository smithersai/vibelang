package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestEffectMarkerComments(t *testing.T) {
	for _, prefix := range []string{
		"export ",
		"export /* function */ ",
		"export default /* function */ ",
		"export // function\n",
		"export /*\nfunction\n*/ ",
		"export /* first */ /* function */ ",
		"export /* functionally */ ",
		"export /* 🦊 function café */ ",
		"export /* malfunction */ ",
		"/* function */ export ",
		"/* function */ ",
	} {
		t.Run(prefix, func(t *testing.T) {
			tail := "function load() { return try Effect.succeed(1) }\n"
			source, want := prefix+tail, prefix+"effect "+tail
			fixed := applyQuickFixOf(t, source, EK0501.Code, diagnostics.CategoryError)
			if fixed != want {
				t.Fatalf("mark the real function and preserve comments:\ngot:\n%s\nwant:\n%s", fixed, want)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("the repaired function must compile: %v", d)
				}
			}
		})
	}
}
