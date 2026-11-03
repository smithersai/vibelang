package parser

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// VIP-40: "The encoding is injective, so case-only and Unicode-normalization
// twins get different files on every file system".
func TestModuleNameEncoding(t *testing.T) {
	for _, tc := range []struct{ name, encoded string }{
		{"text", "text"}, {"a1_b", "a1_b"}, {"Text", "-54-ext"},
		{"TEXT", "-54--45--58--54-"}, {"café", "caf-e9-"},
		{"cafe\u0301", "cafe-301-"}, {"$env", "-24-env"}, {"K", "-212a-"}, {"İ", "-130-"}, {"π", "-3c0-"},
	} {
		if got := ModuleDeclarationFileSuffix(tc.name); got != "."+tc.encoded+".ts" {
			t.Errorf("%q: %q", tc.name, got)
		}
	}
}

func FuzzModuleNameEncoding(f *testing.F) {
	for _, pair := range [][2]string{{"Text", "text"}, {"café", "cafe\u0301"}, {"_", "$"}, {"a", "A"}, {"K", "k"}, {"İ", "i\u0307"}} {
		f.Add(pair[0], pair[1])
	}
	f.Fuzz(func(t *testing.T, a, b string) {
		if !utf8.ValidString(a) || !utf8.ValidString(b) || len(a) > 128 || len(b) > 128 {
			return
		}
		x, y := ModuleDeclarationFileSuffix(a), ModuleDeclarationFileSuffix(b)
		if a != b && strings.EqualFold(x, y) {
			t.Fatalf("%q and %q collide at %q", a, b, x)
		}
		encoded := strings.TrimSuffix(strings.TrimPrefix(x, "."), ".ts")
		for _, ch := range encoded {
			if ch != '-' && ch != '_' && !(ch >= '0' && ch <= '9') && !(ch >= 'a' && ch <= 'z') {
				t.Fatalf("non-portable output %q", x)
			}
		}
	})
}
