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

// The source head has a lexical scope, but its generated TDZ-cell exit must
// not make no-unreachable report the source binding as dead code.
func TestConcurrentHeadHasNoGeneratedExit(t *testing.T) {
	for _, limit := range []string{"", "(2)", "(limit(1))"} {
		for _, binding := range []string{"const n", "let n", "const {n}", "const [n]"} {
			text := "effect function f() { for concurrent" + limit + " (" + binding + " of items(() => n)) { use(n) } after() }"
			forms, cells := 0, 0
			for _, node := range nodes(parse(t, "concurrent.vibe", text)) {
				switch node["type"] {
				case "BreakStatement", "SwitchStatement":
					t.Errorf("unwritten control-flow exit in %s: %v", text, node)
				case "VibeForConcurrentStatement":
					forms++
				case "VariableDeclarator":
					id, _ := node["id"].(map[string]any)
					if id["name"] == "n" && id["synthesized"] == true && node["init"] == nil {
						cells++
					}
				}
			}
			if forms != 1 || cells != 1 {
				t.Errorf("lost source loop or head scope: forms=%d cells=%d: %s", forms, cells, text)
			}
		}
	}
}
