package vibelang

import "testing"

// EK4809 reads requirement declarations with JSDoc and exempts services
// whose documentation marks them leakable.
func TestLeakableReadsTheDocumentationComment(t *testing.T) {
	count := func(t *testing.T, source string) int {
		program, file, _, _ := editorProgram(t, source)
		n := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == EK4809.Code {
				n++
			}
		}
		return n
	}
	const users = "service Users {\n  find(): number!!Tx\n  all(): number!!Tx\n}\n"
	t.Run("an ordinary shared requirement with JSDoc", func(t *testing.T) {
		if n := count(t, "/** A transaction. */\nservice Tx { id: number }\n"+users); n != 1 {
			t.Fatalf("got %d EK4809, want 1", n)
		}
	})
	t.Run("a leakable shared requirement", func(t *testing.T) {
		if n := count(t, "/** A transaction. @vibelang leakable */\nservice Tx { id: number }\n"+users); n != 0 {
			t.Fatalf("got %d EK4809, want none for a leakable service", n)
		}
	})
}
