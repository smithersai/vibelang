package vibelang

import (
	"testing"
)

func TestCatchPrecedenceSyntheticHandlers(t *testing.T) {
	for _, handler := range []string{"effect { return 9 }", "(effect { return 9 })", `throw new Error("failure")`, `(throw new Error("failure"))`} {
		program, file, _, _ := editorProgram(t, `export effect function run() { return Effect.fail("failure") catch `+handler+" }")
		found := false
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Source() != diagnosticSource {
				continue
			}
			if d.Code() == 512 {
				t.Fatalf("synthetic handler got EK0512: %s", handler)
			}
			found = found || d.Code() == 509
		}
		if !found {
			t.Fatalf("synthetic handler lost EK0509: %s", handler)
		}
	}
}
