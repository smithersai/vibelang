package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 002: EK2004 names the Stream conversion that fits the operand. The
// conversion it names must itself compile as a for try operand, and an
// operand with no element-wise conversion gets none.
// Spec rule: docs/design/src/002-running.md#for-try
func TestForTryOperandHintsMatchTheOperand(t *testing.T) {
	const prefix = "import { Effect, Option, Stream } from \"effect\"\n" +
		"declare const xs: ReadonlyArray<number>\n" +
		"declare const pair: readonly [number, string]\n" +
		"declare const maybe: ReadonlyArray<number> | undefined\n" +
		"declare const chunks: AsyncIterable<number>\n" +
		"declare const pages: AsyncGenerator<string>\n" +
		"declare function rows(): Generator<number>\n"
	asyncHint := "convert this AsyncIterable with Stream.fromAsyncIterable first."
	arrayHint := "convert this array with Stream.fromIterable first."
	iterableHint := "convert this Iterable with Stream.fromIterable first."
	for _, test := range []struct{ operand, hint, convert string }{
		{"[1, 2]", arrayHint, "Stream.fromIterable(OPERAND)"},
		{"xs", arrayHint, "Stream.fromIterable(OPERAND)"},
		{"pair", arrayHint, "Stream.fromIterable(OPERAND)"},
		{"new Set([1])", iterableHint, "Stream.fromIterable(OPERAND)"},
		{"new Map([[1, 2]])", iterableHint, "Stream.fromIterable(OPERAND)"},
		{"\"ab\"", iterableHint, "Stream.fromIterable(OPERAND)"},
		{"rows()", iterableHint, "Stream.fromIterable(OPERAND)"},
		{"chunks", asyncHint, "Stream.fromAsyncIterable(OPERAND, (e) => e)"},
		{"pages", asyncHint, "Stream.fromAsyncIterable(OPERAND, (e) => e)"},
		{"42", "", ""},
		{"maybe", "", ""},
		{"Effect.succeed(1)", "", ""},
		{"Option.some(1)", "", ""},
	} {
		t.Run(test.operand, func(t *testing.T) {
			source := prefix + "export effect function f() { for try (const x of " + test.operand + ") { } }"
			program, file, _, _ := editorProgram(t, source)
			var text string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK2004.Code {
					text = diagnosticWithNotes(d)
				}
			}
			if !strings.Contains(text, "for try requires a Stream") {
				t.Fatalf("no EK2004 for %s: %q", test.operand, text)
			}
			if test.hint == "" {
				if strings.Contains(text, "Stream.from") {
					t.Fatalf("EK2004 for %s suggests a conversion that does not fit it: %q", test.operand, text)
				}
				return
			}
			if !strings.Contains(text, test.hint) {
				t.Fatalf("EK2004 for %s: got %q, want the hint %q", test.operand, text, test.hint)
			}
			converted := strings.ReplaceAll(test.convert, "OPERAND", test.operand)
			program, file, _, _ = editorProgram(t, prefix+"export effect function f() { for try (const x of "+converted+") { } }")
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("the suggested %s does not compile: %s", converted, diagnosticWithNotes(d))
				}
			}
		})
	}
}
