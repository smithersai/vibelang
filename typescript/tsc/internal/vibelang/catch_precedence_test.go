package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func testCatchPrecedenceQuickFix(t *testing.T) {
	for _, op := range []string{"??", "||", "&&"} {
		source := "export effect function run() { return b " + op + " a catch () => 1 }"
		got := applyExecutionPowerFix(t, source, 512, diagnostics.CategoryError)
		want := "export effect function run() { return (b " + op + " a) catch () => 1 }"
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	}
}

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
