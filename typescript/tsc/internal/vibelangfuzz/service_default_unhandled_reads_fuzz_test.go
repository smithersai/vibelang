package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestServiceDefaultUnhandledReadsQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"900-appendices.md": serviceDefaultReadsQuote,
		"007-tooling.md":    migrationDeclarationFixQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}
