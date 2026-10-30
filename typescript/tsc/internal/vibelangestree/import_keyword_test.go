package vibelangestree

import "testing"

// TestABareImportIsTSImportKeyword checks an import keyword that starts no
// call or import.meta, as in `import<A0`: TypeScript parses it as
// `import < A0` without a syntax error, leaving the rejection to the checker,
// and typescript-estree copies the keyword as a TSImportKeyword node.
func TestABareImportIsTSImportKeyword(t *testing.T) {
	for _, name := range []string{"/main.vibe", "/main.ts"} {
		keywords := find(parse(t, name, "import<A0"), "TSImportKeyword")
		if len(keywords) != 1 {
			t.Fatalf("%s: got %v, want one TSImportKeyword", name, keywords)
		}
		if start, end := rangeOf(keywords[0]); start != 0 || end != 6 {
			t.Errorf("%s: the keyword's range is [%d, %d), want [0, 6)", name, start, end)
		}
	}
}
