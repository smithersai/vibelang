package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func assertAlchemyDnsFix(t *testing.T, source, absent, present string) {
	t.Helper()
	got, result := fixedPipe(t, source)
	if strings.Contains(got, absent) || !strings.Contains(got, present) {
		t.Fatalf("incomplete conversion:\n%s\nrefused: %+v", got, result.Refused)
	}
	program, file, _, _ := editorProgram(t, got)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("fixed source: %s", d.String())
		}
	}
	if again, _ := fixedPipe(t, got); again != got {
		t.Fatalf("not idempotent:\n%s", again)
	}
}
