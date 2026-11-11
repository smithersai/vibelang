package vibelang

import (
	"strings"
	"testing"
)

// Chapter 002: each try operation's EK1801 hint keeps that operation. Only
// try.all has an object counterpart (the all global); a race or an any
// rewritten with it would run every Effect and wait for all of them.
// Spec rule: docs/design/src/002-running.md#efd533da52c06212
func TestTryOperationHintsKeepTheOperation(t *testing.T) {
	for _, op := range []string{"try.all", "try.race", "try.any", "try.allSettled"} {
		for _, operand := range []string{"42", "{ a: Effect.succeed(1) }", "[1, 2]", "xs", "(xs as unknown)"} {
			t.Run(op+"/"+operand, func(t *testing.T) {
				source := "declare const xs: ReadonlyArray<number>\nexport effect function f() { return " + op + " " + operand + " }"
				program, file, _, _ := editorProgram(t, source)
				var text string
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() == EK1801.Code {
						text = diagnosticWithNotes(d)
					}
				}
				if text == "" {
					t.Fatalf("no EK1801 for %s %s", op, operand)
				}
				if !strings.Contains(text, op+" requires an array or tuple of Effects.") || !strings.Contains(text, tryOperationHints[op]) {
					t.Fatalf("EK1801 text %q lacks the %s headline or hint %q", text, op, tryOperationHints[op])
				}
				if op != "try.all" && strings.Contains(text, "try all(") {
					t.Fatalf("EK1801 for %s suggests the all global, which changes the operation: %q", op, text)
				}
				if op != "try.all" && !strings.Contains(tryOperationHints[op], op+" [") {
					t.Fatalf("hint for %s does not show its own array form: %q", op, tryOperationHints[op])
				}
			})
		}
	}
}
