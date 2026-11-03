package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestCatchPrecedence(t *testing.T) {
	t.Run("editor", testCatchPrecedenceQuickFix)
	t.Run("cli-operand", testCatchPrecedenceCLIFix)
	t.Run("cli-suffix", testCatchPrecedenceSuffixFix)
}

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
func testCatchPrecedenceCLIFix(t *testing.T) {
	for _, op := range []string{"??", "||", "&&"} {
		source := "declare const a: Effect.Effect<number, string>\ndeclare const b: Effect.Effect<number,string>\nexport effect function run() { return b " + op + " a catch () => 1 }"
		program, file, _, _ := editorProgram(t, source)
		proposal := fileFixes(t.Context(), program, file, map[string]bool{}, []int32{512})
		want := strings.Replace(source, "b "+op+" a catch", "(b "+op+" a) catch", 1)
		if got := proposal.text(); got != want {
			t.Fatalf("CLI got %q, want %q", got, want)
		}
	}
}
func testCatchPrecedenceSuffixFix(t *testing.T) {
	for _, test := range []struct{ before, after string }{
		{"a catch function () { return 1 }()", "a catch () => function () { return 1 }()"},
		{"a catch function () { return [1] }[0]", "a catch () => function () { return [1] }[0]"},
		{"a catch (() => 1)()", "a catch () => (() => 1)()"},
	} {
		program, file, _, _ := editorProgram(t, "export effect function run() { return "+test.before+" }")
		proposal := fileFixes(t.Context(), program, file, map[string]bool{}, []int32{512})
		want := "export effect function run() { return " + test.after + " }"
		if got := proposal.text(); got != want {
			t.Fatalf("CLI got %q, want %q", got, want)
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
