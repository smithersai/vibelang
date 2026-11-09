package vibelang

import (
	"testing"
)

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
