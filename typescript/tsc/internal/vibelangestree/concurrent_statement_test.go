package vibelangestree

import "testing"

func TestConcurrentStatementSourceForm(t *testing.T) {
	for _, gap := range []string{" ", "\n", "/* line\n break */"} {
		for _, limit := range []string{"", "(2)", "(limit(1))"} {
			for _, binding := range []string{"const x", "let x", "const {value: x}", "const [x]"} {
				text := "effect function f() { for" + gap + "concurrent" + gap + limit + gap + "(" + binding + " of items(1)) { use(x) } }"
				tree := parse(t, "test.vibe", text)
				var count int
				for _, node := range nodes(tree) {
					if node["type"] != "VibeForConcurrentStatement" {
						continue
					}
					count++
					if node["iterable"].(map[string]any)["type"] != "CallExpression" {
						t.Fatal("source iterable call is missing")
					}
					if (node["concurrency"] == nil) != (limit == "") {
						t.Fatalf("concurrency does not match source %q", limit)
					}
					if node["body"].(map[string]any)["type"] != "ArrowFunctionExpression" {
						t.Fatal("item parameter scope is missing")
					}
				}
				if count != 1 {
					t.Errorf("got %d source statements: %s", count, text)
				}
			}
		}
	}
}

func TestSourceConcurrentNamedCallStaysCall(t *testing.T) {
	for _, file := range []string{"test.ts", "test.vibe"} {
		tree := parse(t, file, "function f($forConcurrent) { $forConcurrent(items, 2, (x) => x) }")
		var calls int
		for _, node := range nodes(tree) {
			if node["type"] == "VibeForConcurrentStatement" {
				t.Fatal("written callee mistaken for an intrinsic")
			}
			if node["type"] == "CallExpression" {
				calls++
			}
		}
		if calls != 1 {
			t.Fatalf("got %d source calls", calls)
		}
	}
}
