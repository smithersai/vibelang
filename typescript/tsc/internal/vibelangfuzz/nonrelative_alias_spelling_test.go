package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestNonrelativeAliasSpellingQuoted(t *testing.T) {
	const quote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}
