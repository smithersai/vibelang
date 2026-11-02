package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestNonrelativeAliasSpellingQuoted(t *testing.T) {
	const quote = "TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their \x60TS\x60 codes, including independent errors in embedded expressions and types."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}
