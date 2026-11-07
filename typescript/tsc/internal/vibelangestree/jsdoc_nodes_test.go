package vibelangestree

import "testing"

func TestJSDocTypeShapes(t *testing.T) {
	for _, tc := range []struct {
		source, kind string
		postfix      bool
	}{
		{"*", "TSJSDocAllType", false}, {"?string", "TSJSDocNullableType", false},
		{"!string", "TSJSDocNonNullableType", false}, {"string?", "TSJSDocNullableType", true},
		{"string!", "TSJSDocNonNullableType", true},
	} {
		t.Run(tc.source, func(t *testing.T) {
			tree := parse(t, "main.ts", "type Value = "+tc.source)
			var found map[string]any
			for _, n := range nodes(tree) {
				if n["type"] == tc.kind {
					found = n
				}
			}
			if found == nil {
				t.Fatalf("missing %s", tc.kind)
			}
			if found["id"] != float64(0) {
				t.Fatal("stock unknown-node id missing")
			}
			if tc.kind != "TSJSDocAllType" && found["postfix"] != tc.postfix {
				t.Fatalf("wrong postfix: %v", found)
			}
		})
	}
}
