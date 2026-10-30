package vibelang

import (
	"runtime/debug"
	"testing"
)

// An argument the editor checks while its call is still being resolved must
// not resolve that call again. In `Layer.effect(Reports, {` followed by
// `const printer = try Printer`, checking the object literal asks whether a
// member is passed by name, which asked the checker for Layer.effect's
// signature, whose resolution checked the literal again: the language server
// recursed until the stack overflowed. The compiler stops at the syntax
// errors, so only a semantic check, as the editor runs, reaches it.
func TestByNameDoesNotReenterItsCallsResolution(t *testing.T) {
	defer debug.SetMaxStack(debug.SetMaxStack(64 << 20)) // fail fast instead of filling 1 GB
	program, file, _, _ := editorProgram(t, "const ReportsLive = Layer.effect(Reports, {\n  const printer = try Printer\n")
	if len(program.GetSemanticDiagnostics(t.Context(), file)) == 0 {
		t.Fatal("want the undeclared Reports and Printer reported")
	}
}
