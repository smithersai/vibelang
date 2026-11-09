package vibelang

import (
	"testing"
)

// Appendix B: EK4838 — spec-rule: docs/design/src/900-appendices.md#db3839c2a55d4973
// EK4838 remains a registered error for persisted editor diagnostics, but
// the compiler no longer runs the legacy ownership analysis: a Fiber that
// leaves its fork region by return or storage reports no EK4838.
func TestInterimEK4838RetainedNotEmitted(t *testing.T) {
	if EK4838.Category != errorCategory || EK4838.Off || registry[EK4838.Code] != EK4838 {
		t.Fatalf("EK4838 registry entry = %+v, want a registered error", EK4838)
	}
	const prefix = "effect function one() { try sleep(1); return 1 }\nlet outer: Fiber<number> | undefined\n"
	for _, source := range []string{
		"export effect function fib() { return fork one() }",
		"export effect function fib() { outer = fork one(); return 0 }",
	} {
		program, file, _, _ := editorProgram(t, prefix+source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == EK4838.Code {
				t.Fatalf("%s: legacy ownership analysis reported %s", source, diagnosticWithNotes(d))
			}
		}
	}
}
