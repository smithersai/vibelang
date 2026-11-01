package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestFixScopeRulesQuoted(t *testing.T) {
	text := SpecText("007-tooling.md")
	for _, q := range []string{"the selected project's own files", "an owned source an import reaches", "never overwrites an existing file"} {
		if !strings.Contains(text, q) {
			t.Fatal(q)
		}
	}
}
