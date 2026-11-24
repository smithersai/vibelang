package tsoptions_test

import (
	"fmt"
	"slices"
	"testing"
)

// A tsconfig.json that parses with a computed property name, as a broken
// string leaves one ("target"s2022", ...), is read without asking that name
// for its text: looking up compilerOptions, vibelang and diagnostics
// compares only names that have text (a compiler panic before).
func TestConfigLookupSkipsComputedPropertyNames(t *testing.T) {
	// TS1327 is the JSON parser's "String literal with double quotes
	// expected"; under compilerOptions the name is also an unknown option.
	for _, test := range []struct {
		text string
		want []string
	}{
		{`{"compilerOptions": {["x"]: 1}, "files": ["main.vibe"]}`, []string{`TS1327 ["x"]`, `TS5023 ["x"]`}},
		{`{["x"]: 1, "files": ["main.vibe"]}`, []string{`TS1327 ["x"]`}},
		// The unknown vibelang key has no text to point at, so its TS5023
		// carries no file.
		{`{"compilerOptions": {"vibelang": {["x"]: 1}}, "files": ["main.vibe"]}`, []string{`TS1327 ["x"]`, `TS5023 Unknown compiler option 'vibelang.x'.`}},
	} {
		t.Run(test.text, func(t *testing.T) {
			var got []string
			for _, d := range vibeConfig(t, test.text, "{}").GetConfigFileParsingDiagnostics() {
				source := d.Source()
				if source == "" {
					source = "TS"
				}
				at := d.String()
				if d.File() != nil {
					at = test.text[d.Pos():d.End()]
				}
				got = append(got, fmt.Sprintf("%s%d %s", source, d.Code(), at))
			}
			if !slices.Equal(got, test.want) {
				t.Fatalf("got %v, want %v", got, test.want)
			}
		})
	}
}
