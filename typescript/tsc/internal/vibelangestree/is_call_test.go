package vibelangestree

import "testing"

func TestCapturedIsHasItsOwnSourceForm(t *testing.T) {
	for _, pattern := range []string{"if (true)", "if (guard(flag))", "Exit.Failure", "not Exit.Success", "0 or 1"} {
		text := "function f() {\n  return next() is " + pattern + "\n}\n"
		tree := parse(t, "test.vibe", text)
		var forms int
		for _, node := range nodes(tree) {
			if node["type"] == "VibeIsExpression" {
				forms++
				if node["callee"].(map[string]any)["type"] != "ArrowFunctionExpression" || len(node["arguments"].([]any)) != 1 {
					t.Fatal("pattern matcher or subject missing")
				}
			}
		}
		if forms != 1 {
			t.Errorf("%s: got %d source is forms, want 1", pattern, forms)
		}
	}
}

func TestSourceArrowCallsStayCalls(t *testing.T) {
	for _, file := range []string{"test.ts", "test.vibe"} {
		tree := parse(t, file, "const result = (($is1) => guard($is1))(value)")
		var calls int
		for _, node := range nodes(tree) {
			if node["type"] == "VibeIsExpression" {
				t.Fatal("a written arrow became a pattern form")
			}
			if node["type"] == "CallExpression" {
				calls++
			}
		}
		if calls != 2 {
			t.Fatalf("got %d written calls, want 2", calls)
		}
	}
}
