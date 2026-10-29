package vibelang

import "testing"

func TestLocalMainIsOrdinaryJavaScript(t *testing.T) {
	program, file, _, _ := editorProgram(t, "function main() { return 1 }")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		t.Fatalf("local main must compile without diagnostics: %v", d)
	}
}
