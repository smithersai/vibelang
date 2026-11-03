package vibelangestree

import (
	"strings"
	"testing"
)

func TestDoMethodCallSourceBoundaries(t *testing.T) {
	for _, method := range []string{"out.push", "out[key]", "(out.push)", "this.push", "factory().push", "out.bind"} {
		for _, gap := range []string{"", " /* comment */ ", "\n", "\r\n", "/* line\n break */"} {
			t.Run(method+gap, func(t *testing.T) {
				text := "// 😀\nfunction f() { for (const i of [0, 1]) { " + method + gap + "(1, do { if (i === 0) continue; 0 })\n} }"
				tree := parse(t, "test.vibe", text)
				var calls int
				for _, node := range nodes(tree) {
					if node["type"] == "MemberExpression" && node["computed"] == true {
						object := node["object"].(map[string]any)
						_, end := rangeOf(object)
						found := false
						for _, value := range tree["tokens"].([]any) {
							token := value.(map[string]any)
							start, _ := rangeOf(token)
							if start >= end && token["value"] != ")" {
								found = token["value"] == "["
								break
							}
						}
						if !found {
							t.Errorf("computed receiver at %v does not end before its opening [", object["range"])
						}
					}
					if node["type"] != "CallExpression" || len(node["arguments"].([]any)) == 0 {
						continue
					}
					calls++
					callee := node["callee"].(map[string]any)
					_, end := rangeOf(callee)
					var next string
					for _, value := range tree["tokens"].([]any) {
						token := value.(map[string]any)
						start, _ := rangeOf(token)
						if start >= end && token["value"] != ")" {
							next = token["value"].(string)
							break
						}
					}
					if next != "(" {
						t.Errorf("callee %v at %v ends before %q, want call opening (", callee["type"], callee["range"], next)
					}
					if callee["type"] == "MemberExpression" && callee["property"].(map[string]any)["name"] == "bind" {
						start, end := rangeOf(callee)
						if !strings.HasSuffix(utf16Slice(text, start, end), ".bind") {
							t.Error("parser-generated bind leaked as a source call")
						}
					}
				}
				if calls == 0 {
					t.Fatal("source call disappeared")
				}
			})
		}
	}
}
