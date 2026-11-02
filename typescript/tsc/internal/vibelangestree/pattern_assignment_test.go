package vibelangestree

import "testing"

// VIP-34: a lint rule must not mistake the pattern lowerer's bookkeeping
// for a constant expression the author wrote. Keep its assignment child so
// scope analysis still sees writes to pattern bindings.
func TestPatternAssignmentIsNotAConstantSequence(t *testing.T) {
	for _, source := range []string{
		"function f(x) { if (x is Exit.Failure(let cause)) return cause }",
		"function f(x) { if (x is [let cause]) return cause }",
		"function f(x) { if (x is { cause: let cause }) return cause }",
	} {
		t.Run(source, func(t *testing.T) {
			tree := parse(t, "test.vibe", source)
			assignments := find(tree, "VibePatternAssignment")
			if len(assignments) == 0 {
				t.Fatal("pattern bookkeeping still exports constant comma sequences")
			}
			for _, wrapper := range assignments {
				expression, ok := wrapper["expression"].(map[string]any)
				if !ok || expression["type"] != "AssignmentExpression" || expression["operator"] != "=" {
					t.Fatalf("pattern assignment lost its scope-analysis child: %#v", wrapper)
				}
			}
			for _, sequence := range find(tree, "SequenceExpression") {
				expressions := sequence["expressions"].([]any)
				if last := expressions[len(expressions)-1].(map[string]any); last["value"] == true {
					t.Fatal("synthetic constant-true step remains in pattern tree")
				}
			}
		})
	}
	for _, extension := range []string{"test.ts", "test.vibe"} {
		tree := parse(t, extension, "function f(x) { return (x = 1, true) && x }")
		if len(find(tree, "VibePatternAssignment")) != 0 || len(find(tree, "SequenceExpression")) != 1 {
			t.Fatalf("%s: ordinary source comma expression was changed", extension)
		}
	}
}
