package vibelang

import (
	"strings"
	"testing"
)

// Appendix B, EK1802: a retired await operation names the try operation that
// replaces it. Only await.all has an object counterpart, the all global; a
// race or an any rewritten with it would wait for every Effect.
func TestRetiredAwaitOperationNamesItsReplacement(t *testing.T) {
	for op, replacement := range map[string]string{"await.all": "try.all", "await.race": "try.race", "await.any": "try.any", "await.allSettled": "try.allSettled"} {
		t.Run(op, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export effect function f() { return "+op+" [Effect.succeed(1), Effect.succeed(2)] }")
			var text string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK1802.Code {
					text = diagnosticWithNotes(d)
				}
			}
			want := op + " was removed by VIP-18: write " + replacement + " over an array of Effects"
			if !strings.Contains(text, want) {
				t.Fatalf("EK1802 %q lacks %q", text, want)
			}
			if op != "await.all" && strings.Contains(text, "try all(") {
				t.Fatalf("EK1802 for %s suggests the all global, which changes the operation: %q", op, text)
			}
			for other := range retiredAwaitReplacements {
				if other != op && strings.Contains(text, "write "+strings.Replace(other, "await", "try", 1)+" ") {
					t.Fatalf("EK1802 for %s names another operation: %q", op, text)
				}
			}
		})
	}
}
