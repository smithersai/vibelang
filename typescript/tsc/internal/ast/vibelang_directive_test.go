package ast

import (
	"strings"
	"testing"
)

func TestHasVibeLangDirective(t *testing.T) {
	t.Parallel()
	bom := "\xef\xbb\xbf"
	for _, test := range []struct {
		file, text string
		want       bool
	}{
		{"/a.ts", "// @vibe\nx", true},
		{"/a.tsx", "// @vibe\nx", true},
		{"/a.mts", "// @vibe\nx", true},
		{"/a.cts", "// @vibe\nx", true},
		{"/a.ts", "// @vibe", true},
		{"/a.ts", "// @vibe\r\nx", true},
		{"/a.ts", "// @vibe \t\nx", true},
		{"/a.ts", bom + "// @vibe\nx", true},
		{"/a.ts", "#!/usr/bin/env node\n// @vibe\nx", true},
		{"/a.ts", bom + "#!/usr/bin/env node\n// @vibe\nx", true},

		{"/a.ts", "", false},
		{"/a.ts", "x", false},
		{"/a.ts", " // @vibe\nx", false},
		{"/a.ts", "\n// @vibe\nx", false},
		{"/a.ts", "// licence\n// @vibe\nx", false},
		{"/a.ts", "// @vibes\nx", false},
		{"/a.ts", "// @vibe please\nx", false},
		{"/a.ts", "//@vibe\nx", false},
		{"/a.ts", "//  @vibe\nx", false},
		{"/a.ts", "/* @vibe */\nx", false},
		{"/a.ts", "#!/usr/bin/env node", false},
		{"/a.d.ts", "// @vibe\nx", false},
		{"/a.d.mts", "// @vibe\nx", false},
		{"/a.d.cts", "// @vibe\nx", false},
		{"/a.d.css.ts", "// @vibe\nx", false},
		{"/a.d.vibe.ts", "// @vibe\nx", false},
		{"/a.js", "// @vibe\nx", false},
		{"/a.jsx", "// @vibe\nx", false},
		{"/a.mjs", "// @vibe\nx", false},
		{"/a.json", "// @vibe\nx", false},
		{"/a.vibe", "// @vibe\nx", false},
	} {
		if got := HasVibeLangDirective(test.file, test.text); got != test.want {
			t.Errorf("HasVibeLangDirective(%q, %q) = %v, want %v", test.file, test.text, got, test.want)
		}
	}
}

// FuzzHasVibeLangDirective holds the rule's two halves for any text: text
// after a directive line never changes the verdict, and a first line that is
// not the directive never counts.
func FuzzHasVibeLangDirective(f *testing.F) {
	f.Add("x")
	f.Add("// @vibe")
	f.Add("\n// @vibe\n")
	f.Add("#!\n// @vibe\n")
	f.Fuzz(func(t *testing.T, text string) {
		if !HasVibeLangDirective("/a.ts", "// @vibe\n"+text) {
			t.Fatalf("a directive line followed by %q is not the directive", text)
		}
		first, _, _ := strings.Cut(strings.TrimPrefix(text, "\xef\xbb\xbf"), "\n")
		if HasVibeLangDirective("/a.ts", text) && !strings.HasPrefix(first, "#!") && !strings.HasPrefix(first, "// @vibe") {
			t.Fatalf("%q counts without the directive on its first line", text)
		}
		if HasVibeLangDirective("/a.d.ts", text) || HasVibeLangDirective("/a.js", text) {
			t.Fatalf("%q counts outside a TypeScript source", text)
		}
	})
}
