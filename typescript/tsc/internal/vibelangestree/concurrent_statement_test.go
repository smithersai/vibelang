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

// Written dollar-prefixed names remain source identifiers; only generated
// cache references are excluded from scope analysis.
func TestConcurrentLimitIdentifiersKeepTheirOrigin(t *testing.T) {
	for _, limit := range []string{"2", "limit(1)", "$concurrentLimit1", "$concurrentLimit1 + limit(1)"} {
		for _, gap := range []string{" ", "\n", "/* 😀 */"} {
			source := "effect function f($concurrentLimit1: number) { for concurrent" + gap + "(" + limit + ") (const item of items()) { use(item, $concurrentLimit1) } }"
			authored := 0
			for _, node := range nodes(parse(t, "main.vibe", source)) {
				if node["type"] != "Identifier" {
					continue
				}
				name := node["name"].(string)
				if name == "$concurrentLimit1" {
					if node["synthesized"] == true {
						t.Fatalf("written name marked synthetic: %s", source)
					}
					authored++
				} else if len(name) >= len("$concurrentLimit") && name[:len("$concurrentLimit")] == "$concurrentLimit" && node["synthesized"] != true {
					t.Fatalf("generated name %s marked authored: %s", name, source)
				}
			}
			if authored < 2 {
				t.Fatalf("lost written parameter or body read: %s", source)
			}
		}
	}
}
