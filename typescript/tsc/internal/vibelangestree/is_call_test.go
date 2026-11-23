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

func TestBareIsRangeContainsChildren(t *testing.T) {
	getRange := func(node map[string]any) (int, int, bool) {
		switch r := node["range"].(type) {
		case []int:
			if len(r) == 2 {
				return r[0], r[1], true
			}
		case [2]int:
			return r[0], r[1], true
		case []any:
			if len(r) == 2 {
				if a, ok := r[0].(float64); ok {
					if b, ok := r[1].(float64); ok {
						return int(a), int(b), true
					}
				}
			}
		}
		return 0, 0, false
	}
	var checkRanges func(node map[string]any)
	checkRanges = func(node map[string]any) {
		pStart, pEnd, hasRange := getRange(node)
		for k, v := range node {
			if k == "tokens" || k == "comments" || k == "range" || k == "loc" {
				continue
			}
			visitChild := func(child map[string]any) {
				if cStart, cEnd, ok := getRange(child); ok && hasRange {
					if cStart < pStart || cEnd > pEnd {
						t.Errorf("parent %s range [%d,%d] does not contain child %s (%s) range [%d,%d]",
							node["type"], pStart, pEnd, k, child["type"], cStart, cEnd)
					}
				}
				checkRanges(child)
			}
			switch child := v.(type) {
			case map[string]any:
				visitChild(child)
			case []any:
				for _, elem := range child {
					if m, ok := elem.(map[string]any); ok {
						visitChild(m)
					}
				}
			}
		}
	}

	for _, pattern := range []string{"1", `"a"`, "null", "undefined", "true", "=== 1", "instanceof Map"} {
		text := "effect function e(x: unknown) {\n  if (x is " + pattern + ") return 1\n  return 0\n}\n"
		tree := parse(t, "test.vibe", text)
		checkRanges(tree)
		var foundIs bool
		for _, node := range nodes(tree) {
			if node["type"] == "BinaryExpression" {
				t.Errorf("x is %s produced a BinaryExpression instead of VibeIsExpression", pattern)
			}
			if node["type"] == "VibeIsExpression" {
				foundIs = true
			}
		}
		if !foundIs {
			t.Errorf("x is %s: expected VibeIsExpression", pattern)
		}
	}
}
