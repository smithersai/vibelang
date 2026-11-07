package vibelangestree

import (
	"strings"
	"testing"
)

func TestConcurrentLimitLexicalKinds(t *testing.T) {
	for _, tc := range []struct{ expression, token, kind string }{
		{"8", "8", "Numeric"}, {"0x10", "0x10", "Numeric"}, {"1_000", "1_000", "Numeric"},
		{"-8", "-", "Punctuator"}, {"true", "true", "Boolean"}, {"null", "null", "Null"},
		{"\"four\"", "\"four\"", "String"}, {"$concurrentLimit1", "$concurrentLimit1", "Identifier"},
	} {
		t.Run(tc.expression, func(t *testing.T) {
			source := "effect function f(xs: number[]) { for concurrent(" + tc.expression + ") (const x of xs) use(x) }"
			at := strings.Index(source, tc.expression)
			found := false
			for _, value := range parse(t, "main.vibe", source)["tokens"].([]any) {
				token := value.(map[string]any)
				start, _ := rangeOf(token)
				if start == at {
					found = true
					if token["type"] != tc.kind || token["value"] != tc.token {
						t.Fatalf("source token = %v, want %s %s", token, tc.kind, tc.token)
					}
				}
			}
			if !found {
				t.Fatal("source token missing")
			}
		})
	}
}
