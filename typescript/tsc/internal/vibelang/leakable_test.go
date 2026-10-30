package vibelang

import "testing"

// EK4809 reads a requirement's declaration for @vibelang leakable in its
// documentation comment. The comment is the JSDoc node's whole text, so a
// declaration with JSDoc, such as effect's Effect type when a member requires
// Effect.Effect<string, never, Maybe!!>, is read rather than panicking, and a
// service marked leakable is exempt (012-devtools.md).
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
	t.Run("a requirement whose declaration has JSDoc", func(t *testing.T) {
		count(t, "service Database {\n  query(sql: string): Effect.Effect<string, never, Maybe!!>\n}\n")
	})
	const users = "service Users {\n  find(): number!!Tx\n  all(): number!!Tx\n}\n"
	t.Run("an ordinary shared requirement", func(t *testing.T) {
		if n := count(t, "service Tx { id: number }\n"+users); n != 1 {
			t.Fatalf("got %d EK4809, want 1", n)
		}
	})
	t.Run("a leakable shared requirement", func(t *testing.T) {
		if n := count(t, "/** A transaction. @vibelang leakable */\nservice Tx { id: number }\n"+users); n != 0 {
			t.Fatalf("got %d EK4809, want none for a leakable service", n)
		}
	})
}
