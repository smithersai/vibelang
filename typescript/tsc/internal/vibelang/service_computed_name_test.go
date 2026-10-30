package vibelang

import "testing"

// A service member whose name is computed, such as static [Symbol.iterator],
// is no `key`: checking the service reads only a member named key as one,
// instead of asking a computed name for its text (a compiler panic).
func TestServiceStaticComputedNameIsNoKey(t *testing.T) {
	program, file, _, _ := editorProgram(t, "service Counter {\n  static [Symbol.iterator] = 1\n  n: number\n}\n")
	program.GetSemanticDiagnostics(t.Context(), file)
}
