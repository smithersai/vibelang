package vibelangfuzz

import (
	"testing"
)

// D34's unchanged-statement correspondence includes typed and untyped
// spellings of the same executable statement, as in platform-stable-local-let.
func TestOutputsRepeatedTypedStatementMappings(t *testing.T) {
	for _, tc := range []struct {
		name, source, generated, mappings string
		bad                               bool
	}{
		{"typed-local", "function first() {\n let x: number = 1;\n}\nfunction second() {\n let x = 1;\n}\n", "let x = 1;\n", "AACC", false},
		{"asserted-assignment", "function first() {\n (x as number) = 1;\n}\nfunction second() {\n x = 1;\n}\n", "x = 1;\n", "AACC", false},
		{"wrong-local-value", "function first() {\n let x: number = 2;\n}\nfunction second() {\n let x = 1;\n}\n", "let x = 1;\n", "AACC", true},
		{"wrong-assignment-value", "function first() {\n (x as number) = 2;\n}\nfunction second() {\n x = 1;\n}\n", "x = 1;\n", "AACC", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g := &Gaps{}
			(&OutputChecker{G: g}).checkStatementMappings("main.js", tc.generated, tc.source, 0, SourceMap{Mappings: tc.mappings})
			if g.Any() != tc.bad {
				t.Fatalf("mapping gaps %v, want failure %v", g.found, tc.bad)
			}
		})
	}
}
