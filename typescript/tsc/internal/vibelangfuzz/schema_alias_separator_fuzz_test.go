package vibelangfuzz

import (
	"strings"
	"testing"
)

func schemaAliasSeparatorQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{
		"without changing the meaning of TypeScript-style source",
		"preserves evaluation order, coldness, types, comments, and declaration output",
	} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("chapter 007 lost %q", quote)
		}
	}
}
func TestSchemaAliasSeparatorQuoted(t *testing.T) { schemaAliasSeparatorQuotes(t) }
