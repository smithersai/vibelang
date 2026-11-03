package vibelangestree

import (
	"strings"
	"testing"
)

// VIP-7's match executes one arm; its compiler-generated exits must still
// have a target when ESLint builds the source's control-flow graph.
func TestMatchBreaksKeepTheirControlFlowTarget(t *testing.T) {
	for _, text := range []string{
		"const f = (n: number) => do { const x = n; match (x) { when 0: true; default: false; } };",
		"function f(n: number) { return do { match (n) { when 0: 1; default: throw new Error(); } }; }",
		"const f = (n: number) => do { match (n) { when 0: do { match (n) { when 1: 2; default: 3; } }; default: 4; } };",
	} {
		switches, breaks := 0, 0
		for _, node := range nodes(parse(t, "/t3code-match.vibe", text)) {
			if node["type"] == "SwitchStatement" {
				switches++
			}
			if node["type"] == "BreakStatement" {
				breaks++
				if label, ok := node["label"].(map[string]any); ok && label["synthesized"] == true {
					t.Errorf("generated break %s has no label declaration in ESTree", label["name"])
				}
			}
		}
		if switches == 0 || breaks == 0 {
			t.Errorf("match has no break target: switches=%d, breaks=%d", switches, breaks)
		}
	}
	text := "function f() { outer: while (true) { break outer; } }"
	for _, node := range nodes(parse(t, "/written.vibe", text)) {
		if node["type"] == "BreakStatement" {
			label := node["label"].(map[string]any)
			if label["name"] != "outer" || label["synthesized"] == true {
				t.Errorf("written label changed: %v", label)
			}
			start, end := rangeOf(label)
			if !strings.HasPrefix(utf16Slice(text, start, end), "outer") {
				t.Errorf("written label lost source range")
			}
		}
	}
}
